import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Mic, Send, Sparkles, Volume2, VolumeX, X } from '../components/icons'
import { Card } from '../components/ui'
import { assistantReply } from '../lib/assistant'
import type { AssistantAction } from '../lib/assistant'
import { DEMO_ONLY } from '../lib/config'
import type { CommandFn } from '../lib/ws'
import type { EcoWattState } from '../types'

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const CHAT_KEY = 'ecowatt-chat'

// En vitrine, le chat parle à une fonction serverless du MÊME domaine (`/api/chat`, ADR-015) : elle
// relaie vers Groq sans jamais exposer la clé ni pouvoir toucher une prise. En local, c'est le vrai
// backend Python, qui lui exécute les ordres sur le matériel.
const CHAT_URL = DEMO_ONLY ? '/api/chat' : `${API}/api/chat`

interface Msg {
  id: number
  role: 'user' | 'assistant'
  text: string
}

const WELCOME: Msg = {
  id: 0,
  role: 'assistant',
  text: "Bonjour ! Je pilote tes prises pour réduire le gaspillage. Pose-moi une question, demande-moi comment je fonctionne, ou donne-moi un ordre, à l'écrit ou à la voix.",
}

// Recharge la conversation sauvegardée (survit à la navigation, au refresh et à la fermeture).
function loadMsgs(): Msg[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length) return parsed as Msg[]
    }
  } catch {
    /* stockage indisponible */
  }
  return [WELCOME]
}

interface ChatResponse {
  reply?: string
  actions?: { action?: string; device_id?: string; priorite?: string }[] | null
}

// Appelle le backend /api/chat. En démo : on envoie les appareils du simulateur (contexte du LLM)
// et execute=false (le backend ne touche pas ses prises, c'est le simulateur qui exécute).
async function postChat(
  message: string,
  opts: { devices?: EcoWattState['devices']; execute: boolean; history?: { role: string; content: string }[] },
): Promise<ChatResponse> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        execute: opts.execute,
        ...(opts.devices
          ? { devices: opts.devices.map((d) => ({ id: d.id, nom: d.nom, priorite: d.priorite, etat: d.etat, conso_w: d.conso_w })) }
          : {}),
        ...(opts.history && opts.history.length ? { history: opts.history } : {}),
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error('backend')
    return (await res.json()) as ChatResponse
  } finally {
    clearTimeout(timer)
  }
}

// Traduit les actions renvoyées par le backend (device_id) en ordres pour le simulateur (noms).
function backendActions(data: ChatResponse, state: EcoWattState): AssistantAction[] {
  const list = Array.isArray(data.actions) ? data.actions : []
  const out: AssistantAction[] = []
  for (const a of list) {
    const dev = state.devices.find((d) => d.id === a.device_id)
    if (!dev) continue
    if (a.action === 'couper' || a.action === 'rallumer') {
      out.push({ nom: dev.nom, type: a.action })
    } else if (a.action === 'priorite' && (a.priorite === 'essentiel' || a.priorite === 'reportable' || a.priorite === 'confort')) {
      out.push({ nom: dev.nom, type: 'priorite', priorite: a.priorite })
    }
  }
  return out
}

const suggestions = [
  "C'est quoi EcoWatt ?",
  '1000 FCFA sur mon compteur : ventilateur 8h, télé 4h, 3 ampoules 5h, frigo. Ça dure ?',
  'Un appareil consomme-t-il anormalement ?',
  'Quel appareil consomme le plus ?',
  'Coupe la bouilloire',
]

// Reconnaissance vocale (navigateurs compatibles : Chrome, Edge ; absent sur Firefox)
const SR: SpeechRecognitionConstructeur | undefined =
  typeof window !== 'undefined' ? window.SpeechRecognition ?? window.webkitSpeechRecognition : undefined
const sttSupported = !!SR
const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

