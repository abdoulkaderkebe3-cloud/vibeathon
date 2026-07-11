import { useEffect, useState } from 'react'

/**
 * Suit l'état de la connexion (ADR-013).
 *
 * Sans réseau, EcoWatt reste utilisable : le mode démo simule le foyer dans le navigateur et
 * l'assistant retombe sur ses règles locales. Encore faut-il le dire, sinon une coupure passe pour
 * une panne de l'application. `navigator.onLine` ne détecte que l'absence d'interface réseau, pas
 * un portail captif : c'est une indication, pas une garantie.
 */
export function useEnLigne(): boolean {
  const [enLigne, setEnLigne] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const monte = () => setEnLigne(true)
    const coupe = () => setEnLigne(false)
    window.addEventListener('online', monte)
    window.addEventListener('offline', coupe)
    return () => {
      window.removeEventListener('online', monte)
      window.removeEventListener('offline', coupe)
    }
  }, [])

  return enLigne
}
