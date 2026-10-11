-- 测评密码、会话、结果

create table if not exists public.passwords (
  code text primary key,
  max_uses integer not null default 3 check (max_uses >= 1),
  used_count integer not null default 0 check (used_count >= 0),
  created_at timestamptz not null default now(),
  batch_id text,
  note text,
  exported boolean not null default false,
  exported_at timestamptz
);

create table if not exists public.sessions (
  token text primary key,
  password_code text not null references public.passwords(code),
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.results (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_sessions (
  token text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists passwords_batch_id_idx on public.passwords(batch_id);
create index if not exists passwords_created_at_idx on public.passwords(created_at desc);
create index if not exists results_created_at_idx on public.results(created_at desc);

-- 关闭直接匿名读写，全部走 Edge Function（service role）
alter table public.passwords enable row level security;
alter table public.sessions enable row level security;
alter table public.results enable row level security;
alter table public.admin_sessions enable row level security;

-- 结果页可公开读取（分享链接）
create policy "Public can read results by id"
  on public.results
  for select
  to anon, authenticated
  using (true);

-- 预置演示密码
insert into public.passwords (code, max_uses, used_count, batch_id, note)
values
  ('DEMO001', 3, 0, 'SEED', '系统预置'),
  ('DEMO002', 3, 0, 'SEED', '系统预置'),
  ('TEST888', 3, 0, 'SEED', '系统预置'),
  ('LOVE2026', 3, 0, 'SEED', '系统预置'),
  ('KEKE001', 3, 0, 'SEED', '系统预置'),
  ('XINLI01', 3, 0, 'SEED', '系统预置'),
  ('CEPING1', 3, 0, 'SEED', '系统预置'),
  ('CEPING2', 3, 0, 'SEED', '系统预置')
on conflict (code) do nothing;

-- 原子扣减密码次数并创建会话
create or replace function public.consume_password(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(p_code));
  v_row public.passwords%rowtype;
  v_token text;
  v_remaining integer;
begin
  if v_code is null or v_code = '' then
    return jsonb_build_object('ok', false, 'message', '请输入密码');
  end if;

  select * into v_row
  from public.passwords
  where code = v_code
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', '密码无效');
  end if;

  v_remaining := v_row.max_uses - v_row.used_count;
  if v_remaining <= 0 then
    return jsonb_build_object('ok', false, 'message', '该密码次数已用完（最多 ' || v_row.max_uses || ' 次）');
  end if;

  update public.passwords
  set used_count = used_count + 1
  where code = v_code;

  v_token := replace(gen_random_uuid()::text, '-', '');
  insert into public.sessions(token, password_code, consumed)
  values (v_token, v_code, false);

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'remaining', v_remaining - 1,
    'message', '验证成功，本密码还可测 ' || (v_remaining - 1) || ' 次'
  );
end;
$$;

revoke all on function public.consume_password(text) from public;
grant execute on function public.consume_password(text) to service_role;
