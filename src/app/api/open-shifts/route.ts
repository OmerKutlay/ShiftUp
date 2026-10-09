/**
 * GET   /api/open-shifts?status=open|filled|cancelled&date=YYYY-MM-DD
 * POST  /api/open-shifts   — yönetimsel: open shift oluştur
 * PATCH /api/open-shifts   — yönetimsel: open shift güncelle/iptal et
 * FAZ 11 + FAZ AUTH-2
 *
 * GET:   requireAuth (tüm authenticated kullanıcılar görebilir)
 * POST:  requireMinRole(Müdür Yardımcısı)
 *        → Oluşturma sonrası tüm aktif Çalışan rolündeki çalışanlara bildirim gönderilir.
 * PATCH: requireMinRole(Müdür Yardımcısı)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { CreateOpenShiftPayload } from '@/types/workforce'
import { requireAuth, requireMinRole, ROLES } from '@/lib/auth'
import { createNotification } from '@/lib/notificationRepository'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'

// ─── GET ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const date = searchParams.get('date')

    const admin = createAdminClient()
    let query = admin
      .from('open_shifts')
      .select(`*, filled_by_employee:employees!filled_by(id, full_name)`)
      .order('work_date')
      .order('start_time')

    if (status) query = query.eq('status', status)
    if (date) query = query.eq('work_date', date)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ open_shifts: data ?? [] })
  } catch (err) {
    console.error('[GET /api/open-shifts]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}

// ─── POST ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  try {
    const body = (await req.json()) as Partial<CreateOpenShiftPayload>

    if (!body.work_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.work_date))
      return NextResponse.json({ error: 'Geçerli work_date zorunludur (YYYY-MM-DD).' }, { status: 400 })
    if (!body.start_time || !body.end_time)
      return NextResponse.json({ error: 'start_time ve end_time zorunludur.' }, { status: 400 })
    if (body.start_time >= body.end_time)
      return NextResponse.json({ error: 'Başlangıç saati bitiş saatinden önce olmalıdır.' }, { status: 400 })

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('open_shifts')
      .insert({
        work_date: body.work_date,
        start_time: body.start_time,
        end_time: body.end_time,
        role_needed: body.role_needed ?? null,
        description: body.description ?? null,
        status: 'open',
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // ── Tüm aktif Çalışan rolündeki çalışanlara bildirim gönder ──────────
    // Fire-and-forget: bildirim hatası oluşturma yanıtını bloklamaz.
    try {
      const shift = data
      const dateLabel = format(new Date(shift.work_date), 'd MMMM yyyy EEEE', { locale: tr })
      const timeLabel = `${shift.start_time.slice(0, 5)} – ${shift.end_time.slice(0, 5)}`
      const roleLabel = shift.role_needed ? ` (${shift.role_needed})` : ''

      // Çalışan rolündeki tüm aktif employees'ı çek
      const { data: employees } = await admin
        .from('employees')
        .select('id, roles(name)')
        .eq('active', true)

      if (employees && employees.length > 0) {
        // Yalnızca 'Çalışan' rolündekiler — yöneticiler zaten görebilir
        const targets = employees.filter((emp) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const roleName = (emp as any).roles?.name ?? null
          return roleName === ROLES.CALISAN
        })

        // Her çalışana ayrı bildirim — Promise.allSettled ile hata izole edilir
        await Promise.allSettled(
          targets.map((emp) =>
            createNotification(admin, {
              employee_id: emp.id,
              type: 'open_shift_available',
              title: 'Yeni Açık Vardiya',
              message: `${dateLabel} tarihinde ${timeLabel}${roleLabel} için açık vardiya oluşturuldu. Üstlenmek için Açık Vardiyalar sayfasını ziyaret edin.`,
              related_id: shift.id,
            })
          )
        )
      }
    } catch (notifErr) {
      // Bildirim gönderimi başarısız olsa bile vardiya oluşturma başarılı sayılır
      console.error('[POST /api/open-shifts] bildirim gönderilemedi:', notifErr)
    }
    // ─────────────────────────────────────────────────────────────────────

    return NextResponse.json({ open_shift: data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/open-shifts]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}

// ─── PATCH ───────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  try {
    const body = (await req.json()) as { id: string; status?: string; role_needed?: string; description?: string }
    if (!body.id) return NextResponse.json({ error: 'id zorunludur.' }, { status: 400 })

    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = { updated_at: new Date().toISOString() }
    if (body.status) patch.status = body.status
    if (body.role_needed !== undefined) patch.role_needed = body.role_needed
    if (body.description !== undefined) patch.description = body.description

    const { data, error } = await admin.from('open_shifts').update(patch).eq('id', body.id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ open_shift: data })
  } catch (err) {
    console.error('[PATCH /api/open-shifts]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}
