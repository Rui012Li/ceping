import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  adminBatches,
  adminExport,
  adminGenerate,
  adminList,
  adminLogin,
  adminLogout,
  adminStats,
  isSupabaseConfigured,
} from '../api'

type Stats = {
  total: number
  unused: number
  partial: number
  exhausted: number
  ready_to_ship: number
}

type PasswordItem = {
  code: string
  max_uses: number
  used_count: number
  remaining: number
  batch_id: string
  note: string
  exported: boolean
  status: string
  status_label: string
  created_at: string
}

type BatchItem = {
  batch_id: string
  total: number
  unused: number
  partial: number
  exhausted: number
  exported_count: number
  created_at: string
  max_uses: number
}

const TOKEN_KEY = 'admin_token'

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function Admin() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [loginPwd, setLoginPwd] = useState('')
  const [loginError, setLoginError] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [batches, setBatches] = useState<BatchItem[]>([])
  const [items, setItems] = useState<PasswordItem[]>([])
  const [total, setTotal] = useState(0)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const [status, setStatus] = useState('unused')
  const [batchId, setBatchId] = useState('')
  const [exported, setExported] = useState('0')
  const [q, setQ] = useState('')

  const [genCount, setGenCount] = useState(50)
  const [genUses, setGenUses] = useState(3)
  const [genPrefix, setGenPrefix] = useState('KP')
  const [genNote, setGenNote] = useState('')
  const [lastBatch, setLastBatch] = useState<{ batch_id: string; codes: string[] } | null>(null)

  const logout = useCallback(() => {
    const t = localStorage.getItem(TOKEN_KEY)
    if (t) adminLogout(t).catch(() => undefined)
    localStorage.removeItem(TOKEN_KEY)
    setToken('')
  }, [])

  const refresh = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setMessage('')
    try {
      const [s, b, p] = await Promise.all([
        adminStats(token),
        adminBatches(token),
        adminList(token, {
          status,
          batch_id: batchId || undefined,
          exported: exported || undefined,
          q: q.trim() || undefined,
          limit: 200,
        }),
      ])
      setStats(s)
      setBatches(b.items as BatchItem[])
      setItems(p.items as PasswordItem[])
      setTotal(p.total)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载失败'
      if (msg.includes('登录')) {
        logout()
        return
      }
      setMessage(msg)
    } finally {
      setLoading(false)
    }
  }, [token, status, batchId, exported, q, logout])

  useEffect(() => {
    if (token) refresh()
  }, [token, refresh])

  const onLogin = async (e: FormEvent) => {
    e.preventDefault()
    setLoginError('')
    try {
      if (!isSupabaseConfigured()) {
        throw new Error('未配置 Supabase 环境变量')
      }
      const data = await adminLogin(loginPwd)
      localStorage.setItem(TOKEN_KEY, data.token)
      setToken(data.token)
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : '登录失败')
    }
  }

  const onGenerate = async (e: FormEvent) => {
    e.preventDefault()
    if (!token) return
    setMessage('')
    try {
      const data = await adminGenerate(token, {
        count: genCount,
        max_uses: genUses,
        prefix: genPrefix,
        note: genNote,
        code_length: 8,
      })
      setLastBatch({ batch_id: data.batch_id, codes: data.codes })
      setBatchId(data.batch_id)
      setStatus('unused')
      setExported('0')
      setMessage(`已生成 ${data.count} 个密码，批次 ${data.batch_id}`)
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '生成失败')
    }
  }

  const doExport = async (format: 'txt' | 'csv', markExported: boolean) => {
    if (!token) return
    setMessage('')
    try {
      const text = await adminExport(token, {
        status: status || 'unused',
        batch_id: batchId || null,
        only_unexported: exported === '0',
        mark_exported: markExported,
        format,
      })
      const count =
        format === 'csv'
          ? Math.max(0, text.trim().split('\n').filter(Boolean).length - 1)
          : text.split('\n').filter(Boolean).length
      if (!count) {
        setMessage('没有可导出的密码，请调整筛选条件')
        return
      }
      downloadBlob(
        `ceping-${batchId || 'all'}-${count}.${format}`,
        text,
        format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8',
      )
      setMessage(
        markExported
          ? `已导出 ${count} 条，并标记为已导出（适合自动发货）`
          : `已导出 ${count} 条（未标记）`,
      )
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '导出失败')
    }
  }

  const copyCodes = async () => {
    const codes = (lastBatch?.codes || items.map((i) => i.code)).join('\n')
    if (!codes) {
      setMessage('当前没有可复制的密码')
      return
    }
    await navigator.clipboard.writeText(codes)
    setMessage('已复制到剪贴板（一行一个，可直接贴进自动发货卡密库）')
  }

  const batchOptions = useMemo(
    () => batches.map((b) => ({ value: b.batch_id, label: `${b.batch_id}（${b.unused}/${b.total}未用）` })),
    [batches],
  )

  if (!token) {
    return (
      <div className="page admin-login">
        <div className="home-card">
          <p className="eyebrow">ADMIN</p>
          <h1>测评密码管理后台</h1>
          <p className="lead">批量生成、导出卡密，对接自动发货。</p>
          <form onSubmit={onLogin} className="password-form">
            <label htmlFor="admin-pwd">管理员密码</label>
            <input
              id="admin-pwd"
              type="password"
              value={loginPwd}
              onChange={(e) => setLoginPwd(e.target.value)}
              placeholder="请输入管理员密码"
            />
            {loginError && <p className="error">{loginError}</p>}
            <button className="btn primary block" type="submit">
              登录
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="page admin">
      <header className="admin-header">
        <div>
          <p className="eyebrow">ADMIN</p>
          <h1>密码管理后台</h1>
        </div>
        <div className="admin-header-actions">
          <a className="text-btn" href={`${import.meta.env.BASE_URL}`} rel="noreferrer">
            打开测评站
          </a>
          <button className="text-btn" type="button" onClick={logout}>
            退出
          </button>
        </div>
      </header>

      {stats && (
        <div className="stat-grid">
          <div className="stat">
            <b>{stats.total}</b>
            <span>全部</span>
          </div>
          <div className="stat">
            <b>{stats.unused}</b>
            <span>未使用</span>
          </div>
          <div className="stat">
            <b>{stats.ready_to_ship}</b>
            <span>可发货</span>
          </div>
          <div className="stat">
            <b>{stats.exhausted}</b>
            <span>已用完</span>
          </div>
        </div>
      )}

      <section className="admin-panel">
        <h2>批量生成</h2>
        <form className="gen-form" onSubmit={onGenerate}>
          <label>
            数量
            <input
              type="number"
              min={1}
              max={5000}
              value={genCount}
              onChange={(e) => setGenCount(Number(e.target.value))}
            />
          </label>
          <label>
            每码可用次数
            <input
              type="number"
              min={1}
              max={99}
              value={genUses}
              onChange={(e) => setGenUses(Number(e.target.value))}
            />
          </label>
          <label>
            前缀
            <input
              type="text"
              maxLength={12}
              value={genPrefix}
              onChange={(e) => setGenPrefix(e.target.value.toUpperCase())}
              placeholder="如 KP"
            />
          </label>
          <label className="span-2">
            备注
            <input
              type="text"
              value={genNote}
              onChange={(e) => setGenNote(e.target.value)}
              placeholder="如：闲鱼3.99自动发货-第3批"
            />
          </label>
          <button className="btn primary" type="submit">
            生成密码
          </button>
        </form>
        {lastBatch && (
          <div className="batch-tip">
            最近批次 <code>{lastBatch.batch_id}</code> · {lastBatch.codes.length} 个
            <button className="text-btn" type="button" onClick={copyCodes}>
              复制本批
            </button>
          </div>
        )}
      </section>

      <section className="admin-panel">
        <h2>筛选 / 导出（自动发货）</h2>
        <div className="filter-row">
          <label>
            状态
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="unused">未使用</option>
              <option value="available">仍可用</option>
              <option value="partial">使用中</option>
              <option value="exhausted">已用完</option>
              <option value="">全部</option>
            </select>
          </label>
          <label>
            导出标记
            <select value={exported} onChange={(e) => setExported(e.target.value)}>
              <option value="0">未导出</option>
              <option value="1">已导出</option>
              <option value="">全部</option>
            </select>
          </label>
          <label>
            批次
            <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="">全部批次</option>
              {batchOptions.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            搜索
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="密码/备注" />
          </label>
          <button className="btn ghost" type="button" onClick={refresh} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>

        <div className="export-actions">
          <button className="btn primary" type="button" onClick={() => doExport('txt', true)}>
            导出 TXT 并标记已导出
          </button>
          <button className="btn ghost" type="button" onClick={() => doExport('txt', false)}>
            导出 TXT（不标记）
          </button>
          <button className="btn ghost" type="button" onClick={() => doExport('csv', false)}>
            导出 CSV
          </button>
          <button className="btn ghost" type="button" onClick={copyCodes}>
            复制当前列表
          </button>
        </div>
        <p className="admin-help">
          推荐流程：生成一批 → 筛选该批次「未使用+未导出」→ 点「导出 TXT 并标记已导出」→
          把文件导入闲鱼/店铺自动发货卡密库（一行一个密码）。
        </p>
      </section>

      {message && <p className="admin-msg">{message}</p>}

      <section className="admin-panel">
        <h2>
          密码列表 <small>（{total}）</small>
        </h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>密码</th>
                <th>剩余</th>
                <th>状态</th>
                <th>批次</th>
                <th>导出</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.code}>
                  <td>
                    <code>{item.code}</code>
                  </td>
                  <td>
                    {item.remaining}/{item.max_uses}
                  </td>
                  <td>{item.status_label}</td>
                  <td className="mono">{item.batch_id}</td>
                  <td>{item.exported ? '已导出' : '未导出'}</td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan={5} className="empty">
                    暂无数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
