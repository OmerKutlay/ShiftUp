/**
 * auditFormat — denetim kayıtlarını son kullanıcının okuyabileceği metne çevirir.
 *
 * audit_logs satırları ham kod adları (action, alan adları), id'ler ve ISO zaman damgaları
 * içerir; bu modül bunları Türkçe başlık, tek satırlık özet ve "alan: önce → sonra"
 * listesine dönüştürür. Bilinmeyen / teknik alanlar (id'ler, updated_at …) gösterilmez.
 */
import { format, parse } from 'date-fns'
import { tr } from 'date-fns/locale'
import { ATTENDANCE_STATUS_LABELS } from '@/types/attendance'
import { LEAVE_STATUS_LABELS, LEAVE_TYPE_LABELS } from '@/types/leave'
import { EMPLOYMENT_TYPE_LABELS, TERMINATION_REASON_LABELS } from '@/types/employee'

export interface AuditRefs {
  employees: Record<string, string>
  roles: Record<string, string>
}

export interface AuditLogLike {
  action: string
  entity_id: string | null
  before: unknown
  after: unknown
}

export interface AuditChange {
  label: string
  before?: string
  after?: string
}

// ─── İşlem başlıkları ───────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  'attendance.override': 'Devam kaydı düzeltildi',
  'time_correction.direct': 'Mesai doğrudan düzeltildi',
  'time_correction.approved': 'Mesai düzeltme talebi onaylandı',
  'time_correction.rejected': 'Mesai düzeltme talebi reddedildi',
  'leave.approved': 'İzin talebi onaylandı',
  'leave.rejected': 'İzin talebi reddedildi',
  'leave.delete': 'İzin kaydı silindi',
  'leave.weekly_rest.assign': 'Hafta tatili atandı',
  'shift_swap.accepted': 'Vardiya takası kabul edildi',
  'shift_swap.declined': 'Vardiya takası geri çevrildi',
  'shift_swap.cancelled': 'Vardiya takası iptal edildi',
  'shift_swap.approved': 'Vardiya takası onaylandı',
  'shift_swap.rejected': 'Vardiya takası reddedildi',
  'shift.create': 'Vardiya eklendi',
  'shift.update': 'Vardiya değiştirildi',
  'shift.delete': 'Vardiya silindi',
  'employee.update': 'Çalışan bilgileri güncellendi',
  'employee.delete': 'Çalışan silindi',
  'employee.terminate': 'İşten çıkış kaydedildi',
  'employee.terminate_undo': 'İşten çıkış geri alındı',
  'employee.admin_password_set': 'Admin giriş şifresi belirlendi',
  'workforce.apply': 'Haftalık plan yayınlandı',
  'store.create': 'Mağaza oluşturuldu',
  'store.update': 'Mağaza güncellendi',
  'employee.transfer': 'Çalışan mağaza değiştirdi',
  'store_location.create': 'Mağaza konumu eklendi',
  'store_location.update': 'Mağaza konumu güncellendi',
  'store_norm.set': 'Mağaza aylık norm saati belirlendi',
  'store_norm.delete': 'Mağaza aylık norm saati varsayılana döndürüldü',
  'kvkk.notice_ack': 'Aydınlatma metni teyit edildi',
  'company_settings.update': 'Şirket (KVKK) bilgileri güncellendi',
  'holiday.upsert': 'Resmi tatil kaydedildi',
  'holiday.delete': 'Resmi tatil silindi',
  'report.timesheet.export': 'Aylık puantaj indirildi',
  'report.payroll.export': 'Bordro puantajı indirildi',
}

// Yeni bir action eklenip burada unutulursa en azından ana grubu okunur görünsün
const GROUP_LABELS: Record<string, string> = {
  attendance: 'Devam kaydı işlemi',
  time_correction: 'Mesai düzeltme işlemi',
  leave: 'İzin işlemi',
  shift_swap: 'Vardiya takası işlemi',
  shift: 'Vardiya işlemi',
  employee: 'Çalışan işlemi',
  workforce: 'Planlama işlemi',
  store: 'Mağaza işlemi',
  store_location: 'Mağaza konumu işlemi',
  store_norm: 'Norm saati işlemi',
  holiday: 'Resmi tatil işlemi',
  report: 'Rapor işlemi',
}

export function auditActionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action]
  const group = Object.keys(GROUP_LABELS)
    .filter((g) => action === g || action.startsWith(`${g}.`))
    .sort((a, b) => b.length - a.length)[0]
  return group ? GROUP_LABELS[group] : 'Diğer işlem'
}

