import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ViewportDiagnostics } from '@/components/pwa/ViewportDiagnostics'

function mockStandalone(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('standalone') ? matches : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

describe('ViewportDiagnostics', () => {
  const original = window.matchMedia
  afterEach(() => { window.matchMedia = original })

  it('tarayıcı sekmesinde görünmez', () => {
    mockStandalone(false)
    const { container } = render(<ViewportDiagnostics />)
    expect(container).toBeEmptyDOMElement()
  })

  it('ana ekran uygulamasında açılınca ölçümleri gösterir', async () => {
    mockStandalone(true)
    render(<ViewportDiagnostics />)
    await userEvent.click(await screen.findByRole('button', { name: /ekran bilgisi/i }))
    expect(screen.getByText('innerHeight')).toBeInTheDocument()
    expect(screen.getByText('safe-area üst / alt')).toBeInTheDocument()
  })
})
