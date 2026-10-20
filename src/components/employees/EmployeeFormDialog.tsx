'use client'

import { useState, useCallback } from 'react'
import { AlertCircle, Loader2, Mail, RefreshCw, X } from 'lucide-react'
import type { EmployeeWithRole, Role, CreateEmployeePayload, UpdateEmployeePayload, EmploymentType } from '@/types/employee'
import { EMPLOYMENT_TYPE_LABELS } from '@/types/employee'
import { DateField, SegmentedControl } from '@/components/common'
import { format } from 'date-fns'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  onSave: (payload: CreateEmployeePayload | UpdateEmployeePayload) => Promise<void>
  employee?: EmployeeWithRole | null
  roles: Role[]
  loading: boolean
}

interface FormState {
  full_name: string
  email: string
  role: string
  role_id: string
  active: boolean
  employment_type: EmploymentType
  hire_date: string
  birth_date: string
  overtime_consent_at: string
}

const EMPTY_FORM: FormState = {
  full_name: '',
  email: '',
  role: '',
  role_id: '',
  active: true,
  employment_type: 'full_time',
  hire_date: '',
  birth_date: '',
  overtime_consent_at: '',
}

function toFormState(emp: EmployeeWithRole): FormState {
  return {
    full_name: emp.full_name,
    email: emp.email ?? '',
    role: emp.role,
    role_id: emp.role_id ?? '',
    active: emp.active,
    employment_type: emp.employment_type ?? 'full_time',
    hire_date: emp.hire_date ?? '',
    birth_date: emp.birth_date ?? '',
    overtime_consent_at: emp.overtime_consent_at ?? '',
  }
}

/**
 * İsimden email önerisi üretir.
 * "Ahmet Kaya" → "ahmet.kaya@shiftup.test"
 * Türkçe karakterleri normalize eder.
 */
function generateEmail(fullName: string): string {
  const normalized = fullName
    .toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z\s]/g, '')   // yalnızca harf + boşluk
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join('.')

  return normalized ? `${normalized}@shiftup.test` : ''
}

/** Radix Select boş değeri kabul etmez — "Seçilmedi" için yer tutucu */
const NO_ROLE = '__none__'

