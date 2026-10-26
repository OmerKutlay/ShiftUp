// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildTimesheet,
  monthDays,
  timesheetDataRange,
  nightMinutesBetween,
  type TimesheetShift,
  type TimesheetEmployee,
} from '@/lib/timesheet'

const EMP: TimesheetEmployee = { id: 'e1', full_name: 'Ayşe', role_name: 'Kasiyer', employment_type: 'full_time', overtime_consent_at: null }

/** Türkiye saatiyle giriş/çıkışlı, 60 dk molalı tamamlanmış vardiya */
function worked(date: string, start = '09:00', end = '18:00', breakMins = 60): TimesheetShift {
  return {
    id: `s-${date}`, employee_id: 'e1', work_date: date, start_time: start, end_time: end,
    attendance: {
      clock_in_at: new Date(`${date}T${start}:00+03:00`).toISOString(),
      clock_out_at: new Date(`${date}T${end}:00+03:00`).toISOString(),
      break_start_at: null, break_end_at: null, completed_break_minutes: breakMins,
    },
  }
}
function planned(date: string): TimesheetShift {
  return { id: `p-${date}`, employee_id: 'e1', work_date: date, start_time: '09:00', end_time: '18:00', attendance: null }
}

describe('timesheet — yardımcılar', () => {
  it('monthDays ay uzunluğunu bilir', () => {
    expect(monthDays('2026-02')).toHaveLength(28)
    expect(monthDays('2026-10')).toHaveLength(31)
  })

  it('veri aralığı ilk haftanın Pazartesi’sinden son haftanın Pazar’ına', () => {
    // Ekim 2026: 1 Ekim Perşembe, 31 Ekim Cumartesi
    expect(timesheetDataRange('2026-10')).toEqual({ from: '2026-09-28', to: '2026-11-01' })
  })

  it('gece dakikaları Türkiye saatine göre hesaplanır', () => {
    // 22:00–06:00 → 8 saat gece
    expect(nightMinutesBetween('2026-10-01T19:00:00Z', '2026-10-02T03:00:00Z')).toBe(480)
    // 14:00–23:00 → 3 saat gece
    expect(nightMinutesBetween('2026-10-01T11:00:00Z', '2026-10-01T20:00:00Z')).toBe(180)
    // Gündüz vardiyası → 0
    expect(nightMinutesBetween('2026-10-01T06:00:00Z', '2026-10-01T15:00:00Z')).toBe(0)
  })
})

describe('timesheet — gün kodları', () => {
  const base = { month: '2026-10', employees: [EMP], holidays: [], today: '2026-10-20' }

  it('çalışılan gün Ç, izin günleri izin koduyla', () => {
    const [row] = buildTimesheet({
      ...base,
      shifts: [worked('2026-10-05')],
      leaves: [
        { employee_id: 'e1', leave_type: 'annual', start_date: '2026-10-06', end_date: '2026-10-07' },
        { employee_id: 'e1', leave_type: 'weekly_rest', start_date: '2026-10-11', end_date: '2026-10-11' },
        { employee_id: 'e1', leave_type: 'sick', start_date: '2026-10-12', end_date: '2026-10-12' },
      ],
    })
    expect(row.days['2026-10-05']).toBe('Ç')
    expect(row.days['2026-10-06']).toBe('Yİ')
    expect(row.days['2026-10-11']).toBe('HT')
    expect(row.days['2026-10-12']).toBe('Rİ')
    expect(row.leaveDays['Yİ']).toBe(2)
    expect(row.workedMins).toBe(480)
    expect(row.dayMins).toEqual({ '2026-10-05': 480 })
  })

  it('geçmişte gelinmeyen vardiya D (devamsız), gelecekteki P (planlı)', () => {
    const [row] = buildTimesheet({ ...base, shifts: [planned('2026-10-14'), planned('2026-10-25')], leaves: [] })
    expect(row.days['2026-10-14']).toBe('D')
    expect(row.days['2026-10-25']).toBe('P')
    expect(row.absentDays).toBe(1)
    expect(row.dayPlan['2026-10-25']).toEqual({ start: '09:00', end: '18:00' })
    expect(row.dayPlan['2026-10-14']).toEqual({ start: '09:00', end: '18:00' })
  })

  it('resmi tatilde çalışma RTÇ ve sayılır; çalışılmayan tatil RT', () => {
    const [row] = buildTimesheet({
      ...base,
      holidays: [
        { date: '2026-10-29', name: 'Cumhuriyet Bayramı', half_day: false },
        { date: '2026-10-28', name: 'Arife', half_day: true },
      ],
      today: '2026-10-31',
      shifts: [worked('2026-10-29')],
      leaves: [],
    })
    expect(row.days['2026-10-29']).toBe('RTÇ')
    expect(row.holidayWorkedDays).toBe(1)
    // Yarım gün arife tek başına RT sayılmaz
    expect(row.days['2026-10-28']).toBe('')
  })

  it('SGK günü: 30 − ücretsiz izin − devamsız', () => {
    const [row] = buildTimesheet({
      ...base,
      shifts: [planned('2026-10-14')],
      leaves: [{ employee_id: 'e1', leave_type: 'unpaid', start_date: '2026-10-01', end_date: '2026-10-02' }],
    })
    expect(row.sgkDays).toBe(30 - 2 - 1)
  })
})

