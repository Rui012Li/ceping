import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { fetchResult } from '../api'
import ResultView from '../components/ResultView'
import type { ResultPayload } from '../types'

export default function ResultPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const stateResult = (location.state as { result?: ResultPayload } | null)?.result
  const [result, setResult] = useState<ResultPayload | null>(stateResult || null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(!stateResult)

  useEffect(() => {
    if (stateResult || !id) return
    setLoading(true)
    fetchResult(id)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [id, stateResult])

  if (loading) {
    return (
      <div className="page center">
        <p>结果加载中…</p>
      </div>
    )
  }

  if (error || !result) {
    return (
      <div className="page center">
        <p className="error">{error || '结果不存在'}</p>
        <button className="btn primary" onClick={() => navigate('/')}>
          去测试
        </button>
      </div>
    )
  }

  return (
    <ResultView
      result={result}
      onRetake={() => {
        sessionStorage.removeItem('quiz_token')
        navigate('/')
      }}
    />
  )
}