/** Etiket + alan + yardım/hata metni */
function Field({ id, label, error, helper, className, children }: {
  id: string
  label: string
  error?: string
  helper?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-msg`} className="text-xs text-danger">{error}</p>
      ) : helper ? (
        <p id={`${id}-msg`} className="text-xs text-ink-muted">{helper}</p>
      ) : null}
    </div>
  )
}

function isValidEmail(email: string): boolean {
  if (email === '') return true  // boş bırakılabilir
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function EmployeeFormDialog({ open, onClose, onSave, employee, roles, loading }: Props) {
  const isEdit = !!employee
  // Diyalog her açılışta yeni `key` ile mount edilir (bkz. EmployeesPage) → form ilk değerden başlar
  const [form, setForm] = useState<FormState>(() => (employee ? toFormState(employee) : EMPTY_FORM))
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  // İsim değişince email henüz el ile girilmemişse otomatik güncelle
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setForm((f) => {
      const autoEmail = generateEmail(newName)
      // Mevcut email ya boşsa ya da önceki isimden türetilmişse güncelle
      const prevAuto = generateEmail(f.full_name)
      const shouldAutoUpdate = !isEdit && (f.email === '' || f.email === prevAuto)
      return { ...f, full_name: newName, email: shouldAutoUpdate ? autoEmail : f.email }
    })
    setErrors((err) => ({ ...err, full_name: undefined }))
  }, [isEdit])

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, email: e.target.value }))
    setErrors((err) => ({ ...err, email: undefined }))
  }

  // Üret butonuna basılınca isimden email yeniden oluştur
  const regenerateEmail = () => {
    const generated = generateEmail(form.full_name)
    setForm((f) => ({ ...f, email: generated }))
    setErrors((err) => ({ ...err, email: undefined }))
  }

  const handleRoleChange = (value: string) => {
    setForm((f) => ({ ...f, role_id: value === NO_ROLE ? '' : value }))
  }

  function validate(): boolean {
    const next: typeof errors = {}
    if (!form.full_name.trim()) next.full_name = 'Ad Soyad zorunludur.'
    if (!form.role.trim()) next.role = 'Pozisyon zorunludur.'
    if (form.email && !isValidEmail(form.email)) next.email = 'Geçerli bir email adresi girin.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async () => {
    if (loading || !validate()) return
    setSubmitError(null)
    try {
      const payload = {
        full_name: form.full_name.trim(),
        email: form.email.trim() || null,
        role: form.role.trim(),
        role_id: form.role_id || null,
        active: form.active,
        employment_type: form.employment_type,
        hire_date: form.hire_date || null,
        birth_date: form.birth_date || null,
        overtime_consent_at: form.overtime_consent_at || null,
      }
      await onSave(payload)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Bir hata oluştu.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Çalışanı Düzenle' : 'Yeni Çalışan Ekle'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Çalışanın bilgilerini güncelleyin.' : 'Kişisel bilgileri ve çalışma tipini girin.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          {submitError && (
            <Alert tone="danger" className="pr-10 sm:col-span-2">
              <AlertCircle />
              <AlertDescription className="text-ink">{submitError}</AlertDescription>
              <button
                type="button"
                aria-label="Kapat"
                onClick={() => setSubmitError(null)}
                className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-lg text-ink-secondary hover:bg-card/60"
              >
                <X className="size-4" />
              </button>
            </Alert>
          )}

          {/* Ad Soyad */}
          <Field id="emp-full-name" label="Ad Soyad" error={errors.full_name} className="sm:col-span-2">
            <Input
              id="emp-full-name"
              value={form.full_name}
              onChange={handleNameChange}
              aria-invalid={!!errors.full_name || undefined}
              aria-describedby={errors.full_name ? 'emp-full-name-msg' : undefined}
              autoFocus
            />
          </Field>

          {/* Email */}
          <Field
            id="emp-email"
            label="E-posta"
            error={errors.email}
            helper={<>Sisteme giriş için kullanılır.{!isEdit && form.full_name && ' İsimden otomatik önerildi.'}</>}
            className="sm:col-span-2"
          >
            <div className="relative">
              <Mail aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-secondary" />
              <Input
                id="emp-email"
                type="email"
                value={form.email}
                onChange={handleEmailChange}
                aria-invalid={!!errors.email || undefined}
                aria-describedby="emp-email-msg"
                className="pr-11 pl-9"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={regenerateEmail}
                disabled={!form.full_name.trim()}
                aria-label="Email üret"
                title="İsimden email üret"
                className="absolute top-1/2 right-0.5 -translate-y-1/2 text-ink-secondary"
              >
                <RefreshCw />
              </Button>
            </div>
          </Field>

          {/* Pozisyon */}
          <Field id="emp-role" label="Pozisyon / Unvan" error={errors.role} helper="Görev tanımı (serbest metin)">
            <Input
              id="emp-role"
              placeholder="Kasiyer, Reyon Görevlisi…"
              value={form.role}
              onChange={(e) => {
                setForm((f) => ({ ...f, role: e.target.value }))
                setErrors((err) => ({ ...err, role: undefined }))
              }}
              aria-invalid={!!errors.role || undefined}
              aria-describedby="emp-role-msg"
            />
          </Field>

          {/* Sistem Rolü */}
          <Field id="emp-system-role" label="Sistem rolü">
            <Select value={form.role_id || NO_ROLE} onValueChange={handleRoleChange}>
              <SelectTrigger id="emp-system-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ROLE}><span className="text-ink-muted">Seçilmedi</span></SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* Çalışma Tipi */}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-semibold">Çalışma tipi</span>
            <SegmentedControl<EmploymentType>
              aria-label="Çalışma tipi"
              value={form.employment_type}
              onChange={(val) => setForm((f) => ({ ...f, employment_type: val }))}
              options={(Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[]).map((key) => ({
                value: key,
                label: EMPLOYMENT_TYPE_LABELS[key],
              }))}
              fullWidth
            />
            {form.employment_type === 'part_time' && (
              <p className="text-xs text-ink-muted">Yarı zamanlı: haftada en fazla 4 gün ve 30 saat</p>
            )}
          </div>

          {/* Özlük tarihleri — yıllık izin hakkı ve fazla çalışma onayı */}
          <DateField
            label="İşe Giriş Tarihi"
            value={form.hire_date}
            onChange={(v) => setForm((f) => ({ ...f, hire_date: v }))}
            helperText="Yıllık izin hakkı bu tarihe göre hesaplanır"
            clearable
            fullWidth
          />
          <DateField
            label="Doğum Tarihi"
            value={form.birth_date}
            onChange={(v) => setForm((f) => ({ ...f, birth_date: v }))}
            max={format(new Date(), 'yyyy-MM-dd')}
            helperText="18 yaş altı / 50 yaş üstü en az 20 gün izin"
            clearable
            fullWidth
          />
          <DateField
            label="Fazla Çalışma Onay Tarihi"
            value={form.overtime_consent_at}
            onChange={(v) => setForm((f) => ({ ...f, overtime_consent_at: v }))}
            helperText="Çalışanın fazla çalışmaya yazılı onay verdiği tarih (İş K. Md. 41). Boşsa onay yok sayılır."
            clearable
            fullWidth
            className="sm:col-span-2"
          />

          {/* Aktif/Pasif — sadece düzenleme modunda */}
          {isEdit && (
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                id="emp-active"
                checked={form.active}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, active: checked }))}
                className="data-[state=checked]:bg-success"
              />
              <Label htmlFor="emp-active">{form.active ? 'Aktif' : 'Pasif'}</Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>İptal</Button>
          <Button type="button" onClick={() => handleSubmit()} disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            {isEdit ? 'Kaydet' : 'Ekle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