describe('timesheet — fazla çalışma (Md. 41)', () => {
  it('haftalık 45 saati aşan net süre fazla çalışmadır; onay yoksa işaretlenir', () => {
    // 5–11 Ekim haftası: 6 gün × 8,5s net (10s brüt, 90dk mola) = 51s → 6s fazla
    const shifts = ['05', '06', '07', '08', '09', '10'].map((d) => worked(`2026-10-${d}`, '08:00', '18:00', 90))
    const [row] = buildTimesheet({ month: '2026-10', employees: [EMP], holidays: [], today: '2026-10-31', shifts, leaves: [] })
    expect(row.overtimeMins).toBe(6 * 60)
    expect(row.overtimeWithoutConsent).toBe(true)
  })

  it('planlanandan kısa mola okutulsa da planlanan mola düşülür', () => {
    // 08:00–18:00 vardiyanın planlanan molası 90 dk: 6 gün × 8,5s = 51s → 6s fazla
    const shifts = ['05', '06', '07', '08', '09', '10'].map((d) => worked(`2026-10-${d}`, '08:00', '18:00', 60))
    const [row] = buildTimesheet({ month: '2026-10', employees: [EMP], holidays: [], today: '2026-10-31', shifts, leaves: [] })
    expect(row.overtimeMins).toBe(6 * 60)
    expect(row.dayMins['2026-10-05']).toBe(8.5 * 60)
  })

  it('molasını uzatan çalışanın aşan dakikaları çalışmadan düşer (buçuklu saate yuvarlanır)', () => {
    // 09:00–18:00 vardiyanın planlanan molası 60 dk; 90 dk mola → 7s 30dk; 85 dk → 7s 35dk → 7s 30dk
    const day = (breakMins: number) => buildTimesheet({
      month: '2026-10', employees: [EMP], holidays: [], today: '2026-10-31', shifts: [worked('2026-10-05', '09:00', '18:00', breakMins)], leaves: [],
    })[0].dayMins['2026-10-05']
    expect(day(90)).toBe(7 * 60 + 30)
    expect(day(85)).toBe(7 * 60 + 30)
    expect(day(70)).toBe(8 * 60)   // 7s 50dk → 8s
  })

  it('onay tarihi varsa uyarı yok', () => {
    const shifts = ['05', '06', '07', '08', '09', '10'].map((d) => worked(`2026-10-${d}`, '08:00', '18:00', 60))
    const [row] = buildTimesheet({
      month: '2026-10', employees: [{ ...EMP, overtime_consent_at: '2026-01-01' }], holidays: [], today: '2026-10-31', shifts, leaves: [],
    })
    expect(row.overtimeWithoutConsent).toBe(false)
  })

  it('45 saatin altında fazla çalışma yok', () => {
    const shifts = ['05', '06', '07', '08', '09'].map((d) => worked(`2026-10-${d}`))
    const [row] = buildTimesheet({ month: '2026-10', employees: [EMP], holidays: [], today: '2026-10-31', shifts, leaves: [] })
    expect(row.overtimeMins).toBe(0)
  })
})

