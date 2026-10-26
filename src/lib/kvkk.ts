/**
 * kvkk — KVKK (6698) aydınlatma metni sabitleri ve ortak tipler (client + server güvenli).
 *
 * Aydınlatma metni bir RIZA metni değildir: devam/konum verisinin işlenme dayanağı iş sözleşmesinin
 * ifası ve İş Kanunu'ndan doğan yükümlülük ile meşru menfaattir (KVKK m.5/2-c, ç, f). Çalışan yalnızca
 * "okudum, bilgilendirildim" diye teyit eder. Metin ağırlıklı değiştirildiğinde sürüm artırılır; sürümü
 * onaylamamış çalışanlara kart yeniden gösterilir.
 */

/** Güncel aydınlatma metni sürümü (metin içeriği değişince artırılır) */
export const KVKK_NOTICE_VERSION = '2026-10-28'

export interface CompanySettings {
  legal_name: string | null
  address: string | null
  kvkk_email: string | null
}

export const COMPANY_PLACEHOLDERS = {
  legal_name: '[Şirket unvanı]',
  address: '[Şirket adresi]',
  kvkk_email: '[KVKK başvuru e-posta adresi]',
} as const

export const COMPANY_FIELD_LIMITS = { legal_name: 200, address: 500, kvkk_email: 200 } as const

/** Boş alanları yer tutucuyla doldurur; hangi alanların henüz girilmediğini de bildirir */
export function resolveCompany(settings: Partial<CompanySettings> | null | undefined) {
  const pick = (v: string | null | undefined, ph: string) => (v && v.trim() ? v.trim() : ph)
  const legal_name = pick(settings?.legal_name, COMPANY_PLACEHOLDERS.legal_name)
  const address = pick(settings?.address, COMPANY_PLACEHOLDERS.address)
  const kvkk_email = pick(settings?.kvkk_email, COMPANY_PLACEHOLDERS.kvkk_email)
  const missing: (keyof CompanySettings)[] = []
  if (legal_name === COMPANY_PLACEHOLDERS.legal_name) missing.push('legal_name')
  if (address === COMPANY_PLACEHOLDERS.address) missing.push('address')
  if (kvkk_email === COMPANY_PLACEHOLDERS.kvkk_email) missing.push('kvkk_email')
  return { legal_name, address, kvkk_email, missing }
}

export interface KvkkAckStatus {
  version: string
  acknowledged: boolean
  acknowledged_at: string | null
  acknowledged_version: string | null
}

export interface KvkkAckRow {
  id: string
  full_name: string
  kvkk_notice_ack_at: string | null
  kvkk_notice_version: string | null
}

export const PRIVACY_PATH = '/gizlilik'
