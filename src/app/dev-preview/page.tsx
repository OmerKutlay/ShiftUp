'use client'
// GEÇİCİ — yalnızca yerel görsel kontrol için; commit edilmeyecek.
import { Box, Typography } from '@mui/material'
import { CurrentPlanTable, DraftPlanTable } from '@/components/workforce/WorkforcePlanTables'
import type { EmployeeWeekSummary } from '@/lib/workingTimeService'
import type { PlannerResult, DraftAssignment } from '@/lib/workforcePlanner'

const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']
const names = ['Ömer Kutlay', 'Selin Arslan', 'Ayşe Yılmaz', 'Mehmet Demir', 'Zeynep Kaya', 'Can Öztürk']
const pat: ([string, string, string] | null)[] = [
  ['09:00', '18:00', 'opening'], ['13:00', '22:00', 'closing'], ['10:00', '22:00', 'full'], null, ['11:30', '20:30', 'mid'], ['09:00', '17:30', 'opening'],
]
const summaries: EmployeeWeekSummary[] = names.map((n, i) => ({
  employeeId: `e${i}`, employeeName: n, employment_type: i === 3 ? 'part_time' : 'full_time',
  days: Object.fromEntries(days.map((d, di) => {
    const s = pat[(i + di) % pat.length]
    const leave = i === 2 && di === 4
    return [d, { date: d, isLeave: leave, totalMins: s && !leave ? 450 : 0, shifts: s && !leave ? [{ id: 'x', start_time: s[0] + ':00', end_time: s[1] + ':00', is_on_leave: false }] : [] }]
  })),
  totalWeeklyMins: 2550 + i * 60, weeklyWorkDays: 5,
  violations: i === 1 ? [{ type: 'min_rest' as never, message: 'Salı 22:00 → Çarşamba 08:00 arası 10 saat dinlenme', severity: 'error' }] : [],
}))
const assignments: DraftAssignment[] = []
names.forEach((n, i) => days.forEach((d, di) => {
  const s = pat[(i + di + 1) % pat.length]
  if (s) assignments.push({ employee_id: `e${i}`, employee_name: n, work_date: d, start_time: s[0], end_time: s[1], shift_template_id: null, shift_kind: s[2] as never, reason: 'Kapsama ihtiyacı' })
}))
const draft: PlannerResult = {
  weekStart: days[0], weekEnd: days[6], weekDays: days, assignments, warnings: [], hasHardViolation: false, seed: 1,
  stats: Object.fromEntries(names.map((n, i) => {
    const as = assignments.filter((a) => a.employee_id === `e${i}`)
    return [`e${i}`, { employeeId: `e${i}`, employeeName: n, employment_type: i === 3 ? 'part_time' : 'full_time', totalMins: as.length * 480, workDays: as.length, openingCount: 2, closingCount: 2, fullCount: 1, assignments: as }]
  })) as never,
}

export default function Page() {
  return (
    <Box sx={{ p: 2, bgcolor: '#0f172a', minHeight: '100dvh', color: 'text.primary' }}>
      <Typography variant="h6" sx={{ mb: 1 }}>Mevcut Plan</Typography>
      <CurrentPlanTable weekDays={days} summaries={summaries} maxWeeklyWorkHours={45} />
      <Typography variant="h6" sx={{ my: 1 }}>Taslak</Typography>
      <DraftPlanTable draft={draft} weekDays={days} />
    </Box>
  )
}
