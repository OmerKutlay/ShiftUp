/**
 * Mağaza aylık norm saati (işgücü saat bütçesi)
 *
 * GET    /api/stores/norm?month=YYYY-MM            — aktif mağazanın normu + planlanan/fiili kullanım (Müdür Yardımcısı+)
 * GET    /api/stores/norm?month=YYYY-MM&scope=all  — Admin: tüm aktif mağazalar için aynı özet (yönetim paneli)
 * PUT    /api/stores/norm                          — Admin: { month, normHours, note?, storeId? } norm belirler
 * DELETE /api/stores/norm?month=YYYY-MM[&storeId]  — Admin: girilen normu siler (varsayılan tahmine döner)
 *
 * storeId verilmezse Admin'in aktif mağazası kullanılır; verilirse aktif bir mağaza olmalıdır.
 * Norm yol göstericidir — plan kaydını engellemez.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { logAudit } from '@/lib/auditLog'
import { fetchStore, fetchStores } from '@/lib/storeRepository'
import { notifyManagers } from '@/lib/notificationRepository'
import { fetchNormRow, getStoreNormStatus, getStoreNormStatuses } from '@/lib/storeNormService'
import { formatHours, monthLabelTr, normMonthStart } from '@/lib/storeNorm'

const MAX_NORM_HOURS = 99999
const MAX_NOTE = 500

/** Yalnızca 'YYYY-MM' kabul edilir (gün verilirse reddedilir) */
function parseMonth(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) ? normMonthStart(v) : null
}

/** Hedef mağaza: storeId verilmişse aktif mağaza olmalı, yoksa oturumun aktif mağazası */
async function resolveTargetStore(activeStoreId: string, raw: unknown): Promise<{ id: string; name: string } | null> {
  const id = raw === undefined || raw === null || raw === '' ? activeStoreId : raw
  if (typeof id !== 'string' || !isUuid(id)) return null
  const store = await fetchStore(id)
  return store && store.active ? { id: store.id, name: store.name } : null
}

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  const sp = req.nextUrl.searchParams
  const month = parseMonth(sp.get('month'))
  if (!month) return badRequest('Geçersiz ay (YYYY-AA).')

  try {
    const admin = createAdminClient()

    if (sp.get('scope') === 'all') {
      if (auth.employee.access_level !== ACCESS.ADMIN) {
        return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.', code: 'FORBIDDEN' }, { status: 403 })
      }
      const stores = (await fetchStores()).filter((s) => s.active)
      // Mağaza sayısından bağımsız sabit sayıda sorgu; fiili çalışma listede hesaplanmaz
      const statuses = await getStoreNormStatuses(admin, stores.map((x) => x.id), month)
      const items = stores.map((x) => ({ storeId: x.id, storeName: x.name, ...statuses.get(x.id)! }))
      return NextResponse.json({ month, stores: items })
    }

    // Yalnızca oturumun aktif mağazası (Müdür/Yönetici için ana mağaza)
    return NextResponse.json({ norm: await getStoreNormStatus(admin, auth.employee.store_id, month) })
  } catch (err) {
    return serverError('GET /api/stores/norm', err)
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.ADMIN)
  if ('response' in auth) return auth.response

  const body = await readJson<{ month?: unknown; normHours?: unknown; note?: unknown; storeId?: unknown }>(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')

  const month = parseMonth(body.month)
  if (!month) return badRequest('Geçersiz ay (YYYY-AA).')
  const hours = body.normHours
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > MAX_NORM_HOURS) {
    return badRequest('Norm saati 0’dan büyük geçerli bir sayı olmalıdır.')
  }
  const normHours = Math.round(hours * 10) / 10
  if (normHours <= 0) return badRequest('Norm saati 0’dan büyük geçerli bir sayı olmalıdır.')
  let note: string | null = null
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string' || body.note.length > MAX_NOTE) return badRequest(`Not en fazla ${MAX_NOTE} karakter olabilir.`)
    note = body.note.trim() || null
  }

  try {
    const store = await resolveTargetStore(auth.employee.store_id, body.storeId)
    if (!store) return notFound('Mağaza bulunamadı.')

    const admin = createAdminClient()
    const before = await fetchNormRow(admin, store.id, month)
    // Değişiklik yoksa yazma, denetim kaydı ve bildirim yok (yinelenen bildirimi önler)
    if (before && Number(before.norm_hours) === normHours && (before.note ?? null) === note) {
      return NextResponse.json({ norm: await getStoreNormStatus(admin, store.id, month), unchanged: true })
    }
    const { error } = await admin
      .from('store_monthly_norms')
      .upsert(
        {
          store_id: store.id, month, norm_hours: normHours, note, set_by: auth.employee.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'store_id,month' },
      )
    if (error) throw error

    await logAudit({
      actorId: auth.employee.id,
      storeId: store.id,
      action: 'store_norm.set',
      entityType: 'store_monthly_norm',
      entityId: store.id,
      before: before ? { month, norm_hours: Number(before.norm_hours), note: before.note } : null,
      after: { month, norm_hours: normHours, note },
    })

    // Mağazanın müdür / yöneticilerine bildirim (hata normu kaydetmeyi bozmaz)
    try {
      await notifyManagers(
        admin, store.id,
        {
          type: 'store_norm_set',
          title: 'Aylık norm saati belirlendi',
          message: `${monthLabelTr(month)} norm saatiniz: ${formatHours(normHours)} saat${note ? ` — ${note}` : ''}`,
          related_id: null,
        },
        { excludeEmployeeId: auth.employee.id },
      )
    } catch (err) {
      console.error('[stores/norm] bildirim gönderilemedi:', err)
    }

    return NextResponse.json({ norm: await getStoreNormStatus(admin, store.id, month) })
  } catch (err) {
    return serverError('PUT /api/stores/norm', err)
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.ADMIN)
  if ('response' in auth) return auth.response

  const sp = req.nextUrl.searchParams
  const month = parseMonth(sp.get('month'))
  if (!month) return badRequest('Geçersiz ay (YYYY-AA).')

  try {
    const store = await resolveTargetStore(auth.employee.store_id, sp.get('storeId'))
    if (!store) return notFound('Mağaza bulunamadı.')

    const admin = createAdminClient()
    const before = await fetchNormRow(admin, store.id, month)
    if (!before) return notFound('Bu ay için girilmiş norm yok.')

    const { error } = await admin.from('store_monthly_norms').delete().eq('store_id', store.id).eq('month', month)
    if (error) throw error

    await logAudit({
      actorId: auth.employee.id,
      storeId: store.id,
      action: 'store_norm.delete',
      entityType: 'store_monthly_norm',
      entityId: store.id,
      before: { month, norm_hours: Number(before.norm_hours), note: before.note },
    })
    return NextResponse.json({ norm: await getStoreNormStatus(admin, store.id, month) })
  } catch (err) {
    return serverError('DELETE /api/stores/norm', err)
  }
}
