import { corsHeaders, json, text } from "../_shared/cors.ts"
import { scoreAnswers } from "../_shared/scoring.ts"
import { serviceClient } from "../_shared/supabase.ts"

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

function randomToken(bytes = 24) {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("")
}

function randomCode(prefix: string, length: number) {
  let body = ""
  const arr = new Uint8Array(length)
  crypto.getRandomValues(arr)
  for (let i = 0; i < length; i++) body += CODE_ALPHABET[arr[i] % CODE_ALPHABET.length]
  const p = (prefix || "").trim().toUpperCase()
  return p ? `${p}${body}` : body
}

function rowPassword(row: Record<string, unknown>) {
  const maxUses = Number(row.max_uses)
  const used = Number(row.used_count)
  const remaining = maxUses - used
  let status = "partial"
  let status_label = "使用中"
  if (remaining <= 0) {
    status = "exhausted"
    status_label = "已用完"
  } else if (used === 0) {
    status = "unused"
    status_label = "未使用"
  }
  return {
    code: row.code,
    max_uses: maxUses,
    used_count: used,
    remaining: Math.max(0, remaining),
    batch_id: row.batch_id || "",
    note: row.note || "",
    exported: Boolean(row.exported),
    exported_at: row.exported_at,
    created_at: row.created_at,
    status,
    status_label,
  }
}

