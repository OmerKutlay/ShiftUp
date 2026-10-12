/**
 * GET /api/employees?active=true|false
 * Çalışan listesini döner. AppShell employee selector için kullanılır.
 * FAZ 10 Fix
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const activeParam = searchParams.get('active')

    const admin = createAdminClient()
    let query = admin
      .from('employees')
      .select('id, full_name, role, role_id, active, created_at, updated_at')
      .order('full_name', { ascending: true })

    if (activeParam === 'true') {
      query = query.eq('active', true)
    } else if (activeParam === 'false') {
      query = query.eq('active', false)
    }

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 })
    }

    return NextResponse.json({ employees: data ?? [] })
  } catch (err) {
    console.error('[GET /api/employees]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
