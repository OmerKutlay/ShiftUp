import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

function StoreSelect({ onValueChange = vi.fn(), searchable }: { onValueChange?: (v: string) => void; searchable?: boolean }) {
  return (
    <Select onValueChange={onValueChange}>
      <SelectTrigger aria-label="Mağaza"><SelectValue placeholder="Mağaza seçin" /></SelectTrigger>
      <SelectContent searchable={searchable}>
        <SelectItem value="1">Kadıköy</SelectItem>
        <SelectItem value="2"><span>Şişli</span> <span>· Merkez</span></SelectItem>
        <SelectItem value="3">Üsküdar</SelectItem>
      </SelectContent>
    </Select>
  )
}

// Gizlenen (eşleşmeyen) öğeler erişilebilirlik ağacından da çıkar
const visibleOptions = () => screen.queryAllByRole('option').map((o) => o.textContent)

describe('Select arama kutusu', () => {
  it('Türkçe karakterden bağımsız filtreler, iç içe metinde de arar', async () => {
    render(<StoreSelect />)
    await userEvent.click(screen.getByLabelText('Mağaza'))
    const search = screen.getByRole('textbox', { name: 'Ara...' })

    await userEvent.type(search, 'sisli')
    expect(visibleOptions()).toEqual(['Şişli · Merkez'])

    await userEvent.clear(search)
    await userEvent.type(search, 'merkez')
    expect(visibleOptions()).toEqual(['Şişli · Merkez'])
  })

  it('eşleşme yoksa bilgi metni gösterir', async () => {
    render(<StoreSelect />)
    await userEvent.click(screen.getByLabelText('Mağaza'))
    await userEvent.type(screen.getByRole('textbox', { name: 'Ara...' }), 'xyz')
    expect(visibleOptions()).toEqual([])
    expect(screen.getByText('Sonuç bulunamadı')).toBeInTheDocument()
  })

  it("Enter görünen ilk seçeneği seçer", async () => {
    const onValueChange = vi.fn()
    render(<StoreSelect onValueChange={onValueChange} />)
    await userEvent.click(screen.getByLabelText('Mağaza'))
    await userEvent.type(screen.getByRole('textbox', { name: 'Ara...' }), 'usk{Enter}')
    expect(onValueChange).toHaveBeenCalledWith('3')
  })

  it('searchable={false} arama kutusunu kapatır', async () => {
    render(<StoreSelect searchable={false} />)
    await userEvent.click(screen.getByLabelText('Mağaza'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(visibleOptions()).toHaveLength(3)
  })
})
