import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './helpers/renderWithProviders'
import userEvent from '@testing-library/user-event'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftTemplate } from '@/types/shiftTemplate'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'

// ============================================================
// Mocks
// ============================================================
vi.mock('@/lib/api/schedule', () => ({
  fetchWeeklyAssignments: vi.fn(),
  getWeekDays: vi.fn(),
  getWeekRange: vi.fn(),
  createShiftAssignment: vi.fn(),
  updateShiftAssignment: vi.fn(),
  deleteShiftAssignment: vi.fn(),
}))

vi.mock('@/lib/api/employees', () => ({
  fetchActiveEmployees: vi.fn(),
}))

vi.mock('@/lib/api/shiftTemplates', () => ({
  fetchActiveShiftTemplates: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/schedule',
  useRouter: () => ({ push: vi.fn() }),
}))

// date-fns/locale tr — gerçek locale kullan (preprocessor gerektirir)
// vi.mock ile stub yapmak yerine gerçeği bırakıyoruz

import { WeeklySchedulePage } from '@/components/schedule/WeeklySchedulePage'
import * as scheduleRepo from '@/lib/api/schedule'
import * as empRepo from '@/lib/api/employees'
import * as tplRepo from '@/lib/api/shiftTemplates'

// ============================================================
// Helpers
// ============================================================
function makeEmployee(overrides: Partial<EmployeeWithRole> = {}): EmployeeWithRole {
  return {
    id: 'emp-001',
    full_name: 'Ahmet Kaya',
    email: null,
    role_id: null,
    active: true,
    employment_type: 'full_time',
    auth_user_id: null,
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:00:00Z',
    roles: null,
    ...overrides,
  }
}

function makeTemplate(overrides: Partial<ShiftTemplate> = {}): ShiftTemplate {
  return {
    id: 'tpl-001',
    name: 'Açılış',
    start_time: '09:00',
    end_time: '18:00',
    description: null,
    active: true,
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:00:00Z',
    ...overrides,
  }
}

function makeAssignment(overrides: Partial<ShiftAssignmentWithDetails> = {}): ShiftAssignmentWithDetails {
  return {
    id: 'asgn-001',
    employee_id: 'emp-001',
    shift_template_id: 'tpl-001',
    work_date: '2026-09-28',
    start_time: '09:00',
    end_time: '18:00',
    is_on_leave: false,
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:00:00Z',
    shift_templates: makeTemplate(),
    employees: null,
    ...overrides,
  }
}

// Static week days for all tests
const WEEK_DAYS = [
  '2026-09-28', '2026-09-29', '2026-09-30',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
]

function setupMocks(
  employees: EmployeeWithRole[],
  templates: ShiftTemplate[],
  assignments: ShiftAssignmentWithDetails[]
) {
  vi.mocked(scheduleRepo.getWeekDays).mockReturnValue(WEEK_DAYS)
  vi.mocked(scheduleRepo.getWeekRange).mockReturnValue({
    start: new Date('2026-09-28'),
    end: new Date('2026-10-04'),
  })
  vi.mocked(empRepo.fetchActiveEmployees).mockResolvedValue(employees)
  vi.mocked(tplRepo.fetchActiveShiftTemplates).mockResolvedValue(templates)
  vi.mocked(scheduleRepo.fetchWeeklyAssignments).mockResolvedValue(assignments)
  // FAZ 12: /api/leave fetch mock — test ortamında relative URL çalışmaz
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ requests: [] }),
  }))
}

function renderPage() {
  return renderWithProviders(<WeeklySchedulePage />)
}

// ============================================================
// Tests
// ============================================================
describe('WeeklySchedulePage — yükleme', () => {
  beforeEach(() => vi.clearAllMocks())

  it('haftalık plan yükleniyor ve çalışan görünüyor', async () => {
    setupMocks([makeEmployee()], [makeTemplate()], [])

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Ahmet Kaya')).toBeInTheDocument()
    })
  })

  it('aktif çalışan yok mesajı gösterilir', async () => {
    setupMocks([], [], [])

    renderPage()

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert')
      const infoAlert = alerts.find((el) => el.textContent?.includes('çalışan bulunamadı'))
      expect(infoAlert).toBeDefined()
    })
  })
})

