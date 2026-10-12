/**
 * GET  /api/store-location  — Aktif mağaza konumunu döner
 * POST /api/store-location  — Mağaza konumunu oluşturur veya günceller (upsert)
 * FAZ 7 — Store Location Management
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ROLES } from '@/lib/auth'
import type { StoreLocation } from '@/types/location'

// ─── GET ────────────────────────────────────────────────────
export async function GET() {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('store_locations')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 })
    }

    return NextResponse.json({ locations: data ?? [] })
  } catch (err) {
    console.error('[GET /api/store-location]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
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
  // Authorization: en az Mağaza Müdürü yetkisi gerekir
  const auth = await requireMinRole(req, ROLES.MAGAZA_MUDURU)
  if ('response' in auth) return auth.response

  try {
    const body = (await req.json()) as Partial<StoreLocationPayload>

    // Validation
    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'name zorunludur.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (typeof body.latitude !== 'number' || body.latitude < -90 || body.latitude > 90) {
      return NextResponse.json({ error: 'Geçersiz latitude (-90..90).', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (typeof body.longitude !== 'number' || body.longitude < -180 || body.longitude > 180) {
      return NextResponse.json({ error: 'Geçersiz longitude (-180..180).', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (typeof body.allowed_radius_meters !== 'number' || body.allowed_radius_meters < 10 || body.allowed_radius_meters > 5000) {
      return NextResponse.json({ error: 'allowed_radius_meters 10–5000 arası olmalıdır.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (typeof body.max_accuracy_meters !== 'number' || body.max_accuracy_meters < 5 || body.max_accuracy_meters > 500) {
      return NextResponse.json({ error: 'max_accuracy_meters 5–500 arası olmalıdır.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const admin = createAdminClient()

    const payload = {
      name: body.name.trim(),
      latitude: body.latitude,
      longitude: body.longitude,
      allowed_radius_meters: body.allowed_radius_meters,
      max_accuracy_meters: body.max_accuracy_meters,
      active: body.active ?? true,
      updated_at: new Date().toISOString(),
    }

    let result: StoreLocation

    if (body.id) {
      // Update
      const { data, error } = await admin
        .from('store_locations')
        .update(payload)
        .eq('id', body.id)
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 })
      }
      result = data as StoreLocation
    } else {
      // Insert
      const { data, error } = await admin
        .from('store_locations')
        .insert({ ...payload, created_at: new Date().toISOString() })
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 })
      }
      result = data as StoreLocation
    }

    return NextResponse.json({ location: result }, { status: body.id ? 200 : 201 })
  } catch (err) {
    console.error('[POST /api/store-location]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
