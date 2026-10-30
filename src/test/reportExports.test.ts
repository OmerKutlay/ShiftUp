import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftAssignmentWithDetails, WeeklyScheduleEntry } from '@/types/schedule'
import type { TimesheetRow } from '@/lib/timesheet'
import type { OvertimeSummary } from '@/lib/overtime'
import type { PayrollRow } from '@/lib/payrollTimesheet'
import type { AttendanceReportRow } from '@/types/report'

// İndirmeler yakalanır; PDF yazı tipleri public/fonts'tan okunur
const saved: Array<{ blob: Blob; filename: string }> = []
vi.mock('@/lib/export/download', async (orig) => {
  const actual = await orig<typeof import('@/lib/export/download')>()
  const saveBlob = (blob: Blob, filename: string) => { saved.push({ blob, filename }) }
  return {
    ...actual,
    saveBlob,
    saveCsv: (csv: string, filename: string) => saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename),
  }
})

import { csvCell, toCsv } from '@/lib/export/csv'
import { exportReportToCsv } from '@/lib/reportRepository'
import {
  exportOvertimeCsv, exportOvertimePdf, exportPayrollPdf, exportTimesheetCsv, exportTimesheetPdf,
} from '@/components/reports/reportExports'
import { exportWeekCsv, exportWeekPdf, type WeekExportInput } from '@/components/schedule/print/weekExport'
import { calcEmployeeStats } from '@/components/schedule/scheduleHelpers'

beforeEach(() => {
  saved.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const buf = readFileSync(path.join(process.cwd(), 'public', url))
    return new Response(new Uint8Array(buf))
  }))
})

/** jsdom Blob'u Node Response/TextDecoder ile okunamaz: FileReader kullanılır */
const blobBytes = (b: Blob) => new Promise<Uint8Array>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer))
  r.onerror = () => reject(r.error)
  r.readAsArrayBuffer(b)
})
const blobText = async (b: Blob) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blobBytes(b))
const lastCsv = async () => {
  const { blob, filename } = saved.at(-1)!
  const text = await blobText(blob)
  return { filename, text, lines: text.slice(1).split('\r\n') }
}
/** PDF baytları; EXPORT_PDF_DIR verilirse dosya olarak da yazılır (gözle kontrol için) */
const lastPdf = async () => {
  const { blob, filename } = saved.at(-1)!
  const bytes = await blobBytes(blob)
  if (process.env.EXPORT_PDF_DIR) writeFileSync(path.join(process.env.EXPORT_PDF_DIR, filename), bytes)
  return { filename, head: new TextDecoder('latin1').decode(bytes.subarray(0, 5)), size: bytes.length, raw: new TextDecoder('latin1').decode(bytes) }
}

describe('csv', () => {
  it('BOM, ; ayraç, CRLF, ondalık virgül', () => {
    const csv = toCsv(['Ad', 'Saat'], [['Ayşe', 7.5], ['Ali', 0]])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1)).toBe('Ad;Saat\r\nAyşe;7,5\r\nAli;0\r\n')
  })
  it('formül enjeksiyonu kaçışlanır; ayraç/tırnak içeren hücre tırnaklanır; negatif sayı kaçışsız', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('-5')).toBe(`'-5`)
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('a, b')).toBe('"a, b"')
    expect(csvCell(null)).toBe('')
  })
})

describe('devam raporu CSV', () => {
  it('Türkçe Excel için ; ayraçlı, tarih gg.aa.yyyy, doğrulama Türkçe', () => {
    const row: AttendanceReportRow = {
      record_id: 'r', employee_id: 'e1', full_name: 'Ayşe', work_date: '2026-10-01', shift_name: 'Sabah',
      start_time: '09:00:00', end_time: '17:00:00', status: 'clocked_out',
      clock_in_at: '2026-10-01T06:02:00Z', clock_out_at: '2026-10-01T14:05:00Z',
      worked_minutes: 450, break_minutes: 30, verification_method: 'qr_location', exception_note: null,
    } as AttendanceReportRow
    const [head, first] = exportReportToCsv([row]).slice(1).split('\r\n')
    expect(head.split(';')).toHaveLength(12)
    expect(first).toBe('Ayşe;01.10.2026;Sabah;09:00;17:00;Çıkış yaptı;09:02;17:05;7s 30d;0s 30d;QR + konum;')
  })
})

