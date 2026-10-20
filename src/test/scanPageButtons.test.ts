// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { getButtons } from '@/components/qr/scanPageHelpers'

/** Durumdaki düğmeler: [işlem, primary mi] — primary olan önce gelir */
const layout = (status: Parameters<typeof getButtons>[0]) => getButtons(status).map((b) => [b.action, b.primary])

describe('QR tara — işlem düğmeleri', () => {
  it('girişte "Giriş yap" primary', () => {
    expect(layout('shift_waiting')).toEqual([['clock_in', true]])
  })

  it('mesai içinde "Molaya çık" primary, "Çıkış yap" secondary', () => {
    expect(layout('working')).toEqual([['break_start', true], ['clock_out', false]])
  })

  it('moladayken yalnızca "Moladan dön" (primary)', () => {
    expect(layout('on_break')).toEqual([['break_end', true]])
  })

  it('moladan sonra "Çıkış yap" primary, tekrar "Molaya çık" secondary', () => {
    expect(layout('working_after_break')).toEqual([['clock_out', true], ['break_start', false]])
  })
})
