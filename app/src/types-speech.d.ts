/**
 * Types du Web Speech API, que TypeScript ne fournit pas en standard.
 *
 * L'API est encore préfixée sur certains navigateurs (`webkitSpeechRecognition`) et absente de
 * Firefox : on la déclare nous-mêmes plutôt que de la manipuler en `any`, pour que le compilateur
 * vérifie nos usages (`rec.lang`, `e.results[i].isFinal`, …) au lieu de nous laisser deviner.
 */

interface SpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionResultList {
  readonly length: number
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}

interface SpeechRecognitionInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: Event) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type SpeechRecognitionConstructeur = new () => SpeechRecognitionInstance

interface Window {
  SpeechRecognition?: SpeechRecognitionConstructeur
  webkitSpeechRecognition?: SpeechRecognitionConstructeur
}
