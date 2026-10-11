export type ScaleOption = { value: number; label: string }

export type Question =
  | {
      id: number
      type: 'scale'
      dimension: string
      text: string
    }
  | {
      id: number
      type: 'choice'
      text: string
      options: { key: string; label: string }[]
    }

export type TypeResult = {
  code: string
  name: string
  short: string
  title: string
  hook: string
  keywords: string[]
  portrait: string
  why: string
  steps: string[]
  signals: string[]
  learn: string
  tips: string[]
  share: string
}

export type ResultPayload = {
  id: string
  result_badge: string
  is_clear: boolean
  dual_weakness: boolean
  primary: TypeResult
  secondary: TypeResult
  scores: Record<string, number>
  radar: Record<string, number>
  disclaimer: string
}
