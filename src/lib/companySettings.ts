/**
 * companySettings — şirket geneli (mağazadan bağımsız) tek satırlık ayar (yalnızca server).
 * Okuma hatası aydınlatma sayfasını bozmaz: boş ayar döner, metin yer tutucularla görünür.
 */
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { CompanySettings } from '@/lib/kvkk'

const EMPTY: CompanySettings = { legal_name: null, address: null, kvkk_email: null }

const CACHE_MS = 60_000
let cache: { at: number; value: CompanySettings } | null = null

/** PUT sonrası aynı isolate'ta önbelleği geçersiz kıl */
export function invalidateCompanySettingsCache() {
  cache = null
}

/** Oturumsuz /gizlilik trafiği veritabanını yormasın diye 60 sn modül düzeyinde önbellek */
export async function loadCompanySettingsCached(): Promise<CompanySettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value
  const value = await loadCompanySettings()
  cache = { at: Date.now(), value }
  return value
}

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
