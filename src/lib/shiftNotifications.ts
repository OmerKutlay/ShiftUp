/**
 * shiftNotifications — yöneticinin plan değişikliklerinde çalışana bildirim.
 *
 *   shift_changed       tek vardiya eklendi / saati değişti / kaldırıldı (POST, PATCH, DELETE /api/shifts)
 *   schedule_published  haftalık plan aktarıldı (POST /api/workforce/apply) — çalışan başına tek bildirim,
 *                       yalnızca o haftadaki (bugün ve sonrası) vardiyaları gerçekten değişenlere
 *
 * Geçmiş günlere yapılan düzeltmeler (devam kaydı düzenlemesi gibi) bildirilmez; işlemi yapan
 * yönetici kendi vardiyası için bildirim almaz. Hata fırlatmaz — plan işlemini asla bozmamalı.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createNotification, createNotifications } from '@/lib/notificationRepository'
import { dayOfWeekFromDateString, formatDateRangeTr, formatShortDateTr, turkeyToday } from '@/lib/dateUtils'

const TR_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']

export interface ShiftRef {
  id: string
  employee_id: string
  work_date: string   // YYYY-MM-DD
  start_time: string  // HH:MM[:SS]
  end_time: string
}

/** '2026-10-27' → '27 Eki Salı' */
export function shiftDayLabel(workDate: string): string {
  return `${formatShortDateTr(workDate).replace(/ \d{4}$/, '')} ${TR_DAYS[dayOfWeekFromDateString(workDate)]}`
}

function hours(s: { start_time: string; end_time: string }): string {
  return `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`
}

export type ShiftChange =
  | { kind: 'created'; shift: ShiftRef }
  | { kind: 'updated'; shift: ShiftRef; before: { start_time: string; end_time: string } }
  | { kind: 'deleted'; shift: ShiftRef }

/** Bildirim metni; saati değişmeyen güncellemede (yalnızca şablon) null */
export function shiftChangeMessage(change: ShiftChange): { title: string; message: string } | null {
  const day = shiftDayLabel(change.shift.work_date)
  switch (change.kind) {
    case 'created':
      return { title: 'Yeni vardiya', message: `${day} günü ${hours(change.shift)} vardiyasına atandınız.` }
    case 'updated':
      if (hours(change.before) === hours(change.shift)) return null
      return {
        title: 'Vardiya saatiniz değişti',
        message: `${day} vardiyanız ${hours(change.before)} yerine ${hours(change.shift)} olarak güncellendi.`,
      }
    case 'deleted':
      return { title: 'Vardiyanız kaldırıldı', message: `${day} günü ${hours(change.shift)} vardiyanız plandan kaldırıldı.` }
  }
}

const MERGE_WINDOW_MS = 10 * 60 * 1000
const MERGED_TITLE = 'Vardiya planınızda değişiklikler var'
const MAX_MESSAGE = 1000
const MORE = '…ve diğer değişiklikler.'

/** Birleşik mesaj: her değişiklik ayrı satır; sınır aşılırsa sonuna tek "diğer değişiklikler" satırı */
export function mergeMessages(existing: string, next: string): string {
  if (existing.endsWith(MORE)) return existing
  // Sonda "diğer değişiklikler" satırına her zaman yer kalır
  const merged = `${existing}\n${next}`
  if (merged.length <= MAX_MESSAGE - MORE.length - 1) return merged
  return `${existing}\n${MORE}`
}

export async function notifyShiftChange(
  admin: SupabaseClient,
  actorId: string,
  change: ShiftChange,
  today: string = turkeyToday(),
): Promise<void> {
  try {
    const { shift } = change
    if (shift.employee_id === actorId || shift.work_date < today) return
    const text = shiftChangeMessage(change)
    if (!text) return

    // Editör her hücreyi ayrı istekle kaydeder: kısa süre içindeki değişiklikler çalışanın
    // okunmamış tek bildiriminde toplanır (push yalnızca ilkinde gider — tetikleyici INSERT'te çalışır)
    const { data: recent } = await admin
      .from('notifications')
      .select('id, message')
      .eq('employee_id', shift.employee_id)
      .eq('type', 'shift_changed')
      .eq('is_read', false)
      .gte('created_at', new Date(Date.now() - MERGE_WINDOW_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (recent) {
      const { error } = await admin
        .from('notifications')
        .update({ title: MERGED_TITLE, message: mergeMessages(recent.message as string, text.message) })
        .eq('id', recent.id)
      if (!error) return
    }

    await createNotification(admin, {
      employee_id: shift.employee_id,
      type: 'shift_changed',
      ...text,
      related_id: shift.id,
    })
  } catch (err) {
    console.error('[shiftNotifications] vardiya bildirimi gönderilemedi:', err)
  }
}

type PlanRow = Omit<ShiftRef, 'id'>

/**
 * Plan aktarımı öncesi/sonrası vardiyaları karşılaştırır; bugün ve sonrasında vardiyası
 * değişen çalışanların id'lerini döner (aynı gün + aynı saat yeniden yazıldıysa değişmemiş sayılır).
 */
export function changedEmployees(before: PlanRow[], after: PlanRow[], today: string): string[] {
  const keys = (rows: PlanRow[]) => {
    const m = new Map<string, Set<string>>()
    for (const r of rows) {
      if (r.work_date < today) continue
      const set = m.get(r.employee_id) ?? new Set<string>()
      set.add(`${r.work_date} ${hours(r)}`)
      m.set(r.employee_id, set)
    }
    return m
  }
  const a = keys(before)
  const b = keys(after)
  const changed: string[] = []
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(id) ?? new Set<string>()
    const y = b.get(id) ?? new Set<string>()
    if (x.size !== y.size || [...x].some((k) => !y.has(k))) changed.push(id)
  }
  return changed
}

export async function notifySchedulePublished(
  admin: SupabaseClient,
  params: { actorId: string; weekStart: string; weekEnd: string; before: PlanRow[]; after: PlanRow[] },
  today: string = turkeyToday(),
): Promise<number> {
  try {
    const { actorId, weekStart, weekEnd, before, after } = params
    const targets = changedEmployees(before, after, today).filter((id) => id !== actorId)
    if (targets.length === 0) return 0
    const range = formatDateRangeTr(weekStart, weekEnd)
    return await createNotifications(admin, targets.map((employee_id) => {
      const count = after.filter((r) => r.employee_id === employee_id && r.work_date >= today).length
      return {
        employee_id,
        type: 'schedule_published' as const,
        title: 'Haftalık planınız güncellendi',
        message: count > 0
          ? `${range} haftası için planınızda ${count} vardiya var. Programım sayfasından bakabilirsiniz.`
          : `${range} haftası için kalan vardiyanız bulunmuyor. Programım sayfasından bakabilirsiniz.`,
        related_id: null,
      }
    }))
  } catch (err) {
    console.error('[shiftNotifications] plan bildirimi gönderilemedi:', err)
    return 0
  }
}