// ─── Puantaj / fazla çalışma / bordro ────────────────────────

const tsRow = (id: string, name: string): TimesheetRow => ({
  employee: { id, full_name: name, role_name: 'Kasiyer', employment_type: 'full_time' },
  days: { '2026-10-01': 'Ç', '2026-10-02': 'D', '2026-10-05': 'HT', '2026-10-29': 'RT' },
  dayMins: {}, dayPlan: {},
  workedMins: 9030, nightMins: 0, overtimeMins: 90, holidayWorkedDays: 1, workedDays: 20, absentDays: 1,
  leaveDays: { 'Yİ': 0, 'Rİ': 0, 'Üİ': 0, 'Mİ': 0, 'HT': 4 }, sgkDays: 29, overtimeWithoutConsent: true,
})

describe('aylık puantaj', () => {
  it('CSV: ayın her günü bir sütun + toplamlar; saatler ondalık virgüllü', async () => {
    exportTimesheetCsv('2026-10', [tsRow('e1', 'Şule Işık')], 'Kadıköy Şube')
    const { filename, lines } = await lastCsv()
    expect(filename).toBe('puantaj-kadikoy-sube-2026-10.csv')
    const head = lines[0].split(';')
    expect(head).toHaveLength(1 + 31 + 5)
    expect(head[1]).toBe('1 Pe')
    const row = lines[1].split(';')
    expect(row[0]).toBe('Şule Işık')
    expect(row[1]).toBe('Ç')
    expect(row[2]).toBe('D')
    expect(row.slice(-5)).toEqual(['150,5', '1,5', '0', '1', '29'])
  })
  it('PDF üretir', async () => {
    await exportTimesheetPdf('2026-10', [tsRow('e1', 'Şule Işık'), tsRow('e2', 'Ğökhan Çağlar')],
      [{ date: '2026-10-29', name: 'Cumhuriyet Bayramı', half_day: false } as never], 'Kadıköy Şube', 'Arama: "ş"')
    const pdf = await lastPdf()
    expect(pdf.filename).toBe('puantaj-kadikoy-sube-2026-10.pdf')
    expect(pdf.head).toBe('%PDF-')
    expect(pdf.raw).toContain('/FontName /')   // gömülü yazı tipi (Türkçe karakterler)
  })
})

const ot = (id: string, name: string, mins: number, consent: string | null): OvertimeSummary => ({
  employee_id: id, full_name: name, consent_at: consent, weeks: [{ weekStart: '2026-03-02', workedMins: 3000, overtimeMins: mins }],
  totalOvertimeMins: mins, capMins: 270 * 60, capRatio: mins / (270 * 60), overCap: mins > 270 * 60, missingConsent: !consent,
})

describe('fazla çalışma', () => {
  it('CSV: saat, oran, kalan (aşımda negatif) ve onay', async () => {
    exportOvertimeCsv(2026, [ot('e1', 'Ali', 17_000, null), ot('e2', 'Ayşe', 90, '2026-01-05T10:00:00Z')], 'Merkez')
    const { filename, lines } = await lastCsv()
    expect(filename).toBe('fazla-calisma-merkez-2026.csv')
    expect(lines[1]).toBe('Ali;283,3;105;-13,3;1;Yok')
    expect(lines[2]).toBe('Ayşe;1,5;1;268,5;1;Var (05.01.2026)')
  })
  it('PDF üretir', async () => {
    await exportOvertimePdf(2026, [ot('e1', 'Ali Şahin', 17_000, null)], 'Merkez', 'Sınırı aşan')
    expect((await lastPdf()).head).toBe('%PDF-')
  })
})

