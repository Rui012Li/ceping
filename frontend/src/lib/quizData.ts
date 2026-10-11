import quiz from '../data/quiz.json'
import type { Question, ScaleOption } from '../types'

export const SCALE_OPTIONS = quiz.scale_options as ScaleOption[]
export const QUESTION_ORDER = quiz.question_order as number[]

const QUESTIONS = quiz.questions as Record<string, Question>

export function getOrderedQuestions(): Question[] {
  return QUESTION_ORDER.map((id) => QUESTIONS[String(id)])
}
