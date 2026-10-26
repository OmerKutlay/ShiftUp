/**
 * GET /api/company-settings — şirket bilgileri (Mağaza Müdürü+, Ayarlar › KVKK)
 * PUT /api/company-settings — şirket bilgilerini günceller (yalnızca Admin)
 *
 * Şirket geneli tek satırdır (mağazadan bağımsız); aydınlatma metnindeki veri sorumlusu bilgisini besler.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, readJson, serverError } from '@/lib/apiErrors'
import { logAudit } from '@/lib/auditLog'
import { invalidateCompanySettingsCache, loadCompanySettings } from '@/lib/companySettings'
import { COMPANY_FIELD_LIMITS, type CompanySettings } from '@/lib/kvkk'

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.STORE_MANAGER)
  if ('response' in auth) return auth.response
  return NextResponse.json({ settings: await loadCompanySettings() })
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function PUT(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.ADMIN)
  if ('response' in auth) return auth.response

  try {
    const body = await readJson<Partial<Record<keyof CompanySettings, unknown>>>(req)
    if (!body) return badRequest('Geçersiz istek gövdesi.')

    const next: CompanySettings = { legal_name: null, address: null, kvkk_email: null }
    for (const key of ['legal_name', 'address', 'kvkk_email'] as const) {
      const raw = body[key]
      if (raw === undefined || raw === null) continue
      if (typeof raw !== 'string') return badRequest(`${key} metin olmalıdır.`)
      const v = raw.trim()
      if (v.length > COMPANY_FIELD_LIMITS[key]) {
        return badRequest(`${key} en fazla ${COMPANY_FIELD_LIMITS[key]} karakter olabilir.`)
      }
      next[key] = v || null
    }
    if (next.kvkk_email && !EMAIL_RE.test(next.kvkk_email)) return badRequest('Geçerli bir e-posta adresi girin.')

    const before = await loadCompanySettings()
    const { error } = await createAdminClient()
      .from('company_settings')
      .upsert({ id: true, ...next, updated_by: auth.employee.id, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    if (error) return serverError('PUT /api/company-settings', error)

    invalidateCompanySettingsCache()
    await logAudit({
      actorId: auth.employee.id,
      storeId: auth.employee.store_id,
      action: 'company_settings.update',
      entityType: 'company_settings',
      entityId: null,
      before,
      after: next,
    })
    return NextResponse.json({ settings: next })
  } catch (err) {
    return serverError('PUT /api/company-settings', err)
  }
}
