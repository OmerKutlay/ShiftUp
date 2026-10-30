/**
 * Dışa aktarma: Raporlar sekmeleri ve haftalık plan "Dışa aktar" menüsünden PDF / CSV (/ Excel) iner.
 * PDF tarayıcıda üretilir (jsPDF + gömülü yazı tipi); Excel ve bordro CSV'si sunucudan blob olarak alınır.
 */
import fs from 'node:fs'
import type { Page, Route } from '@playwright/test'
import { test, expect, makeEmployee, mockApi } from './support/fixtures'

const today = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
const month = todayStr.slice(0, 7)

const STORE = { active: { id: 'store-1', name: 'Kadıköy Şube' }, home_store_id: 'store-1', can_switch: false }
const manager = makeEmployee('Mağaza Müdürü')
const cashier = {
  ...makeEmployee('Çalışan'),
  id: 'emp-e2e-kasiyer',
  full_name: 'Şule Işık',
}

function json(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
}

/** Haftanın Pazartesi'si (yerel) */
function monday(): string {
  const d = new Date(today)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const overrides: Record<string, unknown | ((route: Route) => Promise<void> | void)> = {
  '/api/auth/me': { employee: manager, store: STORE },
  '/api/employees': { employees: [manager, cashier] },
  '/api/shift-templates': { templates: [] },
  '/api/shifts': {
    assignments: [{
      id: 'sa-1', employee_id: cashier.id, work_date: monday(), start_time: '09:00:00', end_time: '18:00:00',
      is_on_leave: false, shift_template_id: null, shift_templates: { name: 'Açılış' }, employees: null,
    }],
  },
  '/api/leave': { requests: [] },
  '/api/holidays': { holidays: [] },
  '/api/availability': { availability: [] },
  '/api/reports/attendance': {
    rows: [{
      record_id: 'r1', employee_id: cashier.id, full_name: cashier.full_name, work_date: todayStr, shift_name: 'Sabah',
      start_time: '09:00:00', end_time: '17:00:00', status: 'clocked_out', clock_in_at: `${todayStr}T06:00:00.000Z`,
      clock_out_at: `${todayStr}T14:00:00.000Z`, break_start_at: null, break_end_at: null, worked_minutes: 450,
      break_minutes: 30, verification_method: 'qr', exception_note: null, is_on_leave: false,
    }],
  },
  '/api/reports/timesheet': (route: Route) => {
    if (new URL(route.request().url()).searchParams.get('format') === 'xlsx') {
      return route.fulfill({
        status: 200,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers: { 'Content-Disposition': `attachment; filename="puantaj-kadikoy-sube-${month}.xlsx"` },
        body: 'PK-e2e',
      })
    }
    return json(route, {
      month,
      holidays: [],
      rows: [{
        employee: { id: cashier.id, full_name: cashier.full_name, role_name: 'Kasiyer', employment_type: 'full_time' },
        days: { [`${month}-01`]: 'Ç', [`${month}-02`]: 'D' }, dayMins: {}, dayPlan: {},
        workedMins: 450, nightMins: 0, overtimeMins: 0, holidayWorkedDays: 0, workedDays: 1, absentDays: 1,
        leaveDays: { 'Yİ': 0, 'Rİ': 0, 'Üİ': 0, 'Mİ': 0, 'HT': 0 }, sgkDays: 29, overtimeWithoutConsent: false,
      }],
    })
  },
  '/api/reports/overtime': {
    summaries: [{
      employee_id: cashier.id, full_name: cashier.full_name, consent_at: null,
      weeks: [{ weekStart: monday(), workedMins: 3000, overtimeMins: 300 }],
      totalOvertimeMins: 300, capMins: 16200, capRatio: 300 / 16200, overCap: false, missingConsent: true,
    }],
  },
  '/api/reports/payroll': (route: Route) => {
    const format = new URL(route.request().url()).searchParams.get('format')
    if (format === 'csv') {
      return route.fulfill({
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        headers: { 'Content-Disposition': `attachment; filename="bordro-puantaj-${month}-kadikoy-sube.csv"` },
        body: '﻿Sicil No;Ad Soyad\r\n;Şule Işık\r\n',
      })
    }
    return json(route, {
      month,
      rows: [{
        employeeId: cashier.id, fullName: cashier.full_name, sicilNo: '', tcKimlikNo: '', days: {}, workedDays: 1,
        normalHours: 7.5, overtimeHours: 0, holidayWorkedHours: 0, holidayWorkedDays: 0, nightHours: 0,
        weeklyRestDays: 0, holidayRestDays: 0, annualLeaveDays: 0, sickDays: 0, unpaidDays: 0, excuseDays: 0,
        absentDays: 1, employedDays: 30, missingDays: 1, missingReasonCode: '15', sgkDays: 29, noRecords: false, notes: [],
      }],
    })
  },
}

test.use({ role: 'Mağaza Müdürü' })

test.beforeEach(async ({ context, page }) => {
  void page // fixture'ın genel taklitleri önce kurulsun; aşağıdaki route sonra eklenip önce çalışır
  await mockApi(context, { role: 'Mağaza Müdürü', overrides })
})

const exportButton = (page: Page, name = 'Dışa aktar') => page.getByRole('button', { name, exact: true })

/** Menüden seçeneği tıklar, inen dosyanın adını ve içeriğini döner */
async function download(page: Page, menu: string, item: string) {
  await exportButton(page, menu).click()
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: item }).click(),
  ])
  const path = await file.path()
  return { name: file.suggestedFilename(), body: fs.readFileSync(path!) }
}

