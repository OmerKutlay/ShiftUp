import type { Metadata } from 'next'
import { Page } from '@/components/common'
import { PrivacyNotice } from '@/components/kvkk/PrivacyNotice'
import { PrivacyAdminNote, PrivacyBackLink } from '@/components/kvkk/PrivacyPageExtras'
import { loadCompanySettings } from '@/lib/companySettings'

export const metadata: Metadata = { title: 'Aydınlatma metni' }
// Şirket bilgisi Ayarlar'dan değişir; derleme anında dondurulmasın
export const dynamic = 'force-dynamic'

/** Oturumsuz da açılır (middleware PUBLIC_PATHS) */
export default async function PrivacyPage() {
  const company = await loadCompanySettings()
  return (
    <Page size="narrow">
      <PrivacyBackLink />
      <PrivacyAdminNote company={company} />
      <PrivacyNotice company={company} />
    </Page>
  )
}
