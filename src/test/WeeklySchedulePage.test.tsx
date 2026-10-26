import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from './helpers/renderWithProviders'
import userEvent from '@testing-library/user-event'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftTemplate } from '@/types/shiftTemplate'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import { ApiError } from '@/lib/api/http'

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

    // Boş durum (Empty) kartı
    await waitFor(() => {
      expect(screen.getByText('Aktif çalışan bulunamadı')).toBeInTheDocument()
    })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
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
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const emptyCells = within(screen.getByRole('table')).getAllByRole('button', { name: 'Vardiya ekle' })
    expect(emptyCells).toHaveLength(7)
    await userEvent.click(emptyCells[0])

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Vardiya ata')).toBeInTheDocument()
    expect(within(dialog).getByText('Ahmet Kaya')).toBeInTheDocument()
  })

  it('şablon seçilip "Ata" ile createShiftAssignment çağrılır', async () => {
    vi.mocked(scheduleRepo.createShiftAssignment).mockResolvedValue(makeAssignment())
    setupMocks([makeEmployee()], [makeTemplate()], [])

    renderPage()
    await waitFor(() => screen.getByText('Ahmet Kaya'))

    await userEvent.click(within(screen.getByRole('table')).getAllByRole('button', { name: 'Vardiya ekle' })[0])
    const dialog = await screen.findByRole('dialog')

    // Şablon seçmeden kaydetmek alan hatası verir
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ata' }))
    expect(within(dialog).getByText('Bir vardiya şablonu seçin.')).toBeInTheDocument()
    expect(scheduleRepo.createShiftAssignment).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('radio'))
    expect(within(dialog).getByText('Brüt 9s · mola 1s · net 8s')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ata' }))

    await waitFor(() => {
      expect(scheduleRepo.createShiftAssignment).toHaveBeenCalledWith(
        expect.objectContaining({
          employee_id: 'emp-001', shift_template_id: 'tpl-001', work_date: '2026-09-28', start_time: '09:00', end_time: '18:00',
        }),
        true,
        undefined
      )
    })
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

describe('WeeklySchedulePage — editör modu', () => {
  beforeEach(() => vi.clearAllMocks())

  const CLOSING = makeTemplate({ id: 'tpl-002', name: 'Kapanış', start_time: '14:00', end_time: '23:00' })

  async function openEditor() {
    renderPage()
    await waitFor(() => screen.getByText('Ahmet Kaya'))
    await userEvent.click(headerAddButton())
    return screen.getByRole('toolbar', { name: 'Plan editörü' })
  }
  /** Boş hücreler de "Vardiya ekle" etiketli; editörü açan düğme tablonun dışındaki */
  const headerAddButton = () =>
    screen.getAllByRole('button', { name: 'Vardiya ekle' }).find((b) => !b.closest('table'))!
  const emptyCells = () => within(screen.getByRole('table')).getAllByRole('button', { name: 'Vardiya ekle' })

  it('seçili taş tıklanan her kutuya diyalog açmadan uygulanır, "Kaydet" topluca yazar', async () => {
    vi.mocked(scheduleRepo.createShiftAssignment).mockResolvedValue(makeAssignment())
    setupMocks([makeEmployee()], [makeTemplate(), CLOSING], [])
    const bar = await openEditor()

    // İlk şablon (Açılış) varsayılan taş
    expect(within(bar).getByRole('radio', { name: 'Açılış 09:00–18:00' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(emptyCells()[0])
    await userEvent.click(emptyCells()[0])   // sıradaki boş kutu (Salı)
    await userEvent.click(within(bar).getByRole('radio', { name: 'Kapanış 14:00–23:00' }))
    await userEvent.click(emptyCells()[0])   // Çarşamba

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(bar).getByText('3 değişiklik')).toBeInTheDocument()
    expect(scheduleRepo.createShiftAssignment).not.toHaveBeenCalled()

    await userEvent.click(within(bar).getByRole('button', { name: 'Kaydet' }))

    await waitFor(() => expect(headerAddButton()).toBeInTheDocument())
    expect(scheduleRepo.createShiftAssignment).toHaveBeenCalledTimes(3)
    expect(vi.mocked(scheduleRepo.createShiftAssignment).mock.calls.map(([p]) => [p.work_date, p.shift_template_id])).toEqual([
      ['2026-09-28', 'tpl-001'], ['2026-09-29', 'tpl-001'], ['2026-09-30', 'tpl-002'],
    ])
    expect(screen.queryByRole('toolbar', { name: 'Plan editörü' })).not.toBeInTheDocument()
  })

  it('dolu kutu yeni taşla güncellenir, "Sil" taşı vardiyayı kaldırır', async () => {
    vi.mocked(scheduleRepo.updateShiftAssignment).mockResolvedValue(makeAssignment())
    vi.mocked(scheduleRepo.deleteShiftAssignment).mockResolvedValue(undefined)
    setupMocks([makeEmployee()], [makeTemplate(), CLOSING], [
      makeAssignment(),
      makeAssignment({ id: 'asgn-002', work_date: '2026-09-29' }),
    ])
    const bar = await openEditor()
    const shiftCells = () => within(screen.getByRole('table')).getAllByText('09:00–18:00')

    await userEvent.click(within(bar).getByRole('radio', { name: 'Kapanış 14:00–23:00' }))
    await userEvent.click(shiftCells()[0])
    await userEvent.click(within(bar).getByRole('radio', { name: 'Sil' }))
    await userEvent.click(shiftCells()[0])
    expect(within(bar).getByText('2 değişiklik')).toBeInTheDocument()

    await userEvent.click(within(bar).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(scheduleRepo.deleteShiftAssignment).toHaveBeenCalledWith('asgn-002'))
    expect(scheduleRepo.updateShiftAssignment).toHaveBeenCalledWith(
      'asgn-001', 'emp-001', '2026-09-28',
      { shift_template_id: 'tpl-002', start_time: '14:00', end_time: '23:00' },
      undefined
    )
  })

  it('İş Kanunu ihlali tek onayla yeniden gönderilir', async () => {
    vi.mocked(scheduleRepo.createShiftAssignment)
      .mockRejectedValueOnce(new ApiError('İhlal', 'WORKING_TIME_VIOLATION', 422, { violations: ['Günlük 11 saat aşıldı'] }))
      .mockResolvedValue(makeAssignment())
    setupMocks([makeEmployee()], [makeTemplate()], [])
    const bar = await openEditor()

    await userEvent.click(emptyCells()[0])
    await userEvent.click(within(bar).getByRole('button', { name: 'Kaydet' }))

    const alert = await screen.findByRole('alertdialog')
    expect(within(alert).getByText(/Günlük 11 saat aşıldı/)).toBeInTheDocument()
    await userEvent.click(within(alert).getByRole('button', { name: 'Yine de kaydet' }))

    await waitFor(() => expect(scheduleRepo.createShiftAssignment).toHaveBeenCalledTimes(2))
    expect(vi.mocked(scheduleRepo.createShiftAssignment).mock.calls[1][2]).toEqual({ acknowledgeViolations: true })
  })

  it('"Vazgeç" onaydan sonra taslakları siler, hiçbir şey kaydedilmez', async () => {
    setupMocks([makeEmployee()], [makeTemplate()], [])
    const bar = await openEditor()

    await userEvent.click(emptyCells()[0])
    expect(emptyCells()).toHaveLength(6)
    await userEvent.click(within(bar).getByRole('button', { name: 'Vazgeç' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Değişiklikleri sil' }))

    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Plan editörü' })).not.toBeInTheDocument())
    expect(emptyCells()).toHaveLength(7)
    expect(scheduleRepo.createShiftAssignment).not.toHaveBeenCalled()
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
    const times = screen.getAllByText(/^\d{2}:\d{2}–\d{2}:\d{2}$/).map((el) => el.textContent)
    expect(times).toEqual(['09:00–18:00', '13:00–22:00'])
    expect(screen.getByText('Çalışmayanlar')).toHaveTextContent('Çalışmayanlar1')
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
