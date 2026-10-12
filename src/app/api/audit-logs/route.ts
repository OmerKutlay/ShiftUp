/**
 * GET /api/audit-logs?limit=50&before=<ISO>&entity_type=...&action=...
 * Denetim kaydı (salt okunur) — Mağaza Müdürü+. Yeniden eskiye, imleçli sayfalama.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ROLES } from '@/lib/auth'
import { badRequest, serverError } from '@/lib/apiErrors'

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ROLES.MAGAZA_MUDURU)
  if ('response' in auth) return auth.response

  const sp = req.nextUrl.searchParams
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '50', 10) || 50, 1), 200)
  const before = sp.get('before')
  const entityType = sp.get('entity_type')
  const action = sp.get('action')
  if (before && Number.isNaN(Date.parse(before))) return badRequest('Geçersiz before.')
  if (entityType && !/^[a-z_]{1,40}$/.test(entityType)) return badRequest('Geçersiz entity_type.')
  if (action && !/^[a-z_.]{1,60}$/.test(action)) return badRequest('Geçersiz action.')

  try {
    let query = createAdminClient()
      .from('audit_logs')
      .select('id, action, entity_type, entity_id, before, after, note, created_at, actor:employees!actor_id ( id, full_name )')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (before) query = query.lt('created_at', before)
    if (entityType) query = query.eq('entity_type', entityType)
    if (action) query = query.like('action', `${action}%`)

    const { data, error } = await query
    if (error) return serverError('GET /api/audit-logs', error)
    const logs = data ?? []
    return NextResponse.json({
      logs,
      next_before: logs.length === limit ? (logs[logs.length - 1].created_at as string) : null,
    })
  } catch (err) {
    return serverError('GET /api/audit-logs', err)
  }
}
