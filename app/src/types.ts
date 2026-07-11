// Contrat de données partagé avec le backend (voir backend/app/main.py snapshot()).

export type Priorite = 'essentiel' | 'reportable' | 'confort'
export type ActionIA = 'couper' | 'rallumer' | 'garder'

export interface Device {
  id: string
  nom: string
  prise_id: string
  priorite: Priorite
  etat: 'on' | 'off'
  conso_w: number
  replanifie_a: string | null
}

export interface Decision {
  id: number
  device_id: string
  action: ActionIA
  raison: string
  replanifie_a: string | null
  timestamp: string
}

export interface Impact {
  kwh_evites: number
  fcfa_economises: number
  co2_evite_kg: number
}

export type View =
  | 'dashboard'
  | 'assistant'
  | 'devices'
  | 'decisions'
  | 'impact'
  | 'history'
  | 'network'
  | 'settings'

export interface EcoWattState {
  devices: Device[]
  decisions: Decision[]
  impact: Impact
  impact_projection_10000: Impact
  mock: boolean
  peak_now: boolean
  ts: string
}