const isPdf = (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-'

test('Raporlar: her sekmede PDF ve CSV iner', async ({ page }) => {
  await page.goto('/reports')
  await expect(exportButton(page)).toBeEnabled()

  // Devam raporu
  let f = await download(page, 'Dışa aktar', 'PDF indir')
  expect(f.name).toMatch(/^devam-raporu-kadikoy-sube-.*\.pdf$/)
  expect(isPdf(f.body)).toBe(true)
  f = await download(page, 'Dışa aktar', 'CSV indir')
  expect(f.name).toMatch(/^devam-raporu-kadikoy-sube-.*\.csv$/)
  expect(f.body.toString('utf8')).toContain('Çalışan;Tarih;Vardiya')

  // Aylık puantaj
  await page.getByRole('tab', { name: 'Aylık puantaj' }).click()
  await expect(exportButton(page)).toBeEnabled()
  f = await download(page, 'Dışa aktar', 'PDF indir')
  expect(f.name).toBe(`puantaj-kadikoy-sube-${month}.pdf`)
  expect(isPdf(f.body)).toBe(true)
  f = await download(page, 'Dışa aktar', 'CSV indir')
  expect(f.name).toBe(`puantaj-kadikoy-sube-${month}.csv`)
  expect(f.body.toString('utf8')).toContain('Şule Işık;Ç;D')
  f = await download(page, 'Dışa aktar', 'Excel indir (tüm ekip)')
  expect(f.name).toBe(`puantaj-kadikoy-sube-${month}.xlsx`)

  // Fazla çalışma
  await page.getByRole('tab', { name: 'Fazla çalışma' }).click()
  await expect(exportButton(page)).toBeEnabled()
  f = await download(page, 'Dışa aktar', 'PDF indir')
  expect(f.name).toMatch(/^fazla-calisma-kadikoy-sube-\d{4}\.pdf$/)
  expect(isPdf(f.body)).toBe(true)
  f = await download(page, 'Dışa aktar', 'CSV indir')
  expect(f.body.toString('utf8')).toContain('Şule Işık;5;2;265;1;Yok')

  // Bordro puantajı
  await page.getByRole('tab', { name: 'Bordro puantajı' }).click()
  await expect(exportButton(page)).toBeEnabled()
  f = await download(page, 'Dışa aktar', 'PDF indir')
  expect(f.name).toBe(`bordro-puantaj-${month}-kadikoy-sube.pdf`)
  expect(isPdf(f.body)).toBe(true)
  f = await download(page, 'Dışa aktar', 'CSV indir (toplamlar)')
  expect(f.name).toBe(`bordro-puantaj-${month}-kadikoy-sube.csv`)
})

test('Haftalık plan: PDF ve CSV iner, Yazdır sayfası açılır', async ({ page }) => {
  await page.goto('/schedule')
  await expect(exportButton(page)).toBeEnabled()

  let f = await download(page, 'Dışa aktar', 'PDF indir')
  expect(f.name).toBe(`haftalik-plan-kadikoy-sube-${monday()}.pdf`)
  expect(isPdf(f.body)).toBe(true)
  f = await download(page, 'Dışa aktar', 'CSV indir')
  const csv = f.body.toString('utf8')
  expect(csv).toContain('Şule Işık')
  expect(csv).toContain('09:00–18:00 (Açılış)')

  await exportButton(page).click()
  await page.getByRole('menuitem', { name: 'Yazdır' }).click()
  await expect(page).toHaveURL(/\/schedule\/print\?week=/)
  await expect(exportButton(page)).toBeEnabled()
  f = await download(page, 'Dışa aktar', 'PDF indir')
  expect(isPdf(f.body)).toBe(true)
})
