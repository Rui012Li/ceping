import { useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import type { ResultPayload } from '../types'
import Radar from './Radar'

type Props = {
  result: ResultPayload
  onRetake: () => void
  showActions?: boolean
}

export default function ResultView({ result, onRetake, showActions = true }: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [saving, setSaving] = useState(false)
  const [tip, setTip] = useState('')

  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${base}/r/${result.id}`
      : `${base}/r/${result.id}`

  const showTip = (msg: string) => {
    setTip(msg)
    window.setTimeout(() => setTip(''), 2500)
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      showTip('链接已复制')
    } catch {
      const input = document.createElement('input')
      input.value = shareUrl
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      showTip('链接已复制')
    }
  }

  const handleSave = async () => {
    if (!cardRef.current || saving) return
    setSaving(true)
    try {
      // 等一帧，避免按钮态影响截图区域外的布局
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#0f1c2e',
      })
      const link = document.createElement('a')
      link.download = `情感弱点地图-${result.result_badge}-${result.id}.png`
      link.href = dataUrl
      link.click()
      showTip('长图已生成，请在下载中查看/保存到相册')
    } catch {
      showTip('保存失败，请截屏或换浏览器重试')
    } finally {
      setSaving(false)
    }
  }

  const { primary, secondary } = result

  return (
    <div className="page result-page">
      <div className="result-scroll">
        <div className="result-card" ref={cardRef} id="result-card">
          <div className="brand-row">
            <span className="brand">情感弱点地图</span>
            <span className="brand-sub">FIGURE ATLAS</span>
          </div>

          <p className="badge">{result.result_badge}</p>
          <h1 className="result-title">{primary.title}</h1>
          <p className="result-hook">{primary.hook}</p>

          <div className="tags">
            {primary.keywords.map((k) => (
              <span key={k} className="tag">
                {k}
              </span>
            ))}
          </div>

          <div className="panel">
            <h2>弱点雷达</h2>
            <Radar data={result.radar} />
          </div>

          {result.dual_weakness && (
            <div className="panel warn">
              <h2>双弱点体质</h2>
              <p>
                你在「{primary.name}」与「{secondary.name}」上都很突出，可能被两种人轮流拿捏。
              </p>
            </div>
          )}

          {!result.is_clear && result.secondary && (
            <div className="panel subtle">
              <h2>隐藏弱点</h2>
              <p>
                副类型：{secondary.name}（{secondary.short}）
              </p>
            </div>
          )}

          <div className="panel">
            <h2>克星画像</h2>
            <p>{primary.portrait}</p>
          </div>

          <div className="panel">
            <h2>为什么是你</h2>
            <p>{primary.why}</p>
          </div>

          <div className="panel">
            <h2>你会如何一步步栽进去</h2>
            <ol>
              {primary.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>

          <div className="panel">
            <h2>危险信号</h2>
            <ul>
              {primary.signals.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>

          <div className="panel">
            <h2>你能学到的新东西</h2>
            <p>{primary.learn}</p>
          </div>

          <div className="panel">
            <h2>破局三招</h2>
            <ol>
              {primary.tips.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>

          <p className="share-line">{primary.share}</p>
          <p className="disclaimer">{result.disclaimer}</p>
        </div>
      </div>

      {showActions && (
        <div className="action-bar">
          {tip && <div className="toast">{tip}</div>}
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            {saving ? '生成中…' : '保存测试结果'}
          </button>
          <button className="btn ghost" onClick={handleCopy}>
            复制结果链接
          </button>
          <button className="btn ghost" onClick={onRetake}>
            再测一次
          </button>
        </div>
      )}
    </div>
  )
}