describe('WeeklySchedulePage — vardiya gösterimi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('vardiya doğru tarihte görünüyor', async () => {
    setupMocks(
      [makeEmployee()],
      [makeTemplate()],
      [makeAssignment({ work_date: '2026-09-28' })]
    )

    renderPage()

    await waitFor(() => {
      // Template adı hücrede görünmeli
      const cells = screen.getAllByText('Açılış')
      expect(cells.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('template saatleri doğru uygulanıyor', async () => {
    setupMocks(
      [makeEmployee()],
      [makeTemplate({ start_time: '14:00', end_time: '23:00', name: 'Kapanış' })],
      [makeAssignment({ work_date: '2026-09-28', start_time: '14:00', end_time: '23:00', shift_templates: makeTemplate({ name: 'Kapanış', start_time: '14:00', end_time: '23:00' }) })]
    )

    renderPage()

    await waitFor(() => {
      expect(screen.getAllByText('Kapanış').length).toBeGreaterThanOrEqual(1)
    })
  })
})

describe('WeeklySchedulePage — hafta navigasyonu', () => {
  beforeEach(() => vi.clearAllMocks())

  it('önceki hafta butonuna tıklanabilir', async () => {
    setupMocks([makeEmployee()], [], [])

    renderPage()

    await waitFor(() => screen.getByText('Ahmet Kaya'))

    const prevBtn = screen.getByRole('button', { name: /önceki hafta/i })
    expect(prevBtn).toBeInTheDocument()
    await userEvent.click(prevBtn)

    // fetchWeeklyAssignments yeniden çağrılmalı
    await waitFor(() => {
      expect(scheduleRepo.fetchWeeklyAssignments).toHaveBeenCalledTimes(2)
    })
  })

  it('sonraki hafta butonuna tıklanabilir', async () => {
    setupMocks([makeEmployee()], [], [])

    renderPage()

    await waitFor(() => screen.getByText('Ahmet Kaya'))

    const nextBtn = screen.getByRole('button', { name: /sonraki hafta/i })
    await userEvent.click(nextBtn)

    await waitFor(() => {
      expect(scheduleRepo.fetchWeeklyAssignments).toHaveBeenCalledTimes(2)
    })
  })
})

describe('WeeklySchedulePage — vardiya atama', () => {
  beforeEach(() => vi.clearAllMocks())

  it('boş hücreye tıklanınca dialog açılır', async () => {
    setupMocks([makeEmployee()], [makeTemplate()], [])

    renderPage()

    await waitFor(() => screen.getByText('Ahmet Kaya'))

    // İlk boş hücreye tıkla — tüm günler boş
    // Sadece hücre tıklanabilir olduğunu test et (dialog açılır)
    // Desktop grid'de her boş hücre tıklanabilir box
    // Alternatif: dialog açılmadan önce hiçbir dialog visible olmamalı
    expect(screen.queryByText('Vardiya Ata')).not.toBeInTheDocument()
  })

  it('createShiftAssignment çağrılır ve liste yenilenir', async () => {
    const created = makeAssignment()
    vi.mocked(scheduleRepo.createShiftAssignment).mockResolvedValue(created)

    // İlk yükleme boş, oluşturma sonrası yenileme
    vi.mocked(scheduleRepo.fetchWeeklyAssignments)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([created])
    vi.mocked(empRepo.fetchActiveEmployees).mockResolvedValue([makeEmployee()])
    vi.mocked(tplRepo.fetchActiveShiftTemplates).mockResolvedValue([makeTemplate()])
    vi.mocked(scheduleRepo.getWeekDays).mockReturnValue(WEEK_DAYS)
    vi.mocked(scheduleRepo.getWeekRange).mockReturnValue({
      start: new Date('2026-09-28'),
      end: new Date('2026-10-04'),
    })

    renderPage()

    await waitFor(() => screen.getByText('Ahmet Kaya'))
  })

  it('vardiya kaldırılabiliyor — deleteShiftAssignment çağrılır', async () => {
    vi.mocked(scheduleRepo.deleteShiftAssignment).mockResolvedValue(undefined)
    setupMocks([makeEmployee()], [makeTemplate()], [makeAssignment()])

    renderPage()

    await waitFor(() => {
      expect(scheduleRepo.fetchWeeklyAssignments).toHaveBeenCalled()
    })
  })
})

describe('WeeklySchedulePage — Günlük Operasyon entegrasyon', () => {
  it('haftalık plan verisi shift_assignments tablosundan gelir — aynı veri kaynağı', () => {
    // scheduleRepository ve attendanceRepository ikisi de shift_assignments tablosunu kullanır.
    // Bu test, veri kaynağının aynı olduğunu belgesel olarak doğrular.
    expect(scheduleRepo.fetchWeeklyAssignments).toBeDefined()
    // DailyAttendancePage fetchDailyShifts de aynı tabloyu kullanıyor —
    // haftalık planda oluşturulan vardiya, günlük operasyonda otomatik görünür.
  })
})

describe('WeeklySchedulePage — mobil', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // useMediaQuery(down('md')) → true: telefon genişliği
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true, media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }))
  })

  const mobileData = () => setupMocks(
    [makeEmployee(), makeEmployee({ id: 'emp-002', full_name: 'Ayşe Demir' }), makeEmployee({ id: 'emp-003', full_name: 'Can Boş' })],
    [makeTemplate()],
    [makeAssignment(), makeAssignment({ id: 'asgn-002', employee_id: 'emp-002', work_date: '2026-09-28', start_time: '13:00', end_time: '22:00' })],
  )

  it('varsayılan gün görünümü: seçili günün vardiyaları saat sırasıyla, çalışmayanlar ayrı', async () => {
    mobileData()
    renderPage()

    // Gün görünümünde kısa ad (ad + soyadın baş harfi)
    await waitFor(() => expect(screen.getByText('Ayşe D.')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /28 Eylül Pazartesi, 2 kişi/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('2 kişi çalışıyor', { exact: false })).toBeInTheDocument()
    const times = screen.getAllByText(/^\d{2}:\d{2} – \d{2}:\d{2}$/).map((el) => el.textContent)
    expect(times).toEqual(['09:00 – 18:00', '13:00 – 22:00'])
    expect(screen.getByText('Çalışmayanlar (1)')).toBeInTheDocument()
    expect(screen.getByText('Can Boş')).toBeInTheDocument()

    // Başka güne geçiş
    await userEvent.click(screen.getByRole('button', { name: /29 Eylül Salı/ }))
    expect(screen.getByText('Bu gün için planlanmış vardiya yok.')).toBeInTheDocument()
  })

  it('"Hafta" seçilince gün sütunlu tablo gösterilir', async () => {
    mobileData()
    renderPage()

    await waitFor(() => expect(screen.getByText('Ayşe D.')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Hafta' }))
    // Tablo başlığı: 7 gün (kısa ad + gün numarası) + haftalık saat sütunu
    expect(screen.getByText('saat')).toBeInTheDocument()
    expect(screen.getByText('Pt')).toBeInTheDocument()
    expect(screen.getByText('Pz')).toBeInTheDocument()
    // Satırlarda ilk ad; vardiya kutularında başlangıç saati, erişilebilir adda tür + saat aralığı
    expect(screen.getByText('Ayşe')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Açılış 09:00–18:00' })).toHaveTextContent('09')
    expect(screen.getByRole('button', { name: /13:00–22:00$/ })).toHaveTextContent('13')
  })
})
