/**
 * Client tarafı KVKK API'si — /api/kvkk/*, /api/company-settings
 */
import { apiFetch } from './http'
import type { CompanySettings, KvkkAckRow, KvkkAckStatus } from '@/lib/kvkk'

export const KVKK_ACK_KEY = '/api/kvkk/ack'
export const KVKK_LIST_KEY = '/api/kvkk/acknowledgements'
export const COMPANY_SETTINGS_KEY = '/api/company-settings'

export const fetchKvkkAckStatus = () => apiFetch<KvkkAckStatus>(KVKK_ACK_KEY)

export const acknowledgeKvkkNotice = (version: string) =>
  apiFetch<KvkkAckStatus>(KVKK_ACK_KEY, { method: 'POST', body: { version } })

export const fetchKvkkAckList = () =>
  apiFetch<{ version: string; employees: KvkkAckRow[] }>(KVKK_LIST_KEY)

export const fetchCompanySettings = () =>
  apiFetch<{ settings: CompanySettings }>(COMPANY_SETTINGS_KEY)

export async function saveCompanySettings(settings: CompanySettings): Promise<CompanySettings> {
  const r = await apiFetch<{ settings: CompanySettings }>(COMPANY_SETTINGS_KEY, { method: 'PUT', body: settings })
  return r.settings
}