describe('timesheetExcel', () => {
  it('geçerli bir xlsx üretir: başlık, kodlar ve toplamlar', { timeout: 30_000 }, async () => {
    const { buildTimesheetWorkbook } = await import('@/lib/timesheetExcel')
    const ExcelJS = (await import('exceljs')).default
    const [row] = buildTimesheet({
      month: '2026-10', employees: [{ ...EMP, full_name: '=KÖTÜ()' }], holidays: [], today: '2026-10-31',
      shifts: [worked('2026-10-05')], leaves: [],
    })
    const buf = await buildTimesheetWorkbook('2026-10', [row], [])
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as unknown as ArrayBuffer)
    const ws = wb.getWorksheet('Puantaj')!
    expect(ws.getRow(1).getCell(1).value).toBe('Çalışan')
    expect(ws.getRow(3).getCell(1).value).toBe("'=KÖTÜ()") // formül enjeksiyonu kaçışlandı
    expect(ws.getRow(3).getCell(2 + 5).value).toBe('Ç')    // 5 Ekim
    expect(wb.getWorksheet('Açıklama')).toBeTruthy()
  })
})

describe('timesheetExcel — mağaza adı', () => {
  it('storeFileSlug Türkçe karakterleri ASCII yapar', async () => {
    const { storeFileSlug } = await import('@/lib/timesheetExcel')
    expect(storeFileSlug('Kadıköy Şube')).toBe('kadikoy-sube')
    expect(storeFileSlug('İstinye Park / AVM')).toBe('istinye-park-avm')
    expect(storeFileSlug('???')).toBe('magaza')
  })

  it('mağaza adı verilince üstte başlık satırı olur, tablo bir satır aşağı kayar', { timeout: 30_000 }, async () => {
    const { buildTimesheetWorkbook } = await import('@/lib/timesheetExcel')
    const ExcelJS = (await import('exceljs')).default
    const [row] = buildTimesheet({ month: '2026-10', employees: [EMP], holidays: [], today: '2026-10-31', shifts: [worked('2026-10-05')], leaves: [] })
    const buf = await buildTimesheetWorkbook('2026-10', [row], [], 'Kadıköy Şube')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as unknown as ArrayBuffer)
    const ws = wb.getWorksheet('Puantaj')!
    expect(String(ws.getRow(1).getCell(1).value)).toContain('Kadıköy Şube')
    expect(ws.getRow(2).getCell(1).value).toBe('Çalışan')
    expect(ws.getRow(4).getCell(2 + 5).value).toBe('Ç')
  })
})

describe('overtime — yıllık özet', () => {
  it('haftalık fazla çalışmaları toplar, sınır ve onay durumunu hesaplar', async () => {
    const { summarizeOvertime, mondayOf, overtimeYearRange } = await import('@/lib/overtime')
    expect(mondayOf('2026-10-11')).toBe('2026-10-05')
    expect(overtimeYearRange(2026)).toEqual({ from: '2025-12-29', to: '2026-12-27' })

    const shifts = ['05', '06', '07', '08', '09', '10'].map((d) => ({
      employee_id: 'e1', work_date: `2026-10-${d}`, attendance: worked(`2026-10-${d}`, '08:00', '18:00', 60).attendance,
    }))
    const [s] = summarizeOvertime(2026, [{ id: 'e1', full_name: 'Ayşe', overtime_consent_at: null }], shifts)
    expect(s.weeks).toEqual([{ weekStart: '2026-10-05', workedMins: 54 * 60, overtimeMins: 9 * 60 }])
    expect(s.totalOvertimeMins).toBe(540)
    expect(s.missingConsent).toBe(true)
    expect(s.overCap).toBe(false)
  })
})
