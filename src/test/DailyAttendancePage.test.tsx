import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './helpers/renderWithProviders'
import type { DailyShiftEntry, AttendanceRecord } from '@/types/attendance'

// ============================================================
// Mock repository — must be hoisted above imports
// ============================================================
vi.mock('@/lib/api/attendance', () => ({
  fetchDailyShifts: vi.fn(),
}))

// ============================================================
// Static imports (after vi.mock hoisting)
// ============================================================
import { DailyAttendancePage } from '@/components/daily-attendance/DailyAttendancePage'
import * as repo from '@/lib/api/attendance'

// ============================================================
// Test helpers
// ============================================================
function makeShiftEntry(overrides: Partial<DailyShiftEntry> = {}): DailyShiftEntry {
  return {
    employee: {
      id: 'emp-001',
      full_name: 'Ahmet Kaya',
      roles: { name: 'Kasiyer' },
      role_id: null,
      active: true,
      created_at: '2026-09-28T00:00:00Z',
      updated_at: '2026-09-28T00:00:00Z',
    },
    shiftAssignment: {
      id: 'shift-001',
      employee_id: 'emp-001',
      shift_template_id: null,
      work_date: '2026-09-28',
      start_time: '09:00',
      end_time: '18:00',
      is_on_leave: false,
      created_at: '2026-09-28T00:00:00Z',
      updated_at: '2026-09-28T00:00:00Z',
    },
    attendanceRecord: null,
    ...overrides,
  }
}

function makeAttendanceRecord(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: 'rec-001',
    employee_id: 'emp-001',
    shift_assignment_id: 'shift-001',
    status: 'working',
    clock_in_at: '2026-09-28T06:00:00Z',
    break_start_at: null,
    break_end_at: null,
    clock_out_at: null,
    completed_break_minutes: 0,
    verification_method: null,
    exception_note: null,
    created_at: '2026-09-28T06:00:00Z',
    updated_at: '2026-09-28T06:00:00Z',
    ...overrides,
  }
}

function renderPage() {
  return renderWithProviders(<DailyAttendancePage />)
}

// ============================================================
// Tests
// ============================================================

describe('DailyAttendancePage — sayfa yükleme (Senaryo 10)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('10. Supabase vardiyaları gösterir', async () => {
    vi.mocked(repo.fetchDailyShifts).mockResolvedValue({ date: '2026-09-28', entries: [makeShiftEntry()] })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Ahmet Kaya')).toBeInTheDocument()
      expect(screen.getByText('Kasiyer')).toBeInTheDocument()
    })
  })

  it('Boş vardiya listesi için bilgi mesajı gösterilir', async () => {
    vi.mocked(repo.fetchDailyShifts).mockResolvedValue({ date: '2026-09-28', entries: [] })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/planlanmış vardiya bulunamadı/i)).toBeInTheDocument()
    })
  })
})

describe('DailyAttendancePage — salt okunur (giriş/mola/çıkış yalnızca QR ile)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['shift_waiting', null],
    ['working', makeAttendanceRecord({ status: 'working' })],
    ['on_break', makeAttendanceRecord({ status: 'on_break', break_start_at: '2026-09-28T09:00:00Z' })],
  ] as const)('%s durumunda manuel giriş/mola/çıkış butonu yoktur', async (_status, record) => {
    vi.mocked(repo.fetchDailyShifts).mockResolvedValue({
      date: '2026-09-28',
      entries: [makeShiftEntry({ attendanceRecord: record })],
    })

    renderPage()

    await screen.findByText('Ahmet Kaya')
    for (const name of [/giriş yap/i, /molaya çık/i, /moladan dön/i, /çıkış yap/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('QR ile işlenen durum ve saatler gösterilir', async () => {
    vi.mocked(repo.fetchDailyShifts).mockResolvedValue({ date: '2026-09-28', entries: [
      makeShiftEntry({ attendanceRecord: makeAttendanceRecord({ status: 'working' }) }),
    ] })

    renderPage()

    await waitFor(() => {
      // 'Çalışıyor' hem istatistik kartında hem durum çipinde görünür
      expect(screen.getAllByText('Çalışıyor').length).toBeGreaterThanOrEqual(2)
      expect(screen.getByText(/Giriş:/)).toBeInTheDocument()
    })
  })
})
