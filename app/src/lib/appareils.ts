// Helpers partagés pour assigner un appareil à une prise et la piloter (sans IA).
const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// Appareils courants d'un foyer ivoirien (suggestions du menu ; saisie libre possible).
export const APPAREILS = [
  'Ventilateur', 'Lampe', 'Ampoule', 'Réfrigérateur', 'Congélateur', 'Télévision',
  'Décodeur', 'Fer à repasser', 'Bouilloire', 'Climatiseur', 'Chargeur téléphone',
  'Ordinateur', 'Machine à laver', 'Pompe à eau', 'Micro-ondes',
]

// Un nom "générique" (Prise 1/2) = pas encore d'appareil assigné.
export const estGenerique = (nom: string) => /^prise\s*\d+$/i.test(nom.trim())

export async function renameDevice(id: string, nom: string): Promise<void> {
  await fetch(`${API}/api/devices/${id}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom }),
  })
}

export async function controlDevice(id: string, action: 'couper' | 'rallumer'): Promise<void> {
  await fetch(`${API}/api/devices/${id}/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
}
