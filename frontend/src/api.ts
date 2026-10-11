import type { ResultPayload } from './types'

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

function apiEndpoint() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('未配置 Supabase：请设置 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY')
  }
  return `${SUPABASE_URL}/functions/v1/api`
}

async function callApi<T>(
  action: string,
  body: Record<string, unknown> = {},
  options?: { adminToken?: string; raw?: boolean },
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  }
  if (options?.adminToken) headers['x-admin-token'] = options.adminToken

  const res = await fetch(apiEndpoint(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...body }),
  })

  if (options?.raw) {
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.detail || '请求失败')
    }
    return (await res.text()) as T
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || data.message || '请求失败')
  return data as T
}

export function startTest(password: string) {
  return callApi<{ ok: boolean; token: string; remaining: number; message: string }>('start', {
    password,
  })
}

export function submitAnswers(token: string, answers: Record<string, string | number>) {
  return callApi<ResultPayload>('submit', { token, answers })
}

export function fetchResult(id: string) {
  return callApi<ResultPayload>('result', { id })
}

export function adminLogin(password: string) {
  return callApi<{ ok: boolean; token: string }>('admin_login', { password })
}

export function adminLogout(adminToken: string) {
  return callApi<{ ok: boolean }>('admin_logout', {}, { adminToken })
}

export function adminStats(adminToken: string) {
  return callApi<{
    total: number
    unused: number
    partial: number
    exhausted: number
    ready_to_ship: number
  }>('admin_stats', {}, { adminToken })
}

export function adminBatches(adminToken: string) {
  return callApi<{ items: Array<Record<string, unknown>> }>('admin_batches', {}, { adminToken })
}

export function adminList(
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
  return callApi<{ total: number; items: Array<Record<string, unknown>> }>('admin_list', params, {
    adminToken,
  })
}

export function adminGenerate(
  adminToken: string,
  body: {
    count: number
    max_uses: number
    prefix: string
    note: string
    code_length: number
  },
) {
  return callApi<{ batch_id: string; count: number; codes: string[] }>('admin_generate', body, {
    adminToken,
  })
}

export function adminExport(
  adminToken: string,
  body: {
    status: string
    batch_id: string | null
    only_unexported: boolean
    mark_exported: boolean
    format: 'txt' | 'csv' | 'json'
  },
) {
  return callApi<string>('admin_export', body, { adminToken, raw: body.format !== 'json' })
}

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
}