export function ChatPage({ state, demo, command }: { state: EcoWattState; demo: boolean; command: CommandFn }) {
  const [msgs, setMsgs] = useState<Msg[]>(loadMsgs)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [listening, setListening] = useState(false)
  // Lecture vocale activée par défaut ; le choix de l'utilisateur est mémorisé.
  const [speakOn, setSpeakOn] = useState(
    () => typeof localStorage === 'undefined' || localStorage.getItem('ecowatt-tts') !== 'off',
  )
  const endRef = useRef<HTMLDivElement>(null)
  const recRef = useRef<SpeechRecognitionInstance | null>(null)
  const silenceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const transcriptRef = useRef('')
  const nextId = useRef(msgs.reduce((mx, m) => Math.max(mx, m.id), 0) + 1)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, sending])

  // Sauvegarde la conversation à chaque changement.
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(msgs))
    } catch {
      /* stockage indisponible */
    }
  }, [msgs])

  const clearChat = () => {
    window.speechSynthesis?.cancel()
    nextId.current = 1
    setMsgs([WELCOME])
    try {
      localStorage.removeItem(CHAT_KEY)
    } catch {
      /* stockage indisponible */
    }
  }

  const speak = (text: string) => {
    if (!speakOn || !ttsSupported) return
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'fr-FR'
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  }

  const send = async (text: string) => {
    const clean = text.trim()
    if (!clean || sending) return
    setInput('')
    setMsgs((m) => [...m, { id: nextId.current++, role: 'user', text: clean }])
    setSending(true)

    // Base locale (règles) : repli si le backend est injoignable, et garantit les commandes
    // spéciales que le LLM ne gère pas (« éteins tout », diminutifs).
    const local = assistantReply(clean, state)
    let reply = local.reply
    // Mémoire : les échanges précédents (le message courant n'est pas encore dans `msgs`).
    const history = msgs.slice(-8).map((mm) => ({ role: mm.role, content: mm.text }))

    if (demo) {
      // Hybride : le LLM comprend l'ordre (y compris groupé, « allume les essentiels ») et renvoie
      // une action par appareil ; repli automatique sur les règles locales si le backend est absent.
      let actions: AssistantAction[] = local.actions

      // En vitrine, la fonction serverless sait discuter mais n'exécute rien : ce sont les règles
      // locales qui pilotent le simulateur. Laisser le LLM rédiger la réponse à un ordre reviendrait
      // à afficher un texte qui peut contredire l'action réellement effectuée (vu en test : « coupe la
      // bouilloire » → « si tu voulais la rallumer, je confirme »). Sur un ordre reconnu, la réponse
      // déterministe fait donc foi, et on n'appelle pas le modèle du tout : plus sûr, instantané, et
      // le quota gratuit reste pour les vraies questions.
      // Le LLM n'est PAS appelé si les règles locales ont reconnu un ordre OU donné une réponse
      // déterministe qui fait foi (`final`, ex. questions méta sur l'IA) : sûr, instantané, sans dérapage.
      const localFaitFoi = DEMO_ONLY && (local.actions.length > 0 || !!local.final)

      if (!localFaitFoi) {
        try {
          const data = await postChat(clean, { devices: state.devices, execute: false, history })
          if (data.reply) reply = data.reply
          const llm = backendActions(data, state)
          if (llm.length) actions = llm // en local, le backend propose des actions plus fines
        } catch {
          /* quota épuisé, fonction absente ou réseau coupé → réponse et actions locales conservées */
        }
      }
      for (const a of actions) command(a.nom, a.type, a.priorite)
    } else {
      // Mode réel : le backend exécute lui-même l'ordre sur les vraies prises.
      try {
        const data = await postChat(clean, { execute: true, history })
        if (data.reply) reply = data.reply
      } catch {
        /* repli sur la réponse locale déjà calculée */
      }
    }

    setMsgs((m) => [...m, { id: nextId.current++, role: 'assistant', text: reply }])
    setSending(false)
    speak(reply)
  }

  const startListening = () => {
    if (!SR || listening) return
    const rec = new SR()
    rec.lang = 'fr-FR'
    rec.continuous = true // ne s'arrête pas au premier silence
    rec.interimResults = true // aperçu en direct pendant qu'on parle
    rec.maxAlternatives = 1
    transcriptRef.current = ''
    setInput('')

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let finalTxt = ''
      let interim = ''
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) finalTxt += res[0].transcript
        else interim += res[0].transcript
      }
      const shown = (finalTxt + ' ' + interim).trim()
      transcriptRef.current = shown
      setInput(shown) // affiche en direct ce qui est compris
      // On considère la phrase finie après 2 s de silence -> on arrête (donc on envoie).
      clearTimeout(silenceRef.current)
      silenceRef.current = setTimeout(() => rec.stop(), 2000)
    }
    rec.onerror = () => {
      clearTimeout(silenceRef.current)
      setListening(false)
    }
    rec.onend = () => {
      clearTimeout(silenceRef.current)
      setListening(false)
      const text = transcriptRef.current.trim()
      transcriptRef.current = ''
      if (text) send(text)
    }
    recRef.current = rec
    setListening(true)
    rec.start()
  }

  const toggleSpeak = () => {
    setSpeakOn((v) => {
      if (v) window.speechSynthesis.cancel()
      localStorage.setItem('ecowatt-tts', v ? 'off' : 'on')
      return !v
    })
  }

  return (
    <Card interactive={false} className="flex h-[72vh] flex-col overflow-hidden p-0 lg:h-[calc(100vh-11rem)]">
      {/* Barre du haut */}
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-white">
            <Sparkles size={15} strokeWidth={2.4} />
          </div>
          <span className="font-display text-sm font-bold text-ink">Assistant EcoWatt</span>
        </div>
        <div className="flex items-center gap-2">
          {ttsSupported && (
            <button
              onClick={toggleSpeak}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-colors ${
                speakOn ? 'bg-accentsofttext-accenttext ring-accentline' : 'bg-surface2text-muted ring-line'
              }`}
            >
              {speakOn ? <Volume2 size={14} strokeWidth={2.4} /> : <VolumeX size={14} strokeWidth={2.4} />}
              Lecture vocale {speakOn ? 'activée' : 'désactivée'}
            </button>
          )}
          <button
            onClick={clearChat}
            title="Effacer la conversation"
            className="flex items-center gap-1.5 rounded-full bg-surface2 px-3 py-1.5 text-xs font-semibold text-muted ring-1 ring-line transition-colors hover:text-ink"
          >
            <X size={14} strokeWidth={2.4} />
            Effacer
          </button>
        </div>
      </div>

      {/* Fil de discussion */}
      <div className="flex-1 space-y-4 overflow-y-auto p-6">
        {msgs.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className={`flex items-end gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                msg.role === 'assistant'
                  ? 'bg-gradient-to-br from-brand-400 to-brand-600 text-white'
                  : 'bg-accentsoft font-display text-sm font-bold text-accenttext'
              }`}
            >
              {msg.role === 'assistant' ? <Sparkles size={17} strokeWidth={2.4} /> : 'K'}
            </div>
            <div
              className={`max-w-[75%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'assistant'
                  ? 'rounded-bl-sm bg-surface2text-ink ring-1 ring-line'
                  : 'rounded-br-sm bg-gradient-to-br from-brand-500 to-brand-600 text-white'
              }`}
            >
              {msg.text}
            </div>
          </motion.div>
        ))}
        {sending && (
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white">
              <Sparkles size={17} strokeWidth={2.4} />
            </div>
            <div className="flex gap-1 rounded-2xl rounded-bl-sm bg-surface2px-4 py-3 ring-1 ring-line">
              <Dot delay={0} /> <Dot delay={0.15} /> <Dot delay={0.3} />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Suggestions + saisie */}
      <div className="border-t border-line p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={sending}
              className="rounded-full bg-accentsoftpx-3 py-1.5 text-xs font-semibold text-accenttext ring-1 ring-accentline transition-colors hover:bg-accentsoft disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
          className="flex items-center gap-2"
        >
          {sttSupported && (
            <button
              type="button"
              onClick={listening ? () => recRef.current?.stop?.() : startListening}
              title="Dicter à la voix"
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ring-1 transition-colors ${
                listening ? 'animate-pulse bg-rose-500 text-white ring-rose-500' : 'bg-accentsofttext-accenttext ring-accentline hover:bg-accentsoft'
              }`}
            >
              <Mic size={19} strokeWidth={2.3} />
            </button>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={listening ? 'Je t\'écoute...' : 'Donne un ordre ou pose une question...'}
            className="flex-1 rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-accentline"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-[var(--shadow-lift)] transition-transform hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
          >
            <Send size={19} strokeWidth={2.3} />
          </button>
        </form>
        {!sttSupported && (
          <p className="mt-2 text-[11px] text-muted">
            La dictée vocale n'est pas supportée par ce navigateur (essaie Chrome ou Edge). La lecture à voix haute, elle, fonctionne.
          </p>
        )}
      </div>
    </Card>
  )
}

function Dot({ delay }: { delay: number }) {
  return (
    <motion.span
      className="h-2 w-2 rounded-full bg-brand-400"
      animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
      transition={{ duration: 0.9, repeat: Infinity, delay }}
    />
  )
}
