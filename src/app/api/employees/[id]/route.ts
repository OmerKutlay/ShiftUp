/**
 * DELETE /api/employees/[id]
 * Çalışanı kalıcı olarak siler.
 * Bağlı vardiya, attendance ve leave kayıtları FK kısıtları nedeniyle
 * silinemeyen çalışan için 409 döner — UI bu durumda soft delete önerir.
 * Sadece admin/manager yetkisi gerektirir (auth kontrolü yapılır).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ROLES } from '@/lib/auth'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Authorization: en az Mağaza Müdürü yetkisi gerekir
  const auth = await requireMinRole(req, ROLES.MAGAZA_MUDURU)
  if ('response' in auth) return auth.response

  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json({ error: 'Çalışan ID eksik.', code: 'MISSING_ID' }, { status: 400 })
    }

    if (id === auth.employee.id) {
      return NextResponse.json({ error: 'Kendi hesabınızı silemezsiniz.', code: 'SELF_DELETE' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Silinecek çalışanın varlığını doğrula
    const { data: employee, error: fetchError } = await admin
      .from('employees')
      .select('id, full_name, auth_user_id')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message, code: 'DB_ERROR' }, { status: 500 })
    }

    if (!employee) {
      return NextResponse.json({ error: 'Çalışan bulunamadı.', code: 'NOT_FOUND' }, { status: 404 })
    }

    // Employees tablosundan sil
    const { error: deleteError } = await admin
      .from('employees')
      .delete()
      .eq('id', id)

    if (deleteError) {
      // FK ihlali — bağlı kayıtlar var
      if (deleteError.code === '23503') {
        return NextResponse.json(
          {
            error: 'Bu çalışanın bağlı vardiya veya devam kayıtları var. Silmek yerine pasifleştirmeyi deneyin.',
            code: 'FK_VIOLATION',
          },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: deleteError.message, code: 'DB_ERROR' }, { status: 500 })
    }

    // Supabase Auth kullanıcısını da sil (varsa)
    if (employee.auth_user_id) {
      const { error: authDeleteError } = await admin.auth.admin.deleteUser(employee.auth_user_id)
      if (authDeleteError) {
        // Auth silme başarısız olsa bile employee kaydı silindi — log at, hata verme
        console.error('[DELETE /api/employees] Auth user delete failed:', authDeleteError.message)
      }
    }

    return NextResponse.json({ success: true, deleted_id: id })
  } catch (err) {
    console.error('[DELETE /api/employees/[id]]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
