import type { ResultPayload } from './types'
import { scoreAnswers } from './lib/scoring'
import { rpcErrorMessage, supabase, supabaseConfigured } from './lib/supabase'

function requireClient() {
  if (!supabase) throw new Error('未配置 Supabase：请设置 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY')
  return supabase
}

export function isSupabaseConfigured() {
  return supabaseConfigured
}

export async function startTest(password: string) {
  const client = requireClient()
  const { data, error } = await client.rpc('consume_password', { p_code: password })
  if (error) throw new Error(rpcErrorMessage(error))
  if (!data?.ok) throw new Error(data?.message || '验证失败')
  return data as { ok: boolean; token: string; remaining: number; message: string }
}

export async function submitAnswers(token: string, answers: Record<string, string | number>) {
  const client = requireClient()
  const scored = scoreAnswers(answers)
  const { data, error } = await client.rpc('submit_result', {
    p_token: token,
    p_payload: scored,
  })
  if (error) throw new Error(rpcErrorMessage(error))
  return data as ResultPayload
}

export async function fetchResult(id: string) {
  const client = requireClient()
  const { data, error } = await client.rpc('get_result', { p_id: id })
  if (error) throw new Error(rpcErrorMessage(error))
  return data as ResultPayload
}

export async function adminLogin(password: string) {
  const client = requireClient()
  const { data, error } = await client.rpc('admin_login', { p_password: password })
  if (error) throw new Error(rpcErrorMessage(error))
  return data as { ok: boolean; token: string }
}

export async function adminLogout(adminToken: string) {
  const client = requireClient()
  const { error } = await client.rpc('admin_logout', { p_token: adminToken })
  if (error) throw new Error(rpcErrorMessage(error))
  return { ok: true }
}

export async function adminStats(adminToken: string) {
  const client = requireClient()
  const { data, error } = await client.rpc('admin_stats', { p_token: adminToken })
  if (error) throw new Error(rpcErrorMessage(error))
  return data as {
    total: number
    unused: number
    partial: number
    exhausted: number
    ready_to_ship: number
  }
}

export async function adminBatches(adminToken: string) {
  const client = requireClient()
  const { data, error } = await client.rpc('admin_batches', { p_token: adminToken })
  if (error) throw new Error(rpcErrorMessage(error))
  return data as { items: Array<Record<string, unknown>> }
}

export async function adminList(
  adminToken: string,
  params: {
    status?: string
    batch_id?: string
    exported?: string
    q?: string
    limit?: number
    offset?: number
  },
) {
  const client = requireClient()
  const { data, error } = await client.rpc('admin_list_passwords', {
    p_token: adminToken,
    p_status: params.status ?? null,
    p_batch_id: params.batch_id ?? null,
    p_exported: params.exported ?? null,
    p_q: params.q ?? null,
    p_limit: params.limit ?? 200,
    p_offset: params.offset ?? 0,
  })
  if (error) throw new Error(rpcErrorMessage(error))
  return data as { total: number; items: Array<Record<string, unknown>> }
}

export async function adminGenerate(
  adminToken: string,
  body: {
    count: number
    max_uses: number
    prefix: string
    note: string
    code_length: number
  },
) {
  const client = requireClient()
  const { data, error } = await client.rpc('admin_generate', {
    p_token: adminToken,
    p_count: body.count,
    p_max_uses: body.max_uses,
    p_prefix: body.prefix,
    p_note: body.note,
    p_code_length: body.code_length,
  })
  if (error) throw new Error(rpcErrorMessage(error))
  return data as { batch_id: string; count: number; codes: string[] }
}

export async function adminExport(
  adminToken: string,
  body: {
    status: string
    batch_id: string | null
    only_unexported: boolean
    mark_exported: boolean
    format: 'txt' | 'csv' | 'json'
  },
) {
  const client = requireClient()
  const { data, error } = await client.rpc('admin_export', {
    p_token: adminToken,
    p_status: body.status,
    p_batch_id: body.batch_id,
    p_only_unexported: body.only_unexported,
    p_mark_exported: body.mark_exported,
  })
  if (error) throw new Error(rpcErrorMessage(error))
  const payload = data as { count: number; codes: string[]; batch_id: string }
  const codes = payload.codes || []
  if (body.format === 'json') return JSON.stringify(payload)
  if (body.format === 'csv') {
    return ['code,batch_id', ...codes.map((c) => `${c},${payload.batch_id || ''}`)].join('\n') + '\n'
  }
  return codes.join('\n') + (codes.length ? '\n' : '')
}