// ─── Değer biçimlendirme ───────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  employee_id: 'Çalışan',
  status: 'Durum',
  clock_in_at: 'Giriş',
  break_start_at: 'Mola başlangıcı',
  break_end_at: 'Mola bitişi',
  clock_out_at: 'Çıkış',
  completed_break_minutes: 'Mola süresi',
  break_minutes: 'Mola süresi',
  full_name: 'Ad soyad',
  email: 'E-posta',
  role: 'Pozisyon', // eski denetim kayıtları için (sütun kaldırıldı)
  role_id: 'Sistem rolü',
  active: 'Hesap durumu',
  employment_type: 'Çalışma tipi',
  hire_date: 'İşe giriş tarihi',
  birth_date: 'Doğum tarihi',
  overtime_consent_at: 'Fazla çalışma onay tarihi',
  termination_date: 'Son çalışma günü',
  termination_reason: 'İşten çıkış nedeni',
  termination_note: 'İşten çıkış notu',
  termination_leave_balance: 'Kullanılmamış yıllık izin (gün)',
  shifts_deleted: 'Silinen vardiya',
  shifts_converted: 'Açık vardiyaya çevrilen',
  leave_cancelled: 'İptal edilen izin',
  time_corrections_cancelled: 'İptal edilen mesai düzeltme',
  swaps_cancelled: 'İptal edilen takas',
  work_date: 'Tarih',
  date: 'Tarih',
  start_time: 'Başlangıç',
  end_time: 'Bitiş',
  start: 'Başlangıç',
  end: 'Bitiş',
  leave_type: 'İzin tipi',
  start_date: 'Başlangıç tarihi',
  end_date: 'Bitiş tarihi',
  reason: 'Gerekçe',
  reviewer_note: 'Yönetici notu',
  removed: 'Kaldırılan planlı vardiya',
  keptWorked: 'Korunan vardiya (çalışılmış)',
  name: 'Ad',
  month: 'Ay',
  norm_hours: 'Norm saati',
  note: 'Not',
  half_day: 'Yarım gün',
  latitude: 'Enlem',
  longitude: 'Boylam',
  allowed_radius_meters: 'İzin verilen mesafe',
  max_accuracy_meters: 'Konum hassasiyeti sınırı',
  weekStart: 'Hafta başı',
  weekEnd: 'Hafta sonu',
  created: 'Oluşturulan vardiya',
  replaced: 'Değiştirilen vardiya',
  restDays: 'Atanan hafta tatili',
}

const MINUTE_FIELDS = new Set(['completed_break_minutes', 'break_minutes'])
const METER_FIELDS = new Set(['allowed_radius_meters', 'max_accuracy_meters'])

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}(:\d{2})?$/

function formatTimestamp(v: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
  }).format(new Date(v))
}

export function formatAuditDate(v: string): string {
  return format(parse(v, 'yyyy-MM-dd', new Date()), 'd MMMM yyyy', { locale: tr })
}

