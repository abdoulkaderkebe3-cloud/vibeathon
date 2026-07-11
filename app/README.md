# app/ - Dashboard temps réel

Chantier **App & cerveau IA** (partie interface). React 19 + Vite + TypeScript + Tailwind v4.

## Lancer

```bash
cd app
npm install
cp env.example .env.local   # VITE_MOCK=1 par défaut (démo sans backend)
npm run dev                 # http://localhost:5173
```

- **VITE_MOCK=1** : le dashboard tourne seul, un simulateur rejoue le scénario de démo
  (pic bouilloire → coupure par l'IA → impact qui grimpe). Idéal pour développer l'UI sans
  matériel ni backend.
- **VITE_MOCK=0** : se branche sur le backend FastAPI via WebSocket (`VITE_WS_URL`).

## Structure

- `src/lib/ws.ts` : hook `useEcoWattState` (WebSocket réel ou simulateur mock).
- `src/types.ts` : contrat de données partagé avec le backend.
- `src/components/` : `ConsoLive` (Zone 1), `DeviceList` (Zone 2), `DecisionLog` (Zone 3),
  `ImpactPanel` (page impact).

Se branche sur le backend via WebSocket `/ws/app` (voir `../backend`).
