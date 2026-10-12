/** Resmi tatil (2429 s. Kanun). half_day: arife — 13:00'ten itibaren tatil. */
export interface PublicHoliday {
  date: string   // 'YYYY-MM-DD'
  name: string
  half_day: boolean
}
