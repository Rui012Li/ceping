type Answers = Record<string, string | number>

const quiz = JSON.parse(
  Deno.readTextFileSync(new URL("./quiz.json", import.meta.url)),
) as {
  type_meta: Record<string, Record<string, unknown>>
  questions: Record<string, { dimension?: string }>
}

const TYPE_META = quiz.type_meta
const QUESTIONS = quiz.questions

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

export function scoreAnswers(answers: Answers) {
  const dims: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 }

  for (let qid = 1; qid <= 12; qid++) {
    const q = QUESTIONS[String(qid)]
    const raw = answers[String(qid)] ?? answers[qid as unknown as string]
    if (raw === undefined || raw === null) throw new Error(`缺少第 ${qid} 题答案`)
    const val = Number(raw)
    if (![1, 2, 3, 4].includes(val)) throw new Error(`第 ${qid} 题答案无效`)
    dims[q.dimension as string] += val
  }

  for (const qid of [13, 14, 15]) {
    const raw = answers[String(qid)] ?? answers[qid as unknown as string]
    if (raw === undefined || raw === null) throw new Error(`缺少第 ${qid} 题答案`)
    const key = String(raw).toUpperCase()
    if (!(key in dims)) throw new Error(`第 ${qid} 题答案无效`)
    dims[key] = Math.min(10, dims[key] + 2)
  }

  const percents: Record<string, number> = {}
  for (const [k, v] of Object.entries(dims)) {
    percents[k] = Math.round(clamp((v - 2) / 8 * 100, 0, 100))
  }

  const ranked = Object.entries(percents).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const [primaryCode, primaryScore] = ranked[0]
  const [secondaryCode, secondaryScore] = ranked[1]
  const isClear = primaryScore < 40
  const dual = !isClear && primaryScore - secondaryScore <= 10

  const primary = structuredClone(TYPE_META[primaryCode]) as Record<string, unknown>
  const secondary = structuredClone(TYPE_META[secondaryCode]) as Record<string, unknown>

  let resultBadge = primary.name as string
  if (isClear) {
    primary.title = `你整体边界尚可，若要破防，最可能从「${primary.name}」打开`
    primary.hook = `清醒不是免疫。压力大、孤独久时，弱点仍可能被放大。${primary.hook}`
    resultBadge = "相对清醒型"
  }

  return {
    result_badge: resultBadge,
    is_clear: isClear,
    dual_weakness: dual,
    primary,
    secondary,
    scores: percents,
    raw_scores: dims,
    radar: {
      拯救欲: percents.A,
      甜度成瘾: percents.B,
      边界厚度: 100 - percents.C,
      刺激渴求: percents.D,
      自我坚定: Math.round(((100 - percents.E) + (100 - percents.F)) / 2),
    },
    disclaimer: "本测评用于自我觉察与趣味参考，不构成心理咨询、诊断或医疗建议。",
  }
}
