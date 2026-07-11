import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from './chat.js'

/** Faux couple req/res, tel que Vercel les fournit à la fonction. */
function faireRes() {
  const res = { code: 0, corps: null, entetes: {} }
  res.status = (c) => ((res.code = c), res)
  res.json = (o) => ((res.corps = o), res)
  res.setHeader = (k, v) => (res.entetes[k] = v)
  return res
}

let ipSuivante = 0
/** Chaque test part d'une IP neuve : le compteur de débit est global au module. */
const faireReq = (body, method = 'POST') => ({
  method,
  headers: { 'x-forwarded-for': `10.1.0.${++ipSuivante}` },
  body,
})

const reponseGroq = (texte) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: texte } }] }),
})

describe('fonction serverless du chat vitrine', () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = 'cle-de-test'
    vi.stubGlobal('fetch', vi.fn(async () => reponseGroq('Bonjour, je suis EcoWatt.')))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('répond au message et ne renvoie JAMAIS d’action (aucune prise pilotable en ligne)', async () => {
    const res = faireRes()
    await handler(faireReq({ message: 'Bonjour' }), res)

    expect(res.code).toBe(200)
    expect(res.corps.reply).toBe('Bonjour, je suis EcoWatt.')
    expect(res.corps.actions).toEqual([])
    expect(res.entetes['Cache-Control']).toBe('no-store')
  })

  it('refuse toute méthode autre que POST', async () => {
    const res = faireRes()
    await handler(faireReq({ message: 'Bonjour' }, 'GET'), res)
    expect(res.code).toBe(405)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuse un message vide sans appeler le modèle', async () => {
    const res = faireRes()
    await handler(faireReq({ message: '   ' }), res)
    expect(res.code).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('annonce une IA non configurée quand la clé manque, plutôt que de planter', async () => {
    delete process.env.GROQ_API_KEY
    const res = faireRes()
    await handler(faireReq({ message: 'Bonjour' }), res)
    expect(res.code).toBe(503)
  })

  it('passe au modèle suivant quand le quota du premier est épuisé', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce(reponseGroq('Réponse du modèle de secours.')),
    )

    const res = faireRes()
    await handler(faireReq({ message: 'Bonjour' }), res)

    expect(res.code).toBe(200)
    expect(res.corps.reply).toBe('Réponse du modèle de secours.')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('renvoie une erreur franche quand tous les modèles sont indisponibles (le front replie en local)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 })))

    const res = faireRes()
    await handler(faireReq({ message: 'Bonjour' }), res)

    expect(res.code).toBe(502)
    expect(fetch).toHaveBeenCalledTimes(5) // les cinq modèles de la cascade ont été tentés
  })

  it('traite une réponse vide du modèle comme un échec et bascule', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(reponseGroq('   ')).mockResolvedValueOnce(reponseGroq('Vraie réponse.')),
    )

    const res = faireRes()
    await handler(faireReq({ message: 'Bonjour' }), res)
    expect(res.corps.reply).toBe('Vraie réponse.')
  })

  it('limite le débit par IP : cet endpoint public ne doit pas devenir un LLM gratuit', async () => {
    const ip = '10.9.9.9'
    let refuses = 0
    for (let i = 0; i < 25; i++) {
      const res = faireRes()
      await handler({ method: 'POST', headers: { 'x-forwarded-for': ip }, body: { message: 'test' } }, res)
      if (res.code === 429) refuses++
    }
    expect(refuses).toBeGreaterThan(0)
  })

  it('borne le message, l’historique et les appareils envoyés au modèle', async () => {
    const res = faireRes()
    await handler(
      faireReq({
        message: 'a'.repeat(900),
        history: Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `tour ${i}` })),
        devices: Array.from({ length: 30 }, (_, i) => ({ nom: `App ${i}`, etat: 'on', conso_w: 10, priorite: 'confort' })),
      }),
      res,
    )

    expect(res.code).toBe(200)
    const envoye = JSON.parse(fetch.mock.calls[0][1].body)
    const dernier = envoye.messages.at(-1)

    expect(dernier.content).toHaveLength(500) // message tronqué
    expect(envoye.messages.filter((m) => m.role !== 'system')).toHaveLength(7) // 6 tours + message courant
    expect(envoye.messages[0].content.match(/^- App /gm) ?? []).toHaveLength(12) // appareils plafonnés
  })

  it('injecte l’état réel du foyer dans le prompt, pour que le modèle ne l’invente pas', async () => {
    const res = faireRes()
    await handler(
      faireReq({
        message: 'Quel appareil consomme le plus ?',
        devices: [{ nom: 'Réfrigérateur', etat: 'on', conso_w: 138.4, priorite: 'essentiel' }],
      }),
      res,
    )

    const systeme = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content
    expect(systeme).toContain('Réfrigérateur : 138 W (essentiel)')
    expect(systeme).toContain('TUTOYANT')
  })

  it('transmet la clé en en-tête d’autorisation, jamais dans le corps', async () => {
    const res = faireRes()
    await handler(faireReq({ message: 'Bonjour' }), res)

    const [, options] = fetch.mock.calls[0]
    expect(options.headers.Authorization).toBe('Bearer cle-de-test')
    expect(options.body).not.toContain('cle-de-test')
  })
})
