/**
 * companySettings — şirket geneli (mağazadan bağımsız) tek satırlık ayar (yalnızca server).
 * Okuma hatası aydınlatma sayfasını bozmaz: boş ayar döner, metin yer tutucularla görünür.
 */
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { CompanySettings } from '@/lib/kvkk'

const EMPTY: CompanySettings = { legal_name: null, address: null, kvkk_email: null }

export async function loadCompanySettings(): Promise<CompanySettings> {
  try {
    const { data, error } = await createAdminClient()
      .from('company_settings')
      .select('legal_name, address, kvkk_email')
      .eq('id', true)
      .maybeSingle()
    if (error || !data) return EMPTY
    return data as CompanySettings
  } catch {
    return EMPTY
  }
}