function formatValue(key: string, v: unknown, refs: AuditRefs): string {
  if (v === null || v === undefined || v === '') return '—'
  if (key === 'employee_id') return refs.employees[String(v)] ?? 'Bilinmeyen çalışan'
  if (key === 'role_id') return refs.roles[String(v)] ?? 'Bilinmeyen rol'
  if (key === 'active') return v ? 'Aktif' : 'Pasif'
  if (key === 'status') {
    const s = String(v)
    return (ATTENDANCE_STATUS_LABELS as Record<string, string>)[s]
      ?? (LEAVE_STATUS_LABELS as Record<string, string>)[s] ?? s
  }
  if (key === 'leave_type') return (LEAVE_TYPE_LABELS as Record<string, string>)[String(v)] ?? String(v)
  if (key === 'employment_type') return (EMPLOYMENT_TYPE_LABELS as Record<string, string>)[String(v)] ?? String(v)
  if (key === 'termination_reason') return (TERMINATION_REASON_LABELS as Record<string, string>)[String(v)] ?? String(v)
  if (typeof v === 'boolean') return v ? 'Evet' : 'Hayır'
  if (typeof v === 'number') {
    if (MINUTE_FIELDS.has(key)) return `${v} dk`
    if (METER_FIELDS.has(key)) return `${v} m`
    return String(v)
  }
  if (typeof v === 'string') {
    if (ISO_TS.test(v)) return formatTimestamp(v)
    if (ISO_DATE.test(v)) return formatAuditDate(v)
    if (TIME.test(v)) return v.slice(0, 5)
    return v
  }
  return '—'
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Önce/sonra farkı — yalnızca etiketi bilinen alanlar; iki tarafta da aynı olanlar atlanır */
export function auditChanges(log: AuditLogLike, refs: AuditRefs): AuditChange[] {
  const before = asRecord(log.before)
  const after = asRecord(log.after)
  const hasBefore = log.before != null
  const hasAfter = log.after != null
  const keys = Object.keys(FIELD_LABELS).filter((k) => k in before || k in after)

  const out: AuditChange[] = []
  for (const k of keys) {
    const b = k in before ? formatValue(k, before[k], refs) : undefined
    const a = k in after ? formatValue(k, after[k], refs) : undefined
    if (b !== undefined && a !== undefined && b === a) continue
    out.push({
      label: FIELD_LABELS[k],
      ...(hasBefore && b !== undefined ? { before: b } : {}),
      ...(hasAfter && a !== undefined ? { after: a } : {}),
    })
  }
  return out
}

// ─── Tek satırlık özet ──────────────────────────────────────

const hhmm = (v: unknown) => (typeof v === 'string' && TIME.test(v) ? v.slice(0, 5) : null)
const day = (v: unknown) => (typeof v === 'string' && ISO_DATE.test(v) ? formatAuditDate(v) : null)

function range(a: unknown, b: unknown): string | null {
  const s = hhmm(a), e = hhmm(b)
  return s && e ? `${s}–${e}` : null
}

/** İşlemin ne olduğunu bir bakışta anlatan kısa satır (ör. "12 Ekim 2026 · 09:00–18:00") */
export function auditSummary(log: AuditLogLike): string | null {
  const b = asRecord(log.before)
  const a = asRecord(log.after)
  const parts: (string | null)[] = []

  switch (log.action.split('.')[0]) {
    case 'shift': {
      const src = log.action === 'shift.delete' ? b : { ...b, ...a }
      parts.push(day(src.work_date), range(src.start_time, src.end_time))
      break
    }
    case 'time_correction':
      parts.push(day(a.date), range(a.start, a.end))
      break
    case 'leave': {
      const src = Object.keys(a).length ? { ...b, ...a } : b
      const s = day(src.start_date), e = day(src.end_date)
      parts.push(typeof src.leave_type === 'string' ? (LEAVE_TYPE_LABELS as Record<string, string>)[src.leave_type] : null)
      parts.push(s && e ? (s === e ? s : `${s} – ${e}`) : null)
      if (typeof a.removed === 'number' && a.removed > 0) parts.push(`${a.removed} planlı vardiya kaldırıldı`)
      break
    }
    case 'workforce': {
      const s = day(a.weekStart), e = day(a.weekEnd)
      parts.push(s && e ? `${s} – ${e} haftası` : null)
      if (typeof a.created === 'number') parts.push(`${a.created} vardiya oluşturuldu`)
      if (typeof a.replaced === 'number' && a.replaced > 0) parts.push(`${a.replaced} vardiya değiştirildi`)
      if (typeof a.restDays === 'number' && a.restDays > 0) parts.push(`${a.restDays} hafta tatili atandı`)
      break
    }
    case 'holiday': {
      const d = log.entity_id && ISO_DATE.test(log.entity_id) ? formatAuditDate(log.entity_id) : null
      parts.push(d, typeof a.name === 'string' ? a.name : null, a.half_day === true ? 'yarım gün' : null)
      break
    }
    case 'report':
      if (log.entity_id && /^\d{4}-\d{2}$/.test(log.entity_id)) {
        const m = format(parse(log.entity_id, 'yyyy-MM', new Date()), 'LLLL yyyy', { locale: tr })
        parts.push(m.charAt(0).toLocaleUpperCase('tr-TR') + m.slice(1))
      }
      break
    case 'store':
    case 'store_location':
      parts.push(typeof a.name === 'string' ? a.name : null)
      break
  }

  const text = parts.filter(Boolean).join(' · ')
  return text || null
}

// ─── Not ────────────────────────────────────────────────────

/** "İhlaller onaylandı: a | b" biçimindeki notu başlık + madde listesine ayırır */
export function splitAuditNote(note: string): { title: string; items: string[] } {
  const m = /^(İhlaller onaylandı):\s*([\s\S]+)$/.exec(note)
  if (m) return { title: 'Onaylanan kural ihlalleri', items: m[2].split(' | ').map((s) => s.trim()).filter(Boolean) }
  return { title: 'Not', items: [note] }
}
