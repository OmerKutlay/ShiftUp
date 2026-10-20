import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/renderWithProviders'
import { EmployeeSelect } from '@/components/common/EmployeeSelect'

const employees = [
  { id: '1', full_name: 'Ömer Kutlay', roles: { name: 'Kasiyer' } },
  { id: '2', full_name: 'Ayşe Yılmaz', roles: { name: 'Garson' } },
  { id: '3', full_name: 'Can Demir', roles: { name: 'Aşçı' }, active: false },
]

describe('EmployeeSelect', () => {
  it('Türkçe karakterden bağımsız arar ve seçilen id ile onChange çağırır', async () => {
    const onChange = vi.fn()
    renderWithProviders(<EmployeeSelect employees={employees} value="" onChange={onChange} label="Çalışan" />)

    await userEvent.type(screen.getByLabelText('Çalışan'), 'omer')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Ömer Kutlay')

    await userEvent.click(options[0])
    expect(onChange).toHaveBeenCalledWith('1')
  })

  it('rol adına göre de filtreler ve pasif çalışanı işaretler', async () => {
    renderWithProviders(<EmployeeSelect employees={employees} value="" onChange={vi.fn()} label="Çalışan" />)

    await userEvent.type(screen.getByLabelText('Çalışan'), 'asci')
    expect(screen.getByRole('option')).toHaveTextContent('Can Demir (Pasif)')
  })

  it('eşleşme yoksa bilgi metni gösterir', async () => {
    renderWithProviders(<EmployeeSelect employees={employees} value="" onChange={vi.fn()} label="Çalışan" />)

    await userEvent.type(screen.getByLabelText('Çalışan'), 'xyz')
    expect(screen.getByText('Çalışan bulunamadı')).toBeInTheDocument()
  })
})
