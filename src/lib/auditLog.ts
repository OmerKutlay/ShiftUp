/**
 * auditLog — kim, neyi, ne zaman, hangi eski/yeni değerle değiştirdi.
 *
 * Override, mesai düzeltme, izin/takas kararları ve çalışan yönetimi gibi
 * hassas işlemler audit_logs tablosuna yazılır. Yazma hatası ana işlemi
 * bozmaz — yalnızca loglanır.
 */
import { createAdminClient } from '@/lib/supabaseAdmin'

export interface AuditEntry {
  actorId: string | null
  /** Kaydın ait olduğu mağaza (genelde oturumun aktif mağazası); şirket geneli işlemlerde null */
  storeId: string | null
  action: string               // örn. 'attendance.override', 'leave.review'
  entityType: string           // örn. 'attendance_record'
  entityId: string | null
  before?: unknown
  after?: unknown
  note?: string | null
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('audit_logs').insert({
      actor_id: entry.actorId,
      store_id: entry.storeId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      note: entry.note ?? null,
    })
    if (error) console.error('[auditLog]', entry.action, error.message)
  } catch (err) {
    console.error('[auditLog]', entry.action, err)
  }
}
