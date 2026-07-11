import { describe, expect, it } from 'vitest'
import { APPAREILS, estGenerique } from './appareils'

describe('estGenerique — une prise sans appareil assigné', () => {
  it('reconnaît les noms génériques « Prise N » (avec ou sans espace, casse libre)', () => {
    expect(estGenerique('Prise 1')).toBe(true)
    expect(estGenerique('prise 2')).toBe(true)
    expect(estGenerique('PRISE3')).toBe(true)
    expect(estGenerique('  Prise 10  ')).toBe(true)
  })

  it('rejette un vrai nom d’appareil', () => {
    expect(estGenerique('Réfrigérateur')).toBe(false)
    expect(estGenerique('Fer à repasser')).toBe(false)
    expect(estGenerique('Prise multiple')).toBe(false)
  })
})

describe('APPAREILS — suggestions d’appareils', () => {
  it('propose des appareils courants sans doublon', () => {
    expect(APPAREILS.length).toBeGreaterThan(10)
    expect(new Set(APPAREILS).size).toBe(APPAREILS.length)
    expect(APPAREILS).toContain('Réfrigérateur')
    expect(APPAREILS).toContain('Fer à repasser')
  })
})
