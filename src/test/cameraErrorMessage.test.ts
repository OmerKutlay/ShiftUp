import { describe, it, expect } from 'vitest'
import { cameraErrorMessage } from '@/components/qr/QrScanner'

describe('cameraErrorMessage', () => {
  it.each([
    ['NotFoundError Requested device not found', 'Bu cihazda kamera bulunamadı.'],
    ['NotReadableError Could not start video source', 'Kamera başka bir uygulama tarafından kullanılıyor olabilir. Diğer uygulamaları kapatıp tekrar deneyin.'],
    ['OverconstrainedError', 'Arka kamera açılamadı. Tekrar deneyin.'],
    ['something unexpected', 'Kamera açılamadı. Tekrar deneyin.'],
  ])('%s → Türkçe mesaj', (raw, expected) => {
    expect(cameraErrorMessage(raw)).toBe(expected)
  })
})
