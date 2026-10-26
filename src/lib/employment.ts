/**
 * employment — işe giriş / işten ayrılış tarihlerine göre çalışma durumu (saf fonksiyonlar).
 *
 * Son çalışma günü (termination_date) DAHİLDİR: o gün çalışan hâlâ çalışır, ertesi gün pasifleşir.
 * Tarihler 'YYYY-MM-DD' (Europe/Istanbul takvim günü) olarak karşılaştırılır.
 * Kalıcı `active=false` geçişini gece cron'u yapar; bu yardımcılar cron'dan bağımsız doğru sonucu verir.
 */
// Hafif tutuldu (middleware de kullanır): dateUtils/date-fns import edilmez
function turkeyToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export interface EmploymentDates {
  hire_date?: string | null
  termination_date?: string | null
}

/** Çalışan verilen günde istihdamda mıydı? (bordro / puantaj / norm hesapları için) */
export function isEmployedOn(employee: EmploymentDates, date: string): boolean {
  if (employee.hire_date && date < employee.hire_date) return false
  if (employee.termination_date && date > employee.termination_date) return false
  return true
}

/** Son çalışma günü geçti mi? (termination_date < bugün) */
export function isTerminatedAsOf(employee: EmploymentDates, today: string = turkeyToday()): boolean {
  return !!employee.termination_date && employee.termination_date < today
}

/**
 * Hesap bugün kullanılabilir mi? active bayrağı + son çalışma günü geçmemiş olmalı.
 * Oturum, giriş, QR ve kiosk kontrollerinde `employee.active` yerine bu kullanılır.
 */
export function isEffectivelyActive(
  employee: EmploymentDates & { active: boolean },
  today: string = turkeyToday()
): boolean {
  return employee.active && !isTerminatedAsOf(employee, today)
}

/** Ayrılış tarihi planlanmış ama henüz geçmemiş (hâlâ çalışıyor) */
export function isTerminationPending(employee: EmploymentDates, today: string = turkeyToday()): boolean {
  return !!employee.termination_date && employee.termination_date >= today
}
