import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './helpers/renderWithProviders'
import type { AttendanceRecord, DailyShiftEntry } from '@/types/attendance'

vi.mock('@/lib/api/attendance', () => ({ fetchDailyShifts: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }))

import { DailyAttendancePage } from '@/components/daily-attendance/DailyAttendancePage'
import { useAuth } from '@/context/AuthContext'
import { turkeyDate } from '@/components/daily-attendance/attendanceTime'
import { addDaysToDateString } from '@/lib/dateUtils'
import * as repo from '@/lib/api/attendance'

const asLevel = (access_level: string) =>
  vi.mocked(useAuth).mockReturnValue({ employee: { id: 'me', full_name: 'Yönetici', roles: { name: 'Müdür', access_level } } } as never)

const yesterday = addDaysToDateString(turkeyDate(Date.now()), -1)

function entry(record: Partial<AttendanceRecord> | null): DailyShiftEntry {
  return {
    employee: { id: 'emp-1', full_name: 'Ahmet Kaya', roles: { name: 'Kasiyer' }, role_id: null, active: true, created_at: '', updated_at: '' },
    shiftAssignment: {
      id: 'shift-1', employee_id: 'emp-1', shift_template_id: null, work_date: yesterday,
      start_time: '09:00', end_time: '18:00', is_on_leave: false, created_at: '', updated_at: '',
    },
    attendanceRecord: record && {
      id: 'rec-1', employee_id: 'emp-1', shift_assignment_id: 'shift-1', status: 'working',
      clock_in_at: `${yesterday}T06:00:00Z`, break_start_at: null, break_end_at: null, clock_out_at: null,
      completed_break_minutes: 0, verification_method: null, exception_note: null, created_at: '', updated_at: '',
      ...record,
    },
  }
}

describe('Günlük operasyon — önceki günler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.fetchDailyShifts).mockResolvedValue({ date: 'x', entries: [] })
  })

  it('yönetici önceki güne geçer; çıkış okutulmamış kayıt "Çıkış yok", canlı kartlar gizli', async () => {
    asLevel('manager')
    renderWithProviders(<DailyAttendancePage />)
    await waitFor(() => expect(repo.fetchDailyShifts).toHaveBeenCalledWith(undefined))

    vi.mocked(repo.fetchDailyShifts).mockResolvedValue({ date: yesterday, entries: [entry({ status: 'working' })] })
    fireEvent.click(await screen.findByRole('button', { name: 'Önceki gün' }))

    await waitFor(() => expect(repo.fetchDailyShifts).toHaveBeenCalledWith(yesterday))
    await screen.findByRole('cell', { name: /Ahmet Kaya/ })
    expect(screen.getAllByText('Çıkış yok').length).toBeGreaterThanOrEqual(2)   // kart + rozet (+ sekme)
    expect(screen.queryByText('Çalışıyor')).not.toBeInTheDocument()
    expect(screen.queryByText('Molada')).not.toBeInTheDocument()
    expect(screen.getByText(/Geçmiş gün/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sonraki gün' })).toBeEnabled()

    // "Bugün" ile geri dönülür
    vi.mocked(repo.fetchDailyShifts).mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Bugün' }))
    await waitFor(() => expect(screen.queryByText(/Geçmiş gün/)).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Sonraki gün' })).toBeDisabled()
  })

  it('çalışan yalnızca bugünü görür: gün seçici yok', async () => {
    asLevel('employee')
    renderWithProviders(<DailyAttendancePage />)
    await waitFor(() => expect(repo.fetchDailyShifts).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Önceki gün' })).not.toBeInTheDocument()
  })
})
