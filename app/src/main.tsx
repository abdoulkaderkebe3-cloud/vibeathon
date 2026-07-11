import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service worker : uniquement dans le build de production. En développement il servirait des fichiers
// périmés et masquerait le rechargement à chaud de Vite. Enregistré après `load` pour ne pas
// concurrencer le premier rendu sur un téléphone d'entrée de gamme.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* pas de hors-ligne : l'app fonctionne normalement */
    })
  })
}
