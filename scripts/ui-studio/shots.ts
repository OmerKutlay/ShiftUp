/**
 * UI stüdyosu çekim listesi — her sayfa ve alt görünüm (sekme / diyalog).
 * `steps`: sayfa yüklendikten sonra sırayla uygulanır; bulunamayan adım çekimi düşürmez, rapora yazılır.
 */
import type { Persona as ApiPersona } from './mocks'

export type Persona = ApiPersona | 'anon'

export type Step =
  | { tab: RegExp }
  | { button: RegExp }
  | { click: string }
  | { wait: number }

export interface Shot {
  /** Dosya adı (persona ve cihaz öneki eklenir) */
  name: string
  path: string
  personas: Persona[]
  steps?: Step[]
  /** Tam sayfa yerine yalnızca görünen alan */
  viewportOnly?: boolean
  /** Yalnızca bu cihazlarda */
  devices?: Array<'desktop' | 'mobile'>
}

const M: Persona[] = ['manager']
const E: Persona[] = ['employee']
const ALL: Persona[] = ['manager', 'employee']

export const SHOTS: Shot[] = [
  { name: 'login', path: '/login', personas: ['anon'] },
  { name: 'offline', path: '/offline', personas: ['anon'] },
  { name: 'not-found', path: '/bu-sayfa-yok', personas: M },

  { name: 'today', path: '/', personas: M },
  { name: 'dashboard', path: '/dashboard', personas: M },

  { name: 'employees', path: '/employees', personas: M },
  { name: 'employees-new', path: '/employees', personas: M, steps: [{ button: /yeni çalışan/i }], viewportOnly: true },

  { name: 'shift-templates', path: '/shift-templates', personas: M },
  { name: 'shift-templates-new', path: '/shift-templates', personas: M, steps: [{ button: /yeni şablon|şablon ekle/i }], viewportOnly: true },

  { name: 'schedule', path: '/schedule', personas: ALL },

  { name: 'qr-kiosk', path: '/qr-kiosk', personas: M, viewportOnly: true },
  { name: 'scan', path: '/attendance/scan', personas: ALL, viewportOnly: true },

  { name: 'my-schedule', path: '/my-schedule', personas: ALL },
  { name: 'open-shifts', path: '/open-shifts', personas: ALL },

  { name: 'leave', path: '/leave', personas: ALL },
  { name: 'leave-all', path: '/leave', personas: M, steps: [{ tab: /tümü/i }] },
  { name: 'leave-new', path: '/leave', personas: E, steps: [{ button: /izin talebi|yeni talep|talep oluştur/i }], viewportOnly: true },

  { name: 'time-correction', path: '/time-correction', personas: ALL },
  { name: 'time-correction-direct', path: '/time-correction', personas: M, steps: [{ tab: /doğrudan/i }] },
  { name: 'time-correction-mine', path: '/time-correction', personas: M, steps: [{ tab: /taleplerim|benim/i }] },

  { name: 'workforce-availability', path: '/workforce', personas: ALL },
  { name: 'workforce-open-shifts', path: '/workforce', personas: M, steps: [{ tab: /açık vardiya/i }] },
  { name: 'workforce-swap', path: '/workforce', personas: ALL, steps: [{ tab: /takas/i }] },
  { name: 'workforce-plan', path: '/workforce', personas: M, steps: [{ tab: /haftalık plan/i }] },

  { name: 'reports-attendance', path: '/reports', personas: M },
  { name: 'reports-timesheet', path: '/reports', personas: M, steps: [{ tab: /puantaj/i }] },
  { name: 'reports-timesheet-table', path: '/reports', personas: M, steps: [{ tab: /puantaj/i }, { button: /^tablo$/i }], devices: ['desktop'] },
  { name: 'reports-overtime', path: '/reports', personas: M, steps: [{ tab: /fazla çalışma/i }] },

  { name: 'settings-location', path: '/settings', personas: M },
  { name: 'settings-holidays', path: '/settings', personas: M, steps: [{ tab: /tatil/i }] },
  { name: 'settings-audit', path: '/settings', personas: M, steps: [{ tab: /denetim/i }] },
  { name: 'settings-notifications', path: '/settings', personas: M, steps: [{ tab: /bildirim/i }] },

  { name: 'notifications', path: '/notifications', personas: ALL },
  { name: 'more', path: '/more', personas: ALL, devices: ['mobile'] },
]
