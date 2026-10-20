import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/renderWithProviders'
import { DateField, MonthField } from '@/components/common/DateField'

describe('DateField', () => {
  it('değeri Türkçe gösterir ve takvimden seçilen günü yyyy-MM-dd olarak döndürür', async () => {
    const onChange = vi.fn()
    renderWithProviders(<DateField label="Tarih" value="2026-10-16" onChange={onChange} />)

    const input = screen.getByLabelText('Tarih')
    expect(input).toHaveValue('16 Eki 2026, Cum')

    await userEvent.click(input)
    expect(screen.getByText('Ekim 2026')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '20 Ekim 2026, Salı' }))
    expect(onChange).toHaveBeenCalledWith('2026-10-20')
  })

  it('klavyeyle gezinir ve min/max dışındaki günleri devre dışı bırakır', async () => {
    const onChange = vi.fn()
    renderWithProviders(<DateField label="Tarih" value="2026-10-16" min="2026-10-10" max="2026-10-25" onChange={onChange} />)

    await userEvent.click(screen.getByLabelText('Tarih'))
    expect(screen.getByRole('button', { name: '9 Ekim 2026, Cuma' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '26 Ekim 2026, Pazartesi' })).toBeDisabled()

    await userEvent.keyboard('{ArrowRight}{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('2026-10-24')
  })

  it('temizlenebilir alanda boş değer döndürür', async () => {
    const onChange = vi.fn()
    renderWithProviders(<DateField label="Tarih" value="2026-10-16" onChange={onChange} clearable />)

    await userEvent.click(screen.getByLabelText('Tarih'))
    await userEvent.click(screen.getByRole('button', { name: 'Temizle' }))
    expect(onChange).toHaveBeenCalledWith('')
  })
})

describe('MonthField', () => {
  it('ay seçer ve yyyy-MM döndürür', async () => {
    const onChange = vi.fn()
    renderWithProviders(<MonthField label="Ay" value="2026-10" onChange={onChange} />)

    const input = screen.getByLabelText('Ay')
    expect(input).toHaveValue('Ekim 2026')

    await userEvent.click(input)
    await userEvent.click(screen.getByRole('button', { name: 'Mar' }))
    expect(onChange).toHaveBeenCalledWith('2026-03')
  })
})
