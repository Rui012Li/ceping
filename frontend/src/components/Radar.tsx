type Props = {
  data: Record<string, number>
}

export default function Radar({ data }: Props) {
  const entries = Object.entries(data)
  const n = entries.length
  const size = 260
  const cx = size / 2
  const cy = size / 2
  const maxR = 88

  const point = (i: number, value: number) => {
    const angle = (-Math.PI / 2) + (i * 2 * Math.PI) / n
    const r = (Math.max(0, Math.min(100, value)) / 100) * maxR
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const
  }

  const grid = [20, 40, 60, 80, 100].map((level) => {
    const pts = Array.from({ length: n }, (_, i) => point(i, level).join(',')).join(' ')
    return <polygon key={level} points={pts} className="radar-grid" />
  })

  const axis = entries.map((_, i) => {
    const [x, y] = point(i, 100)
    return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="radar-axis" />
  })

  const areaPts = entries.map(([, v], i) => point(i, v).join(',')).join(' ')

  const labels = entries.map(([label, value], i) => {
    const [x, y] = point(i, 118)
    return (
      <text key={label} x={x} y={y} className="radar-label">
        {label} {value}
      </text>
    )
  })

  return (
    <svg className="radar" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="弱点雷达图">
      {grid}
      {axis}
      <polygon points={areaPts} className="radar-area" />
      {entries.map(([, v], i) => {
        const [x, y] = point(i, v)
        return <circle key={i} cx={x} cy={y} r="3.5" className="radar-dot" />
      })}
      {labels}
    </svg>
  )
}
