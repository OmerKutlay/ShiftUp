import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material'
import { theme } from '@/lib/theme'
import type { DailyShiftEntry, AttendanceRecord } from '@/types/attendance'

// ============================================================
// Mock repository — must be hoisted above imports
// ============================================================
vi.mock('@/lib/api/attendance', () => ({
  fetchDailyShifts: vi.fn(),
  performManualAttendanceAction: vi.fn(),
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
      role: 'Kasiyer',
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
  return render(
    <ThemeProvider theme={theme}>
      <DailyAttendancePage />
    </ThemeProvider>
  )
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

describe('DailyAttendancePage — attendance aksiyonları', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. Vardiya bekleyen çalışan "Giriş Yap" butonunu görür', async () => {
    vi.mocked(repo.fetchDailyShifts).mockResolvedValue({ date: '2026-09-28', entries: [makeShiftEntry()] })

    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /giriş yap/i })).toBeInTheDocument()
    })
  })

  it('2. Giriş yapıldıktan sonra durum Çalışıyor olur', async () => {
    vi.mocked(repo.fetchDailyShifts).mockResolvedValue({ date: '2026-09-28', entries: [makeShiftEntry()] })
    const workingRecord = makeAttendanceRecord({ status: 'working' })
    vi.mocked(repo.performManualAttendanceAction).mockResolvedValue(workingRecord)

    renderPage()

    const btn = await screen.findByRole('button', { name: /giriş yap/i })
    await userEvent.click(btn)

    await waitFor(() => {
      // 'Çalışıyor' appears both in stat card and in the status chip
      const elements = screen.getAllByText('Çalışıyor')
      expect(elements.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('4. Çalışan molaya çıkabilir — "Molaya Çık" butonu görünür', async () => {
    vi.mocked(repo.fetchDailyShifts).mockResolvedValue({ date: '2026-09-28', entries: [
      makeShiftEntry({ attendanceRecord: makeAttendanceRecord({ status: 'working' }) }),
    ] })

    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /molaya çık/i })).toBeInTheDocument()
    })
  })

  it('5. Molada iken "Molaya Çık" butonu görünmez', async () => {
    vi.mocked(repo.fetchDailyShifts).mockResolvedValue({ date: '2026-09-28', entries: [
      makeShiftEntry({
        attendanceRecord: makeAttendanceRecord({
          status: 'on_break',
          break_start_at: '2026-09-28T09:00:00Z',
        }),
      }),
    ] })

    renderPage()

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /molaya çık/i })).not.toBeInTheDocument()
    })
  })

  it('6. Çalışan moladan dönebilir — "Moladan Dön" butonu görünür', async () => {
    vi.mocked(repo.fetchDailyShifts).mockResolvedValue({ date: '2026-09-28', entries: [
      makeShiftEntry({
        attendanceRecord: makeAttendanceRecord({
          status: 'on_break',
          break_start_at: '2026-09-28T09:00:00Z',
        }),
      }),
    ] })

    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /moladan dön/i })).toBeInTheDocument()
    })
  })

  it('7. Çalışan çıkış yapabilir — "Çıkış Yap" butonu görünür', async () => {
    vi.mocked(repo.fetchDailyShifts).mockResolvedValue({ date: '2026-09-28', entries: [
      makeShiftEntry({ attendanceRecord: makeAttendanceRecord({ status: 'working' }) }),
    ] })

    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /çıkış yap/i })).toBeInTheDocument()
    })
  })

  it('8. Çıkış yapıldıktan sonra aksiyon butonu yoktur', async () => {
    vi.mocked(repo.fetchDailyShifts).mockResolvedValue({ date: '2026-09-28', entries: [
      makeShiftEntry({
        attendanceRecord: makeAttendanceRecord({
          status: 'clocked_out',
          clock_in_at: '2026-09-28T06:00:00Z',
          clock_out_at: '2026-09-28T14:00:00Z',
        }),
      }),
    ] })

    renderPage()

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /giriş yap/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /çıkış yap/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /molaya çık/i })).not.toBeInTheDocument()
    })
  })
})
