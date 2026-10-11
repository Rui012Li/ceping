-- 前端直连版：用 RPC 替代 Edge Function（适合无法部署 Functions 的环境）

-- 允许匿名调用扣次
grant execute on function public.consume_password(text) to anon, authenticated;

-- 提交结果：校验 session 后写入
create or replace function public.submit_result(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception '缺少会话';
  end if;

  update public.sessions
  set consumed = true
  where token = p_token and consumed = false;

  if not found then
    raise exception '会话无效或已提交，请重新输入密码';
  end if;

  v_id := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into public.results(id, payload)
  values (v_id, coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('id', v_id));

  return (select payload from public.results where id = v_id);
end;
$$;

grant execute on function public.submit_result(text, jsonb) to anon, authenticated;

-- 读取结果（也可走表 RLS select）
create or replace function public.get_result(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  select payload into v_payload from public.results where id = p_id;
  if v_payload is null then
    raise exception '结果不存在';
  end if;
  return v_payload || jsonb_build_object('id', p_id);
end;
$$;

grant execute on function public.get_result(text) to anon, authenticated;

-- 管理配置（只存管理员密码哈希的明文对照表，简单场景）
create table if not exists public.app_settings (
  key text primary key,
  value text not null
);

alter table public.app_settings enable row level security;

insert into public.app_settings(key, value)
values ('admin_password', 'admin888')
on conflict (key) do nothing;

-- 管理员登录
create or replace function public.admin_login(p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_token text;
begin
  select value into v_expected from public.app_settings where key = 'admin_password';
  if v_expected is null or p_password is distinct from v_expected then
    raise exception '管理员密码错误';
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '');
  insert into public.admin_sessions(token, expires_at)
  values (v_token, now() + interval '7 days');
  return jsonb_build_object('ok', true, 'token', v_token);
end;
$$;

grant execute on function public.admin_login(text) to anon, authenticated;

create or replace function public.admin_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.admin_sessions where token = p_token;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.admin_logout(text) to anon, authenticated;

create or replace function public.assert_admin(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.admin_sessions
    where token = p_token and expires_at > now()
  ) then
    raise exception '请先登录管理后台';
  end if;
end;
$$;

create or replace function public.admin_stats(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  perform public.assert_admin(p_token);
  select
    count(*)::int as total,
    count(*) filter (where used_count = 0)::int as unused,
    count(*) filter (where used_count > 0 and used_count < max_uses)::int as partial,
    count(*) filter (where used_count >= max_uses)::int as exhausted,
    count(*) filter (where exported = false and used_count = 0)::int as ready_to_ship
  into r
  from public.passwords;
  return to_jsonb(r);
end;
$$;

grant execute on function public.admin_stats(text) to anon, authenticated;

create or replace function public.admin_list_passwords(
  p_token text,
  p_status text default null,
  p_batch_id text default null,
  p_exported text default null,
  p_q text default null,
  p_limit int default 200,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  items jsonb;
  total int;
begin
  perform public.assert_admin(p_token);

  with filtered as (
    select *
    from public.passwords
    where (p_batch_id is null or p_batch_id = '' or batch_id = p_batch_id)
      and (p_exported is null or p_exported = '' or (p_exported = '1' and exported = true) or (p_exported = '0' and exported = false))
      and (
        p_q is null or p_q = '' or
        code ilike '%' || upper(p_q) || '%' or coalesce(note,'') ilike '%' || p_q || '%'
      )
      and (
        p_status is null or p_status = '' or
        (p_status = 'unused' and used_count = 0) or
        (p_status = 'partial' and used_count > 0 and used_count < max_uses) or
        (p_status = 'exhausted' and used_count >= max_uses) or
        (p_status = 'available' and used_count < max_uses)
      )
  )
  select count(*)::int, coalesce(jsonb_agg(to_jsonb(t) order by created_at desc), '[]'::jsonb)
  into total, items
  from (
    select
      code,
      max_uses,
      used_count,
      greatest(max_uses - used_count, 0) as remaining,
      coalesce(batch_id,'') as batch_id,
      coalesce(note,'') as note,
      exported,
      exported_at,
      created_at,
      case
        when used_count >= max_uses then 'exhausted'
        when used_count = 0 then 'unused'
        else 'partial'
      end as status,
      case
        when used_count >= max_uses then '已用完'
        when used_count = 0 then '未使用'
        else '使用中'
      end as status_label
    from filtered
    order by created_at desc
    limit greatest(p_limit, 1)
    offset greatest(p_offset, 0)
  ) t;

  return jsonb_build_object('total', total, 'items', items, 'limit', p_limit, 'offset', p_offset);
end;
$$;

grant execute on function public.admin_list_passwords(text, text, text, text, text, int, int) to anon, authenticated;

create or replace function public.admin_batches(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  items jsonb;
begin
  perform public.assert_admin(p_token);
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into items
  from (
    select
      batch_id,
      count(*)::int as total,
      count(*) filter (where used_count = 0)::int as unused,
      count(*) filter (where used_count > 0 and used_count < max_uses)::int as partial,
      count(*) filter (where used_count >= max_uses)::int as exhausted,
      count(*) filter (where exported)::int as exported_count,
      max(created_at) as created_at,
      max(max_uses)::int as max_uses
    from public.passwords
    where batch_id is not null and batch_id <> ''
    group by batch_id
    order by max(created_at) desc
    limit 50
  ) t;
  return jsonb_build_object('items', items);
end;
$$;

grant execute on function public.admin_batches(text) to anon, authenticated;

create or replace function public.admin_generate(
  p_token text,
  p_count int,
  p_max_uses int default 3,
  p_prefix text default '',
  p_note text default '',
  p_code_length int default 8
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  batch text;
  codes text[] := '{}';
  code text;
  i int := 0;
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  body text;
  j int;
begin
  perform public.assert_admin(p_token);
  if p_count < 1 or p_count > 5000 then
    raise exception '单次生成数量需在 1–5000 之间';
  end if;
  if p_max_uses < 1 or p_max_uses > 99 then
    raise exception '可用次数需在 1–99 之间';
  end if;

  batch := to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || upper(substr(md5(random()::text), 1, 4));

  while i < p_count loop
    body := '';
    for j in 1..greatest(p_code_length, 6) loop
      body := body || substr(alphabet, 1 + floor(random()*36)::int, 1);
    end loop;
    code := upper(coalesce(nullif(trim(p_prefix), ''), '')) || body;
    begin
      insert into public.passwords(code, max_uses, used_count, batch_id, note, exported)
      values (code, p_max_uses, 0, batch, coalesce(p_note, ''), false);
      codes := array_append(codes, code);
      i := i + 1;
    exception when unique_violation then
      -- 重试
      null;
    end;
  end loop;

  return jsonb_build_object(
    'batch_id', batch,
    'count', p_count,
    'max_uses', p_max_uses,
    'codes', to_jsonb(codes)
  );
end;
$$;

grant execute on function public.admin_generate(text, int, int, text, text, int) to anon, authenticated;

create or replace function public.admin_export(
  p_token text,
  p_status text default 'unused',
  p_batch_id text default null,
  p_only_unexported boolean default true,
  p_mark_exported boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  codes text[];
begin
  perform public.assert_admin(p_token);

  select array_agg(code order by created_at desc) into codes
  from public.passwords
  where (p_batch_id is null or p_batch_id = '' or batch_id = p_batch_id)
    and (not p_only_unexported or exported = false)
    and (
      p_status is null or p_status = '' or
      (p_status = 'unused' and used_count = 0) or
      (p_status = 'partial' and used_count > 0 and used_count < max_uses) or
      (p_status = 'exhausted' and used_count >= max_uses) or
      (p_status = 'available' and used_count < max_uses)
    );

  codes := coalesce(codes, '{}');

  if p_mark_exported and array_length(codes, 1) is not null then
    update public.passwords
    set exported = true, exported_at = now()
    where code = any(codes);
  end if;

  return jsonb_build_object(
    'count', coalesce(array_length(codes, 1), 0),
    'codes', to_jsonb(codes),
    'batch_id', coalesce(p_batch_id, ''),
    'marked_exported', p_mark_exported and coalesce(array_length(codes, 1), 0) > 0
  );
end;
$$;

grant execute on function public.admin_export(text, text, text, boolean, boolean) to anon, authenticated;
