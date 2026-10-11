import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { isSupabaseConfigured, startTest } from '../api'

export default function Home() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await startTest(password.trim())
      sessionStorage.setItem('quiz_token', data.token)
      sessionStorage.setItem('quiz_remaining', String(data.remaining))
      navigate('/quiz')
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page home">
      <div className="home-bg" />
      <div className="home-card">
        <p className="eyebrow">FIGURE ATLAS · 情感弱点地图</p>
        <h1>测测你这辈子最容易栽在哪种人手里</h1>
        <p className="lead">
          不是你挑人眼光差，是有一种人专门克你。约 4 分钟，15 题，画出你的弱点地图。
        </p>
        <ul className="bullets">
          <li>每个密码可测 3 次</li>
          <li>完成后可保存长图、分享结果链接</li>
          <li>支持返回上一题修改答案</li>
        </ul>
        {!isSupabaseConfigured() && (
          <p className="error">站点尚未配置云端服务，请完成 Supabase 环境变量后再使用。</p>
        )}
        <form onSubmit={onSubmit} className="password-form">
          <label htmlFor="pwd">请输入测评密码</label>
          <input
            id="pwd"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="输入密码开始测试"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="error">{error}</p>}
          <button className="btn primary block" type="submit" disabled={loading || !password.trim()}>
            {loading ? '验证中…' : '开始测试'}
          </button>
        </form>
      </div>
    </div>
  )
}
