/**
 * GEÇİCİ — GET /api/diag/cpu?step=N
 * 1102 (CPU sınırı) teşhisi: oturum akışının parçalarını kümülatif çalıştırır; her adımın CPU'su
 * Workers loglarındaki cpuTime'dan okunur. Veri döndürmez. Ölçüm bitince silinecek.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { verifySupabaseSession } from '@/lib/auth/verifiedSession'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const step = Number(req.nextUrl.searchParams.get('step') ?? 0)
  let ok = true

  if (step >= 1 && step < 4) {
    const admin = createAdminClient()
    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const sb = await createSupabaseServerClient()
    if (step >= 2) {
      const v = await verifySupabaseSession(sb.auth)
      ok = !!v
      if (step >= 3 && v) {
        const { data } = await admin.from('employees').select('id, roles ( access_level )').eq('auth_user_id', v.userId).maybeSingle()
        ok = !!data
      }
    }
  }

  if (step >= 4) {
    const auth = await requireAuth(req)
    if ('response' in auth) return NextResponse.json({ step, ok: false })
    if (step >= 5) {
      const admin = createAdminClient()
      await Promise.all([
        admin.from('shift_templates').select('id, name, start_time, end_time').eq('store_id', auth.employee.store_id),
        admin.from('roles').select('id, name, access_level'),
      ])
    }
    if (step >= 6) {
      // ~50 KB JSON yanıt
      return NextResponse.json({ step, rows: Array.from({ length: 500 }, (_, i) => ({ id: i, name: `Çalışan ${i}`, start: '09:00', end: '17:00', note: 'x'.repeat(40) })) })
    }
  }

  return NextResponse.json({ step, ok })
}
