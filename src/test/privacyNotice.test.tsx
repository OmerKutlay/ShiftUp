import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PrivacyNotice } from '@/components/kvkk/PrivacyNotice'
import { COMPANY_PLACEHOLDERS, KVKK_NOTICE_VERSION, resolveCompany } from '@/lib/kvkk'

describe('PrivacyNotice', () => {
  it('şirket bilgisi yokken yer tutucuları gösterir', () => {
    render(<PrivacyNotice company={null} />)
    const text = screen.getByTestId('privacy-notice').textContent ?? ''
    expect(text).toContain(COMPANY_PLACEHOLDERS.legal_name)
    expect(text).toContain(COMPANY_PLACEHOLDERS.kvkk_email)
    expect(text).toContain(KVKK_NOTICE_VERSION)
  })

  it('girilen şirket bilgisini yazar', () => {
    render(<PrivacyNotice company={{ legal_name: 'Örnek A.Ş.', address: 'Kadıköy', kvkk_email: 'kvkk@ornek.com' }} />)
    const text = screen.getByTestId('privacy-notice').textContent ?? ''
    expect(text).toContain('Örnek A.Ş.')
    expect(text).toContain('kvkk@ornek.com')
    expect(text).not.toContain('[Şirket unvanı]')
  })

  it('rıza değil bilgilendirme olduğunu, biyometrik veri işlenmediğini ve konumun yalnızca okutmada alındığını söyler', () => {
    render(<PrivacyNotice />)
    const text = screen.getByTestId('privacy-notice').textContent ?? ''
    expect(text).toContain('açık rıza metni değildir')
    expect(text).toContain('Biyometrik veri')
    expect(text).toContain('yalnızca QR okutulduğu anda')
    expect(text).toContain('m.5/2-c')
  })

  it('toplanma yöntemi, m.11/1-f bildirimi, m.9 mekanizmaları ve ç sebebinin İş K. m.41 dayanağı yer alır', () => {
    render(<PrivacyNotice />)
    const text = screen.getByTestId('privacy-notice').textContent ?? ''
    expect(text).toContain('toplanma yöntemi')
    expect(text).toContain('üçüncü kişilere bildirilmesini')
    expect(text).toContain('7499')
    expect(text).toContain('İş Kanunu m.41')
    expect(text).not.toContain('taahhütname')
    expect(text).not.toContain('şirket bu aktarımın')
  })

  it('resolveCompany eksik alanları bildirir', () => {
    expect(resolveCompany({ legal_name: 'X' }).missing).toEqual(['address', 'kvkk_email'])
  })
})
