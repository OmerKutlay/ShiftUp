/**
 * shiftNotifications.test.ts — vardiya değişikliği bildirim metinleri, plan karşılaştırması, birleştirme.
 */
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  changedEmployees, mergeMessages, notifyShiftChange, shiftChangeMessage, shiftDayLabel,
} from '@/lib/shiftNotifications'
import { createFakeDb } from './helpers/fakeSupabase'

const shift = { id: 's1', employee_id: 'e1', work_date: '2026-10-27', start_time: '09:00:00', end_time: '18:00:00' }

describe('shiftChangeMessage', () => {
  it('gün etiketi: kısa tarih + gün adı', () => {
    expect(shiftDayLabel('2026-10-27')).toBe('27 Eki Salı')
  })

  it('ekleme / saat değişikliği / kaldırma', () => {
    expect(shiftChangeMessage({ kind: 'created', shift })?.message).toBe('27 Eki Salı günü 09:00–18:00 vardiyasına atandınız.')
    expect(shiftChangeMessage({ kind: 'updated', shift, before: { start_time: '08:00', end_time: '17:00' } })?.message)
      .toBe('27 Eki Salı vardiyanız 08:00–17:00 yerine 09:00–18:00 olarak güncellendi.')
    expect(shiftChangeMessage({ kind: 'deleted', shift })?.title).toBe('Vardiyanız kaldırıldı')
  })

  it('saati değişmeyen güncelleme (yalnızca şablon) bildirilmez', () => {
    expect(shiftChangeMessage({ kind: 'updated', shift, before: { start_time: '09:00', end_time: '18:00' } })).toBeNull()
  })
})

describe('changedEmployees', () => {
  const today = '2026-10-27'
  const row = (employee_id: string, work_date: string, start_time = '09:00', end_time = '18:00') =>
    ({ employee_id, work_date, start_time, end_time })

  it('aynı plan yeniden yazılırsa kimse bildirim almaz', () => {
    const plan = [row('a', '2026-10-28'), row('b', '2026-10-29')]
    expect(changedEmployees(plan, [...plan], today)).toEqual([])
  })

  it('saati, günü değişen, yeni eklenen ve planı kaldırılan çalışanlar', () => {
    const before = [row('a', '2026-10-28'), row('b', '2026-10-29'), row('c', '2026-10-30'), row('x', '2026-10-28')]
    const after = [row('a', '2026-10-28', '10:00'), row('b', '2026-10-31'), row('d', '2026-10-30'), row('x', '2026-10-28')]
    expect(changedEmployees(before, after, today).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('geçmiş günlerdeki farklar sayılmaz', () => {
    expect(changedEmployees([row('a', '2026-10-26')], [], today)).toEqual([])
  })
})

describe('notifyShiftChange', () => {
  const today = '2026-10-26'

  it('çalışana bildirim oluşturur; kendi vardiyası ve geçmiş gün bildirilmez', async () => {
    const db = createFakeDb({ notifications: [] })
    const admin = db as unknown as SupabaseClient
    await notifyShiftChange(admin, 'manager', { kind: 'created', shift }, today)
    await notifyShiftChange(admin, 'e1', { kind: 'deleted', shift }, today)
    await notifyShiftChange(admin, 'manager', { kind: 'created', shift: { ...shift, id: 's0', work_date: '2026-10-25' } }, today)
    expect(db.tables.notifications).toHaveLength(1)
    expect(db.tables.notifications[0]).toMatchObject({ employee_id: 'e1', type: 'shift_changed', related_id: 's1' })
  })

  it('okunmamış yakın tarihli bildirim varsa yenisi ona eklenir', async () => {
    const db = createFakeDb({
      notifications: [{
        id: 'n1', employee_id: 'e1', type: 'shift_changed', is_read: false, title: 'Yeni vardiya',
        message: 'İlk satır', related_id: 's0', created_at: new Date().toISOString(),
      }],
    })
    await notifyShiftChange(db as unknown as SupabaseClient, 'manager', { kind: 'deleted', shift }, today)
    expect(db.tables.notifications).toHaveLength(1)
    expect(db.tables.notifications[0].title).toBe('Vardiya planınızda değişiklikler var')
    expect(db.tables.notifications[0].message).toBe('İlk satır\n27 Eki Salı günü 09:00–18:00 vardiyanız plandan kaldırıldı.')
  })
})

describe('mergeMessages', () => {
  it('satır satır ekler, sınırı aşınca tek "diğer değişiklikler" satırı bırakır', () => {
    expect(mergeMessages('A', 'B')).toBe('A\nB')
    let capped = 'Başlangıç'
    for (let i = 0; i < 40; i++) capped = mergeMessages(capped, `27 Eki Salı günü 09:00–18:00 vardiyasına atandınız. #${i}`)
    expect(capped.endsWith('…ve diğer değişiklikler.')).toBe(true)
    expect(capped.length).toBeLessThanOrEqual(1000)
    expect(mergeMessages(capped, 'z')).toBe(capped)
  })
})
