import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material'
import { theme } from '@/lib/theme'
import type { ShiftTemplate } from '@/types/shiftTemplate'
import { LOADING_LABEL } from '@/components/common'

vi.mock('@/lib/api/shiftTemplates', () => ({
  fetchShiftTemplates: vi.fn(),
  createShiftTemplate: vi.fn(),
  updateShiftTemplate: vi.fn(),
  deactivateShiftTemplate: vi.fn(),
  activateShiftTemplate: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/shift-templates',
  useRouter: () => ({ push: vi.fn() }),
}))

import { ShiftTemplatesPage } from '@/components/shift-templates/ShiftTemplatesPage'
import * as repo from '@/lib/api/shiftTemplates'

// ============================================================
// Helpers
// ============================================================
function makeTemplate(overrides: Partial<ShiftTemplate> = {}): ShiftTemplate {
  return {
    id: 'tpl-001',
    name: 'Açılış',
    start_time: '09:00:00',
    end_time: '18:00:00',
    description: null,
    active: true,
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:00:00Z',
    ...overrides,
  }
}

function renderPage() {
  return render(
    <ThemeProvider theme={theme}>
      <ShiftTemplatesPage />
    </ThemeProvider>
  )
}

// ============================================================
// Tests
// ============================================================
describe('ShiftTemplatesPage — listeleme', () => {
  beforeEach(() => vi.clearAllMocks())

  it('şablon listesi yükleniyor ve görünüyor', async () => {
    vi.mocked(repo.fetchShiftTemplates).mockResolvedValue([makeTemplate()])

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Açılış')).toBeInTheDocument()
      expect(screen.getByText(/09:00/)).toBeInTheDocument()
    })
  })

  it('boş liste için bilgi mesajı gösterilir', async () => {
    vi.mocked(repo.fetchShiftTemplates).mockResolvedValue([])

    renderPage()

    // Loading bitmesini bekle (skeleton gitmeli)
    await waitFor(() => {
      expect(screen.queryByLabelText(LOADING_LABEL)).not.toBeInTheDocument()
    })

    // Alert render edilmeli ve içinde doğru metin olmalı
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert')
      const infoAlert = alerts.find((el) =>
        el.textContent?.includes('eklenmemiş') || el.textContent?.includes('Henüz')
      )
      expect(infoAlert).toBeDefined()
    })
  })

  it('aktif şablon sayısı header\'da gösterilir', async () => {
    vi.mocked(repo.fetchShiftTemplates).mockResolvedValue([
      makeTemplate({ active: true }),
      makeTemplate({ id: 'tpl-002', name: 'Kapanış', active: false }),
    ])

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/1 aktif şablon/i)).toBeInTheDocument()
    })
  })
})

describe('ShiftTemplatesPage — yeni şablon ekleme', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Yeni Şablon butonuna tıklayınca dialog açılır', async () => {
    vi.mocked(repo.fetchShiftTemplates).mockResolvedValue([])

    renderPage()

    await waitFor(() => screen.getByRole('button', { name: /yeni şablon/i }))
    await userEvent.click(screen.getByRole('button', { name: /yeni şablon/i }))

    expect(screen.getByText('Yeni Vardiya Şablonu')).toBeInTheDocument()
  })

  it('form submit edilince createShiftTemplate çağrılır', async () => {
    const created = makeTemplate({ id: 'new' })
    vi.mocked(repo.fetchShiftTemplates)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([created])
    vi.mocked(repo.createShiftTemplate).mockResolvedValue(created)

    renderPage()

    await waitFor(() => screen.getByRole('button', { name: /yeni şablon/i }))
    await userEvent.click(screen.getByRole('button', { name: /yeni şablon/i }))

    await userEvent.type(screen.getByRole('textbox', { name: /şablon adı/i }), 'Sabah')
    // time input'larını doldur
    const timeInputs = screen.getAllByRole('textbox')
    // start_time ve end_time type="time" alanları (textbox rolünde de görünebilir)
    const startInput = screen.getByLabelText(/başlangıç saati/i)
    const endInput = screen.getByLabelText(/bitiş saati/i)
    await userEvent.clear(startInput)
    await userEvent.type(startInput, '09:00')
    await userEvent.clear(endInput)
    await userEvent.type(endInput, '17:00')

    await userEvent.click(screen.getByRole('button', { name: /^ekle$/i }))

    await waitFor(() => {
      expect(repo.createShiftTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Sabah' })
      )
    })

    void timeInputs // suppress unused
  })
})

describe('ShiftTemplatesPage — düzenleme', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Düzenle butonuna tıklayınca dialog açılır ve mevcut data gelir', async () => {
    vi.mocked(repo.fetchShiftTemplates).mockResolvedValue([makeTemplate()])

    renderPage()

    await waitFor(() => screen.getByText('Açılış'))
    await userEvent.click(screen.getByRole('button', { name: /düzenle/i }))

    expect(screen.getByText('Şablonu Düzenle')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Açılış')).toBeInTheDocument()
  })
})

describe('ShiftTemplatesPage — pasif şablon', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pasif şablon listede görünür ve Pasif işareti taşır', async () => {
    vi.mocked(repo.fetchShiftTemplates).mockResolvedValue([
      makeTemplate({ active: false }),
    ])

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Açılış')).toBeInTheDocument()
      const passiveLabels = screen.getAllByText(/^Pasif$/)
      expect(passiveLabels.length).toBeGreaterThanOrEqual(1)
    })
  })
})
