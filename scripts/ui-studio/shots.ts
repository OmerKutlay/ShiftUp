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
  { name: 'reports-payroll', path: '/reports', personas: M, steps: [{ tab: /bordro/i }] },

  { name: 'checklists', path: '/checklists', personas: ALL },
  { name: 'checklists-run', path: '/checklists', personas: E, steps: [{ button: /kapanış/i }], viewportOnly: true },
  { name: 'checklists-templates', path: '/checklists', personas: M, steps: [{ tab: /şablonlar/i }] },
  { name: 'checklists-template-edit', path: '/checklists', personas: M, steps: [{ tab: /şablonlar/i }, { button: /düzenle/i }], viewportOnly: true },
  { name: 'checklists-history', path: '/checklists', personas: M, steps: [{ tab: /geçmiş/i }] },

  { name: 'announcements', path: '/announcements', personas: ALL },
  { name: 'announcements-archive', path: '/announcements', personas: M, steps: [{ tab: /arşiv/i }] },
  { name: 'announcements-detail', path: '/announcements', personas: M, steps: [{ button: /yeni kasa prosedürü/i }], viewportOnly: true },
  { name: 'announcements-new', path: '/announcements', personas: M, steps: [{ button: /yeni duyuru/i }], viewportOnly: true },

  { name: 'privacy', path: '/gizlilik', personas: M },

  { name: 'settings-location', path: '/settings', personas: M },
  { name: 'settings-holidays', path: '/settings', personas: M, steps: [{ tab: /tatil/i }] },
  { name: 'settings-audit', path: '/settings', personas: M, steps: [{ tab: /denetim/i }] },
  { name: 'settings-notifications', path: '/settings', personas: M, steps: [{ tab: /bildirim/i }] },
  { name: 'settings-kvkk', path: '/settings', personas: M, steps: [{ tab: /kvkk/i }] },
  // Admin'e özel sekmeler: STUDIO_ADMIN=1 ile çekilir (aksi halde sekme bulunamaz, rapora yazılır)
  { name: 'settings-norms', path: '/settings', personas: M, steps: [{ tab: /norm/i }] },
  { name: 'settings-errors', path: '/settings', personas: M, steps: [{ tab: /hata/i }] },

  { name: 'notifications', path: '/notifications', personas: ALL },
  { name: 'more', path: '/more', personas: ALL, devices: ['mobile'] },
]
