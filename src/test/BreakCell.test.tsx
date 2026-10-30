import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { BreakCell } from '@/components/daily-attendance/BreakDetails'
import type { BreakItem } from '@/lib/attendanceDurations'

const T = (hm: string) => `2026-10-30T${hm}:00+03:00`

describe('BreakCell — satırda özet, pencerede ayrıntı', () => {
  const breaks: BreakItem[] = [
    { start_at: T('11:00'), end_at: T('11:15'), minutes: 15 },
    { start_at: T('14:00'), end_at: null, minutes: null },
  ]
  const now = new Date(T('14:12')).getTime()

  it('satırda toplam ve süren molanın sırası; saatler pencerede', async () => {
    render(<BreakCell breaks={breaks} now={now} />)
    const trigger = screen.getByRole('button', { name: 'Molalar: 2 mola, toplam 27 dk, 2. mola sürüyor' })
    expect(trigger).toHaveTextContent('27 dk')
    expect(trigger).toHaveTextContent('2. mola sürüyor')
    expect(screen.queryByText('1. mola')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(await screen.findByText('1. mola')).toBeInTheDocument()
    expect(screen.getByText('11:00 – 11:15')).toBeInTheDocument()
    expect(screen.getByText('15 dk')).toBeInTheDocument()
    expect(screen.getByText('2. mola')).toBeInTheDocument()
    expect(screen.getByText('sürüyor')).toBeInTheDocument()
    expect(screen.getByText('12 dk')).toBeInTheDocument()
    expect(screen.getByText('Toplam')).toBeInTheDocument()
  })

  it('mola yoksa tire', () => {
    render(<BreakCell breaks={[]} now={now} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
