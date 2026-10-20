import { describe, it, expect } from 'vitest'
import { auditActionLabel, auditChanges, auditSummary, splitAuditNote } from '@/lib/auditFormat'

const refs = {
  employees: { '11111111-1111-4111-8111-111111111111': 'Ayşe Yılmaz' },
  roles: { '22222222-2222-4222-8222-222222222222': 'Mağaza Müdürü', '33333333-3333-4333-8333-333333333333': 'Çalışan' },
}

describe('auditActionLabel', () => {
  it('bilinen işlemleri Türkçe başlığa çevirir', () => {
    expect(auditActionLabel('shift_swap.approved')).toBe('Vardiya takası onaylandı')
    expect(auditActionLabel('holiday.upsert')).toBe('Resmi tatil kaydedildi')
  })
  it('bilinmeyen alt işlemde ham kodu değil grup adını gösterir', () => {
    expect(auditActionLabel('leave.something_new')).toBe('İzin işlemi')
    expect(auditActionLabel('totally.unknown')).toBe('Diğer işlem')
  })
})

describe('auditChanges', () => {
  it('devam düzeltmesinde zamanları okunur biçimde ve yalnızca değişenleri verir', () => {
    const changes = auditChanges({
      action: 'attendance.override',
      entity_id: 'x',
      before: { status: 'working', clock_in_at: '2026-10-16T06:00:00.000Z', clock_out_at: null, completed_break_minutes: 30 },
      after: { status: 'clocked_out', clock_in_at: '2026-10-16T06:00:00.000Z', clock_out_at: '2026-10-16T15:05:00.000Z', completed_break_minutes: 30 },
    }, refs)
    expect(changes).toEqual([
      { label: 'Durum', before: 'Çalışıyor', after: 'Çıkış yaptı' },
      { label: 'Çıkış', before: '—', after: '16 Ekim 2026 18:05' },
    ])
  })

  it('rol ve durum id/boolean yerine adlarıyla gösterilir, teknik alanlar gizlenir', () => {
    const changes = auditChanges({
      action: 'employee.update',
      entity_id: '11111111-1111-4111-8111-111111111111',
      before: { email: 'a@x.com', active: true, role_id: '33333333-3333-4333-8333-333333333333' },
      after: { active: false, role_id: '22222222-2222-4222-8222-222222222222', email: 'a@x.com', updated_at: '2026-10-16T06:00:00Z' },
    }, refs)
    expect(changes).toEqual([
      { label: 'Sistem rolü', before: 'Çalışan', after: 'Mağaza Müdürü' },
      { label: 'Hesap durumu', before: 'Aktif', after: 'Pasif' },
    ])
  })

  it('silmede yalnızca önceki değerleri verir; çalışan id yerine ad', () => {
    const changes = auditChanges({
      action: 'shift.delete',
      entity_id: 'x',
      before: { id: 'abc', employee_id: '11111111-1111-4111-8111-111111111111', work_date: '2026-10-20', start_time: '09:00:00', end_time: '18:00:00', shift_template_id: null },
      after: null,
    }, refs)
    expect(changes).toEqual([
      { label: 'Çalışan', before: 'Ayşe Yılmaz' },
      { label: 'Tarih', before: '20 Ekim 2026' },
      { label: 'Başlangıç', before: '09:00' },
      { label: 'Bitiş', before: '18:00' },
    ])
  })
})

describe('auditSummary', () => {
  it('vardiya, plan ve puantaj için kısa özet üretir', () => {
    expect(auditSummary({ action: 'shift.create', entity_id: 'x', before: null,
      after: { work_date: '2026-10-20', start_time: '09:00', end_time: '18:00' } }))
      .toBe('20 Ekim 2026 · 09:00–18:00')
    expect(auditSummary({ action: 'workforce.apply', entity_id: null, before: null,
      after: { weekStart: '2026-10-19', weekEnd: '2026-10-25', created: 35, replaced: 0, restDays: 7 } }))
      .toBe('19 Ekim 2026 – 25 Ekim 2026 haftası · 35 vardiya oluşturuldu · 7 hafta tatili atandı')
    expect(auditSummary({ action: 'report.timesheet.export', entity_id: '2026-10', before: null, after: null }))
      .toBe('Ekim 2026')
  })
})

describe('splitAuditNote', () => {
  it('ihlal notunu maddelere ayırır, diğer notları olduğu gibi bırakır', () => {
    expect(splitAuditNote('İhlaller onaylandı: Günlük 11 saat aşıldı | Dinlenme 11 saatten az'))
      .toEqual({ title: 'Onaylanan kural ihlalleri', items: ['Günlük 11 saat aşıldı', 'Dinlenme 11 saatten az'] })
    expect(splitAuditNote('Çıkış unutulmuş')).toEqual({ title: 'Not', items: ['Çıkış unutulmuş'] })
  })
})