describe('bordro puantajı PDF', () => {
  it('PDF üretir', async () => {
    const row = {
      employeeId: 'e1', fullName: 'İlker Öztürk', sicilNo: '', tcKimlikNo: '', days: {}, workedDays: 22, normalHours: 165,
      overtimeHours: 7.5, holidayWorkedHours: 0, holidayWorkedDays: 0, nightHours: 0, weeklyRestDays: 4, holidayRestDays: 1,
      annualLeaveDays: 0, sickDays: 2, unpaidDays: 0, excuseDays: 0, absentDays: 1, employedDays: 30, missingDays: 3,
      missingReasonCode: '12', sgkDays: 27, noRecords: false, notes: [],
    } satisfies PayrollRow
    await exportPayrollPdf('2026-10', [row, { ...row, employeeId: 'e2', fullName: 'Çağla Ünal', noRecords: true }], 'Kadıköy')
    const pdf = await lastPdf()
    expect(pdf.filename).toBe('bordro-puantaj-2026-10-kadikoy.pdf')
    expect(pdf.head).toBe('%PDF-')
  })
})

// ─── Haftalık plan ───────────────────────────────────────────

const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']
const emp = (id: string, name: string, roleName?: string): EmployeeWithRole => ({
  id, full_name: name, email: null, role_id: null, active: true, store_id: 's1', employment_type: 'full_time',
  auth_user_id: null, created_at: '', updated_at: '', roles: roleName ? { name: roleName } : null,
} as EmployeeWithRole)
const shift = (employee_id: string, work_date: string, start: string, end: string, name?: string) => ({
  id: `${employee_id}-${work_date}`, employee_id, work_date, start_time: start, end_time: end, is_on_leave: false,
  shift_templates: name ? { name } : null, employees: null,
}) as unknown as ShiftAssignmentWithDetails

function weekInput(): WeekExportInput {
  const people = [emp('e1', 'Ali Yılmaz', 'Kasiyer'), emp('e2', 'Ayşe Demir')]
  const assignments = [
    shift('e1', days[0], '09:00:00', '18:00:00', 'Açılış'),
    shift('e1', days[1], '09:00:00', '18:00:00'),
    shift('e2', days[0], '12:00:00', '21:00:00'),
  ]
  const entries: WeeklyScheduleEntry[] = people.map((employee) => ({
    employee,
    dayAssignments: Object.fromEntries(days.map((d) => [d, assignments.find((a) => a.employee_id === employee.id && a.work_date === d) ?? null])),
  }))
  return {
    storeName: 'Kadıköy',
    weekDays: days,
    entries,
    holidayMap: new Map([[days[3], { date: days[3], name: 'Cumhuriyet Bayramı', half_day: false } as never]]),
    statsMap: new Map(entries.map((x) => [x.employee.id, calcEmployeeStats(assignments.filter((a) => a.employee_id === x.employee.id), days)])),
    approvedLeaveMap: new Set([`e2:${days[2]}`]),
    restDayMap: new Set([`e2:${days[6]}`]),
  }
}

describe('haftalık plan', () => {
  it('CSV: grup, çalışan, rol, günler (vardiya + şablon / izin / tatil), saat ve kişi sayısı satırı', async () => {
    exportWeekCsv(weekInput())
    const { filename, lines } = await lastCsv()
    expect(filename).toBe('haftalik-plan-kadikoy-2026-10-26.csv')
    expect(lines[0]).toBe('Grup;Çalışan;Rol;Pzt 26.10;Sal 27.10;Çar 28.10;Per 29.10;Cum 30.10;Cmt 31.10;Paz 1.11;Haftalık net saat')
    const ali = lines.find((l) => l.includes('Ali Yılmaz'))!.split(';')
    expect(ali.slice(3, 5)).toEqual(['09:00–18:00 (Açılış)', '09:00–18:00'])
    const ayse = lines.find((l) => l.includes('Ayşe Demir'))!.split(';')
    expect(ayse[5]).toBe('İzinli')
    expect(ayse[9]).toBe('Haftalık tatil')
    const total = lines.find((l) => l.startsWith('Toplam'))!.split(';')
    expect(total.slice(3, 10)).toEqual(['2', '1', '0', '0', '0', '0', '0'])
  })
  it('PDF üretir', async () => {
    await exportWeekPdf(weekInput())
    const pdf = await lastPdf()
    expect(pdf.filename).toBe('haftalik-plan-kadikoy-2026-10-26.pdf')
    expect(pdf.head).toBe('%PDF-')
  })
})
