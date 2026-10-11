import { createClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabaseConfigured = Boolean(url && key)

export const supabase = supabaseConfigured
  ? createClient(url, key, { auth: { persistSession: false } })
  : null

export function rpcErrorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return '请求失败'
  const e = err as { message?: string; details?: string; hint?: string }
  return e.message || e.details || e.hint || '请求失败'
}
