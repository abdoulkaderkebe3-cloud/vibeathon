/**
 * Service worker EcoWatt (ADR-013).
 *
 * Objectif : que l'app s'ouvre même sans réseau. Le mode démo tourne entièrement dans le navigateur
 * (simulateur + assistant de repli en local), donc une fois les fichiers en cache, EcoWatt est
 * pleinement utilisable hors connexion. Utile ici : forfaits data limités, coupures, réseau saturé.
 *
 * Stratégies, choisies pour ne JAMAIS servir une version périmée pendant une démo :
 *  - navigation (index.html) : réseau d'abord, cache en secours. Une mise en ligne est vue tout de suite.
 *  - assets buildés (/assets/*, nom haché) : cache d'abord. Leur contenu ne change jamais à URL égale.
 *  - backend et WebSocket (autre origine) : jamais interceptés. Un ordre au relais ne doit pas
 *    pouvoir être servi depuis un cache.
 */

const VERSION = 'ecowatt-v1'
const SOCLE = ['/favicon.svg', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

/**
 * `caches.match` honore l'en-tête `Vary` par défaut. Les scripts émis par Vite sont demandés en
 * `crossorigin`, et le serveur répond avec un `Vary` : la requête du rechargement ne correspondait
 * alors plus à celle stockée, le cache renvoyait `undefined`, et hors-ligne la page restait blanche
 * (constaté en test). Nos assets sont hachés : à URL égale le contenu est identique, aucune
 * variation n'a de sens ici.
 */
const CORRESPONDANCE = { ignoreVary: true }

/**
 * Précache le nécessaire au démarrage hors-ligne.
 *
 * Piège vérifié en test : les scripts de la toute première visite sont chargés AVANT que ce worker
 * prenne le contrôle, donc `fetch` ne les voit pas et ils n'entrent jamais en cache. Au rechargement
 * sans réseau, l'index se servait du cache mais ses scripts manquaient : page blanche. On lit donc
 * l'index à l'installation pour en extraire ses assets (leurs noms sont hachés au build, on ne peut
 * pas les écrire en dur), puis le CSS pour en extraire les polices.
 */
async function precacher() {
  const cache = await caches.open(VERSION)
  await Promise.allSettled(SOCLE.map((u) => cache.add(u)))

  const reponse = await fetch('/', { cache: 'reload' })
  await cache.put('/', reponse.clone())
  const html = await reponse.text()

  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])
  await Promise.allSettled(assets.map((u) => cache.add(u)))

  for (const feuille of assets.filter((u) => u.endsWith('.css'))) {
    const css = await cache.match(feuille, CORRESPONDANCE).then((r) => (r ? r.text() : ''))
    const polices = [...css.matchAll(/url\((\/assets\/[^)]+\.woff2)\)/g)]
      .map((m) => m[1])
      // Le français tient dans le subset latin. Les variantes latin-ext et vietnamese ne seront
      // jamais demandées (unicode-range) : les précacher gaspillerait le forfait data.
      .filter((u) => u.includes('-latin-wght-'))
    await Promise.allSettled(polices.map((u) => cache.add(u)))
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(precacher().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // backend, ESP32, tout tiers : on laisse passer

  // Ceinture et bretelles : même servi sous le même domaine que le front (reverse proxy), l'état des
  // prises et les ordres au relais ne doivent JAMAIS sortir d'un cache. Une prise affichée « allumée »
  // parce que la réponse est vieille de dix minutes, c'est pire que pas d'affichage du tout.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((rep) => {
          const copie = rep.clone()
          caches.open(VERSION).then((c) => c.put('/', copie))
          return rep
        })
        .catch(() => caches.match('/', CORRESPONDANCE).then((r) => r ?? Response.error())),
    )
    return
  }

  e.respondWith(
    caches.match(req, CORRESPONDANCE).then(
      (cache) =>
        cache ??
        fetch(req).then((rep) => {
          // Seules les réponses complètes et valides sont conservées (pas d'opaque, pas de 206).
          if (rep.ok && rep.type === 'basic') {
            const copie = rep.clone()
            caches.open(VERSION).then((c) => c.put(req, copie))
          }
          return rep
        }),
    ),
  )
})
