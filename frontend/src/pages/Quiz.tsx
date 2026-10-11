import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { submitAnswers } from '../api'
import { getOrderedQuestions, SCALE_OPTIONS } from '../lib/quizData'

export default function Quiz() {
  const navigate = useNavigate()
  const token = sessionStorage.getItem('quiz_token') || ''
  const remaining = sessionStorage.getItem('quiz_remaining')
  const questions = useMemo(() => getOrderedQuestions(), [])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string | number>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  if (!token) {
    navigate('/', { replace: true })
    return null
  }

  const current = questions[index]
  const progress = questions.length ? Math.round(((index + 1) / questions.length) * 100) : 0

  const selectAnswer = async (value: string | number) => {
    if (!current || submitting) return
    const nextAnswers = { ...answers, [String(current.id)]: value }
    setAnswers(nextAnswers)

    if (index < questions.length - 1) {
      setIndex(index + 1)
      return
    }

    setSubmitting(true)
    setError('')
    try {
      const result = await submitAnswers(token, nextAnswers)
      sessionStorage.removeItem('quiz_token')
      navigate(`/r/${result.id}`, { state: { result } })
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败')
      setSubmitting(false)
    }
  }

  if (!current) {
    return (
      <div className="page center">
        <p className="error">暂无题目</p>
        <button className="btn primary" onClick={() => navigate('/')}>
          返回首页
        </button>
      </div>
    )
  }

  return (
    <div className="page quiz">
      <header className="quiz-header">
        <button
          className="text-btn"
          type="button"
          disabled={index === 0 || submitting}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          上一题
        </button>
        <span>
          {index + 1} / {questions.length}
        </span>
        <button className="text-btn" type="button" onClick={() => navigate('/')}>
          退出
        </button>
      </header>

      <div className="progress">
        <div className="progress-bar" style={{ width: `${progress}%` }} />
      </div>

      <div className="quiz-body">
        {remaining !== null && index === 0 && (
          <p className="hint" style={{ textAlign: 'left', marginBottom: 12 }}>
            本密码剩余可测次数：{remaining}
          </p>
        )}
        <p className="q-label">第 {index + 1} 题</p>
        <h2 className="q-text">{current.text}</h2>

        <div className="options">
          {current.type === 'scale' &&
            SCALE_OPTIONS.map((opt) => {
              const selected = answers[String(current.id)] === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`option ${selected ? 'selected' : ''}`}
                  disabled={submitting}
                  onClick={() => selectAnswer(opt.value)}
                >
                  {opt.label}
                </button>
              )
            })}

          {current.type === 'choice' &&
            current.options.map((opt) => {
              const selected = answers[String(current.id)] === opt.key
              return (
                <button
                  key={opt.key}
                  type="button"
                  className={`option choice ${selected ? 'selected' : ''}`}
                  disabled={submitting}
                  onClick={() => selectAnswer(opt.key)}
                >
                  {opt.label}
                </button>
              )
            })}
        </div>

        {submitting && <p className="hint">正在生成你的弱点地图…</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}
