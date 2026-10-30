/**
 * excel — puantaj ve bordro .xlsx dosyalarını tarayıcıda üretir ve indirir.
 *
 * Worker ücretsiz planda istek başına ~10 ms CPU ile sınırlı; exceljs sunucuda 200+ ms harcıyordu.
 * Bu yüzden sunucu yalnızca JSON döner (+ denetim kaydı), dosya burada üretilir. exceljs yalnızca indirme
 * anında yüklenen tembel bir istemci paketidir. `typeof window` derlemede sabitlenir: sunucu (SSR) paketinde
 * bu import() dalı ölü kod olarak atılır (bkz. pdf.ts).
 */
import { saveBlob } from './download'
import { generatedAtTr, storeFileSlug } from './fileName'
import { turkeyToday } from '@/lib/dateUtils'
import type { PayrollRow } from '@/lib/payrollTimesheet'
import type { TimesheetRow } from '@/lib/timesheet'
import type { PublicHoliday } from '@/types/holiday'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function loadPayrollExcel() {
  return typeof window === 'undefined'
    ? Promise.reject(new Error('Excel yalnızca tarayıcıda üretilir.'))
    : import('@/lib/payrollExcel')
}

function loadTimesheetExcel() {
  return typeof window === 'undefined'
    ? Promise.reject(new Error('Excel yalnızca tarayıcıda üretilir.'))
    : import('@/lib/timesheetExcel')
}

/** Bordro puantajı Excel'i: dosya adı eski sunucu çıktısıyla aynıdır */
export async function downloadPayrollXlsx(month: string, rows: PayrollRow[], storeName: string): Promise<void> {
  const { buildPayrollWorkbook } = await loadPayrollExcel()
  const bytes = await buildPayrollWorkbook(month, rows, storeName || 'Mağaza', `${turkeyToday()} (${generatedAtTr()})`)
  saveBlob(new Blob([bytes as BlobPart], { type: XLSX_TYPE }), `bordro-puantaj-${month}-${storeFileSlug(storeName)}.xlsx`)
}

/** Aylık puantaj Excel'i */
export async function downloadTimesheetXlsx(
  month: string, rows: TimesheetRow[], holidays: PublicHoliday[], storeName: string
): Promise<void> {
  const { buildTimesheetWorkbook } = await loadTimesheetExcel()
  const bytes = await buildTimesheetWorkbook(month, rows, holidays, storeName || undefined)
  saveBlob(new Blob([bytes as BlobPart], { type: XLSX_TYPE }), `puantaj-${storeFileSlug(storeName)}-${month}.xlsx`)
}
