/**
 * GET  /api/store-location  — Aktif mağazanın konumlarını döner (Mağaza Müdürü+, Ayarlar sayfası)
 * POST /api/store-location  — Aktif mağazanın konumunu oluşturur veya günceller (Mağaza Müdürü+)
 *
 * Mağaza başına yalnızca bir konum aktif olabilir (uq_store_locations_one_active): konum aktif
 * kaydedilirken mağazanın diğer aktif konumları önce pasifleştirilir. Güncellemede konum
 * aktif mağazaya ait olmalıdır (başka mağazanın konumu → 404).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { logAudit } from '@/lib/auditLog'
import type { StoreLocation } from '@/types/location'

// ─── GET ────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.STORE_MANAGER)
  if ('response' in auth) return auth.response

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('store_locations')
      .select('*')
      .eq('store_id', auth.employee.store_id)
      .order('created_at', { ascending: false })

    if (error) return serverError('GET /api/store-location', error)
    return NextResponse.json({ locations: data ?? [] })
  } catch (err) {
    return serverError('GET /api/store-location', err)
  }
}

// ─── POST ───────────────────────────────────────────────────
interface StoreLocationPayload {
  id?: string   // varsa update, yoksa insert
  name: string
  latitude: number
  longitude: number
  allowed_radius_meters: number
  max_accuracy_meters: number
  active: boolean
}

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.STORE_MANAGER)
  if ('response' in auth) return auth.response

  try {
    const body = await readJson<Partial<StoreLocationPayload>>(req)
    if (!body) return badRequest('Geçersiz istek gövdesi.')

    if (body.id !== undefined && !isUuid(body.id)) return badRequest('Geçersiz konum ID.')
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) {
      return badRequest('name zorunludur (en fazla 120 karakter).')
    }
    if (typeof body.latitude !== 'number' || body.latitude < -90 || body.latitude > 90) {
      return badRequest('Geçersiz latitude (-90..90).')
    }
    if (typeof body.longitude !== 'number' || body.longitude < -180 || body.longitude > 180) {
      return badRequest('Geçersiz longitude (-180..180).')
    }
    if (typeof body.allowed_radius_meters !== 'number' || body.allowed_radius_meters < 10 || body.allowed_radius_meters > 5000) {
      return badRequest('allowed_radius_meters 10–5000 arası olmalıdır.')
    }
    if (typeof body.max_accuracy_meters !== 'number' || body.max_accuracy_meters < 5 || body.max_accuracy_meters > 500) {
      return badRequest('max_accuracy_meters 5–500 arası olmalıdır.')
    }
    if (body.active !== undefined && typeof body.active !== 'boolean') return badRequest('active boolean olmalıdır.')

    const admin = createAdminClient()
    const storeId = auth.employee.store_id

    const payload = {
      name: body.name.trim(),
      latitude: body.latitude,
      longitude: body.longitude,
      allowed_radius_meters: Math.round(body.allowed_radius_meters),
      max_accuracy_meters: Math.round(body.max_accuracy_meters),
      active: body.active ?? true,
      updated_at: new Date().toISOString(),
    }

    // Güncellenecek konum aktif mağazaya ait olmalı
    if (body.id) {
      const { data: owned, error: ownedError } = await admin
        .from('store_locations')
        .select('id')
        .eq('id', body.id)
        .eq('store_id', storeId)
        .maybeSingle()
      if (ownedError) return serverError('POST /api/store-location', ownedError)
      if (!owned) return notFound('Konum bulunamadı.')
    }

    // Aktif kaydedilecekse mağazanın diğer aktif konumunu önce pasifleştir (mağaza başına tek aktif)
    if (payload.active) {
      let deactivate = admin
        .from('store_locations')
        .update({ active: false, updated_at: payload.updated_at })
        .eq('store_id', storeId)
        .eq('active', true)
      if (body.id) deactivate = deactivate.neq('id', body.id)
      const { error: deactivateError } = await deactivate
      if (deactivateError) return serverError('POST /api/store-location', deactivateError)
    }

    let result: StoreLocation
    if (body.id) {
      const { data, error } = await admin
        .from('store_locations')
        .update(payload)
        .eq('id', body.id)
        .eq('store_id', storeId)
        .select()
        .maybeSingle()
      if (error) return serverError('POST /api/store-location', error)
      if (!data) return notFound('Konum bulunamadı.')
      result = data as StoreLocation
    } else {
      const { data, error } = await admin
        .from('store_locations')
        .insert({ ...payload, store_id: storeId })
        .select()
        .single()
      if (error) return serverError('POST /api/store-location', error)
      result = data as StoreLocation
    }

    await logAudit({
      actorId: auth.employee.id,
      storeId,
      action: body.id ? 'store_location.update' : 'store_location.create',
      entityType: 'store_location',
      entityId: result.id,
      after: payload,
    })

    return NextResponse.json({ location: result }, { status: body.id ? 200 : 201 })
  } catch (err) {
    return serverError('POST /api/store-location', err)
  }
}