async function requireAdmin(req: Request) {
  const token = req.headers.get("x-admin-token") || ""
  if (!token) return null
  const sb = serviceClient()
  const { data } = await sb
    .from("admin_sessions")
    .select("token, expires_at")
    .eq("token", token)
    .maybeSingle()
  if (!data) return null
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await sb.from("admin_sessions").delete().eq("token", token)
    return null
  }
  return token
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const body = req.method === "POST" ? await req.json() : {}
    const action = String(body.action || "")
    const sb = serviceClient()

    if (action === "start") {
      const password = String(body.password || "")
      const { data, error } = await sb.rpc("consume_password", { p_code: password })
      if (error) throw error
      if (!data?.ok) return json({ detail: data?.message || "验证失败" }, 400)
      return json(data)
    }

    if (action === "submit") {
      const token = String(body.token || "")
      const answers = body.answers || {}
      if (!token) return json({ detail: "缺少会话" }, 401)

      const { data: session } = await sb
        .from("sessions")
        .select("token, consumed")
        .eq("token", token)
        .maybeSingle()
      if (!session || session.consumed) {
        return json({ detail: "会话无效或已提交，请重新输入密码" }, 401)
      }

      let scored
      try {
        scored = scoreAnswers(answers)
      } catch (e) {
        return json({ detail: e instanceof Error ? e.message : "答案无效" }, 400)
      }

      const { data: updated, error: upErr } = await sb
        .from("sessions")
        .update({ consumed: true })
        .eq("token", token)
        .eq("consumed", false)
        .select("token")
        .maybeSingle()
      if (upErr) throw upErr
      if (!updated) return json({ detail: "会话无效或已提交，请重新输入密码" }, 401)

      const id = randomToken(6)
      const payload = { ...scored, id }
      const { error: insErr } = await sb.from("results").insert({ id, payload })
      if (insErr) throw insErr
      return json(payload)
    }

    if (action === "result") {
      const id = String(body.id || "")
      const { data, error } = await sb.from("results").select("payload").eq("id", id).maybeSingle()
      if (error) throw error
      if (!data) return json({ detail: "结果不存在" }, 404)
      return json({ ...data.payload, id })
    }

    if (action === "admin_login") {
      const adminPassword = Deno.env.get("ADMIN_PASSWORD") || "admin888"
      if (String(body.password || "") !== adminPassword) {
        return json({ detail: "管理员密码错误" }, 401)
      }
      const token = randomToken(24)
      const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()
      const { error } = await sb.from("admin_sessions").insert({ token, expires_at: expires })
      if (error) throw error
      return json({ ok: true, token })
    }

    if (action === "admin_logout") {
      const token = await requireAdmin(req)
      if (token) await sb.from("admin_sessions").delete().eq("token", token)
      return json({ ok: true })
    }

    // 以下管理接口需登录
    const adminActions = new Set([
      "admin_stats",
      "admin_batches",
      "admin_list",
      "admin_generate",
      "admin_export",
      "admin_delete",
    ])
    if (adminActions.has(action)) {
      const adminToken = await requireAdmin(req)
      if (!adminToken) return json({ detail: "请先登录管理后台" }, 401)
    }

    if (action === "admin_stats") {
      const { data, error } = await sb.from("passwords").select("max_uses, used_count, exported")
      if (error) throw error
      const rows = data || []
      const stats = {
        total: rows.length,
        unused: 0,
        partial: 0,
        exhausted: 0,
        ready_to_ship: 0,
      }
      for (const r of rows) {
        if (r.used_count <= 0) {
          stats.unused++
          if (!r.exported) stats.ready_to_ship++
        } else if (r.used_count >= r.max_uses) stats.exhausted++
        else stats.partial++
      }
      return json(stats)
    }

    if (action === "admin_batches") {
      const { data, error } = await sb
        .from("passwords")
        .select("batch_id, max_uses, used_count, exported, created_at")
        .not("batch_id", "is", null)
        .order("created_at", { ascending: false })
      if (error) throw error
      const map = new Map<string, Record<string, unknown>>()
      for (const r of data || []) {
        const id = r.batch_id || ""
        if (!id) continue
        if (!map.has(id)) {
          map.set(id, {
            batch_id: id,
            total: 0,
            unused: 0,
            partial: 0,
            exhausted: 0,
            exported_count: 0,
            created_at: r.created_at,
            max_uses: r.max_uses,
          })
        }
        const b = map.get(id)!
        b.total = Number(b.total) + 1
        if (r.used_count <= 0) b.unused = Number(b.unused) + 1
        else if (r.used_count >= r.max_uses) b.exhausted = Number(b.exhausted) + 1
        else b.partial = Number(b.partial) + 1
        if (r.exported) b.exported_count = Number(b.exported_count) + 1
        if (String(r.created_at) > String(b.created_at)) b.created_at = r.created_at
      }
      return json({ items: Array.from(map.values()).slice(0, 50) })
    }

    if (action === "admin_list") {
      let query = sb.from("passwords").select("*").order("created_at", { ascending: false })
      const status = body.status as string | undefined
      const batchId = body.batch_id as string | undefined
      const exported = body.exported as string | undefined
      const q = body.q as string | undefined
      const limit = Math.min(Number(body.limit || 200), 1000)
      const offset = Number(body.offset || 0)

      if (batchId) query = query.eq("batch_id", batchId)
      if (exported === "1") query = query.eq("exported", true)
      if (exported === "0") query = query.eq("exported", false)
      if (q) query = query.or(`code.ilike.%${q}%,note.ilike.%${q}%`)

      const { data, error } = await query.range(offset, offset + limit - 1)
      if (error) throw error
      let items = (data || []).map((r) => rowPassword(r as Record<string, unknown>))
      if (status === "unused") items = items.filter((i) => i.status === "unused")
      if (status === "partial") items = items.filter((i) => i.status === "partial")
      if (status === "exhausted") items = items.filter((i) => i.status === "exhausted")
      if (status === "available") items = items.filter((i) => i.remaining > 0)
      return json({ total: items.length, items, limit, offset })
    }

    if (action === "admin_generate") {
      const count = Number(body.count || 0)
      const maxUses = Number(body.max_uses || 3)
      const prefix = String(body.prefix || "")
      const note = String(body.note || "")
      const codeLength = Number(body.code_length || 8)
      if (count < 1 || count > 5000) return json({ detail: "单次生成数量需在 1–5000 之间" }, 400)
      if (maxUses < 1 || maxUses > 99) return json({ detail: "可用次数需在 1–99 之间" }, 400)

      const now = new Date()
      const batchId =
        `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-` +
        `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}-` +
        randomToken(2).toUpperCase()

      const codes: string[] = []
      const rows: Record<string, unknown>[] = []
      let attempts = 0
      while (codes.length < count) {
        attempts++
        if (attempts > count * 50) return json({ detail: "生成冲突过多，请换前缀后重试" }, 400)
        const code = randomCode(prefix, codeLength)
        if (codes.includes(code)) continue
        codes.push(code)
        rows.push({
          code,
          max_uses: maxUses,
          used_count: 0,
          batch_id: batchId,
          note,
          exported: false,
        })
      }
      const { error } = await sb.from("passwords").insert(rows)
      if (error) throw error
      return json({ batch_id: batchId, count: codes.length, max_uses: maxUses, codes })
    }

    if (action === "admin_export") {
      const status = String(body.status || "unused")
      const batchId = body.batch_id ? String(body.batch_id) : ""
      const onlyUnexported = body.only_unexported !== false
      const markExported = Boolean(body.mark_exported)
      const format = String(body.format || "txt")

      let query = sb.from("passwords").select("*").order("created_at", { ascending: false }).limit(10000)
      if (batchId) query = query.eq("batch_id", batchId)
      if (onlyUnexported) query = query.eq("exported", false)
      const { data, error } = await query
      if (error) throw error

      let items = (data || []).map((r) => rowPassword(r as Record<string, unknown>))
      if (status === "unused") items = items.filter((i) => i.status === "unused")
      else if (status === "partial") items = items.filter((i) => i.status === "partial")
      else if (status === "exhausted") items = items.filter((i) => i.status === "exhausted")
      else if (status === "available") items = items.filter((i) => i.remaining > 0)

      const codes = items.map((i) => i.code)
      if (markExported && codes.length) {
        const exportedAt = new Date().toISOString()
        const { error: upErr } = await sb
          .from("passwords")
          .update({ exported: true, exported_at: exportedAt })
          .in("code", codes)
        if (upErr) throw upErr
      }

      if (format === "json") {
        return json({
          count: codes.length,
          codes,
          batch_id: batchId,
          marked_exported: markExported && codes.length > 0,
        })
      }
      if (format === "csv") {
        const csv = ["code,batch_id", ...codes.map((c) => `${c},${batchId}`)].join("\n") + "\n"
        return text(csv, 200, {
          "Content-Disposition": `attachment; filename="ceping-codes-${codes.length}.csv"`,
        })
      }
      const txt = codes.join("\n") + (codes.length ? "\n" : "")
      return text(txt, 200, {
        "Content-Disposition": `attachment; filename="ceping-codes-${codes.length}.txt"`,
        "X-Export-Count": String(codes.length),
      })
    }

    if (action === "admin_delete") {
      const codes = (body.codes || []).map((c: string) => String(c).trim().toUpperCase()).filter(Boolean)
      if (!codes.length) return json({ ok: true, deleted: 0 })
      const { data, error } = await sb
        .from("passwords")
        .delete()
        .in("code", codes)
        .eq("used_count", 0)
        .select("code")
      if (error) throw error
      return json({ ok: true, deleted: (data || []).length })
    }

    return json({ detail: `未知 action: ${action}` }, 400)
  } catch (e) {
    console.error(e)
    return json({ detail: e instanceof Error ? e.message : "服务器错误" }, 500)
  }
})
