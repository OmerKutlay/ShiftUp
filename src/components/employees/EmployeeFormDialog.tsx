'use client'

/**
 * EmployeeFormDialog — çalışan oluştur / düzenle (DESIGN_GUIDE §5 "Formlar").
 * Bölümler: kişi bilgileri → rol ve çalışma tipi → özlük tarihleri → (düzenlemede) durum.
 */
import { useCallback, useState } from 'react'
import { format } from 'date-fns'
import { Mail, RefreshCw, TriangleAlert } from 'lucide-react'

import type { CreateEmployeePayload, EmployeeWithRole, EmploymentType, Role, UpdateEmployeePayload } from '@/types/employee'
import type { Store } from '@/types/store'
import { ACCESS, ACCESS_LABELS } from '@/lib/auth/roles'
import { DateField, useConfirm } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet,
  FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { EMPLOYMENT_HINTS, EMPLOYMENT_LABELS, roleSummary } from './format'

interface Props {
  open: boolean
  onClose: () => void
  onSave: (payload: CreateEmployeePayload | UpdateEmployeePayload) => Promise<void>
  employee?: EmployeeWithRole | null
  roles: Role[]
  loading: boolean
  /**
   * Seçilebilir mağazalar — yalnızca Admin için verilir (boş/undefined → "Mağaza" alanı gösterilmez).
   * Düzenlemede çalışanın mevcut mağazası pasif olsa da listede kalır.
   */
  stores?: Pick<Store, 'id' | 'name' | 'active'>[]
  /** Yeni çalışanın varsayılan mağazası (şu an çalışılan mağaza) */
  defaultStoreId?: string
}

interface FormState {
  full_name: string
  store_id: string
  email: string
  role_id: string
  active: boolean
  employment_type: EmploymentType
  hire_date: string
  birth_date: string
  overtime_consent_at: string
}

const EMPTY_FORM: FormState = {
  full_name: '',
  store_id: '',
  email: '',
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
    store_id: emp.store_id ?? '',
    email: emp.email ?? '',
    role_id: emp.role_id ?? '',
    active: emp.active,
    employment_type: emp.employment_type ?? 'full_time',
    hire_date: emp.hire_date ?? '',
    birth_date: emp.birth_date ?? '',
    overtime_consent_at: emp.overtime_consent_at ?? '',
  }
}

/**
 * İsimden e-posta önerisi üretir.
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

function isValidEmail(email: string): boolean {
  if (email === '') return true  // boş bırakılabilir
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

const EMPLOYMENT_TYPES = Object.keys(EMPLOYMENT_LABELS) as EmploymentType[]

export function EmployeeFormDialog({ open, onClose, onSave, employee, roles, loading, stores, defaultStoreId }: Props) {
  const isEdit = !!employee
  const confirm = useConfirm()
  // Diyalog her açılışta yeni `key` ile mount edilir (bkz. EmployeesPage) → form ilk değerden başlar
  const [form, setForm] = useState<FormState>(() =>
    employee ? toFormState(employee) : { ...EMPTY_FORM, store_id: defaultStoreId ?? '' }
  )
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  // İsim değişince e-posta henüz el ile girilmemişse otomatik güncelle
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setForm((f) => {
      const autoEmail = generateEmail(newName)
      // Mevcut e-posta ya boşsa ya da önceki isimden türetilmişse güncelle
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

  // Üret düğmesine basılınca isimden e-posta yeniden oluştur
  const regenerateEmail = () => {
    const generated = generateEmail(form.full_name)
    setForm((f) => ({ ...f, email: generated }))
    setErrors((err) => ({ ...err, email: undefined }))
  }

  // Rol listesi sort_order'a göre; Kiosk cihaz rolü yalnızca çalışan zaten Kiosk ise listelenir
  const selectableRoles = [...roles]
    .filter((r) => r.access_level !== ACCESS.KIOSK || r.id === form.role_id)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'tr'))
  const selectedRole = roles.find((r) => r.id === form.role_id)

  // Mağaza alanı yalnızca Admin'e verilen listeyle görünür; pasif mağazalar yalnızca çalışan zaten oradaysa listelenir
  const showStoreField = !!stores && stores.length > 0
  const selectableStores = (stores ?? []).filter((s) => s.active || s.id === employee?.store_id)

  const handleRoleChange = (value: string) => {
    setForm((f) => ({ ...f, role_id: value }))
    setErrors((err) => ({ ...err, role_id: undefined }))
  }

  function validate(): boolean {
    const next: typeof errors = {}
    if (!form.full_name.trim()) next.full_name = 'Ad soyad zorunludur.'
    if (!form.role_id) next.role_id = 'Sistem rolü zorunludur.'
    if (form.email && !isValidEmail(form.email)) next.email = 'Geçerli bir e-posta adresi girin.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async () => {
    if (loading || !validate()) return
    setSubmitError(null)
    try {
      // Mağaza değişikliği = transfer: kaydetmeden önce onay
      const transferring = isEdit && showStoreField && !!form.store_id && form.store_id !== employee.store_id
      if (transferring) {
        const from = stores?.find((s) => s.id === employee.store_id)?.name ?? 'mevcut'
        const to = stores?.find((s) => s.id === form.store_id)?.name ?? 'seçilen'
        const ok = await confirm({
          title: `${employee.full_name} taşınsın mı?`,
          message: `${employee.full_name}, ${from} mağazasından ${to} mağazasına taşınacak. ${from} mağazasındaki bugün ve sonrası vardiyaları haftalık plandan kaldırılacak; geçmiş vardiyaları ${from} planında ve çalışanın özetinde kalır.`,
          confirmText: 'Taşı ve kaydet',
        })
        if (!ok) return
      }
      const payload = {
        full_name: form.full_name.trim(),
        ...(showStoreField && form.store_id && (!isEdit || transferring) ? { store_id: form.store_id } : {}),
        email: form.email.trim() || null,
        role_id: form.role_id,
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

  const today = format(new Date(), 'yyyy-MM-dd')

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !loading) onClose() }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Çalışanı düzenle' : 'Çalışan ekle'}</DialogTitle>
          <DialogDescription>
            {isEdit ? `${employee.full_name} için bilgileri güncelleyin.` : 'Kişi bilgilerini, sistem rolünü ve çalışma tipini girin.'}
          </DialogDescription>
        </DialogHeader>

        <form
          id="employee-form"
          noValidate
          onSubmit={(e) => { e.preventDefault(); void handleSubmit() }}
          className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6 py-1"
        >
          <FieldGroup className="gap-6">
            {submitError && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>Kaydedilemedi</AlertTitle>
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}

            {/* ── Kişi bilgileri ── */}
            <FieldSet className="gap-4">
              <FieldLegend>Kişi bilgileri</FieldLegend>
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={!!errors.full_name || undefined}>
                  <FieldLabel htmlFor="emp-full-name">Ad soyad</FieldLabel>
                  <Input
                    id="emp-full-name"
                    value={form.full_name}
                    onChange={handleNameChange}
                    placeholder="Örn: Ayşe Yılmaz"
                    aria-invalid={!!errors.full_name || undefined}
                    autoFocus
                  />
                  <FieldError>{errors.full_name}</FieldError>
                </Field>

                <Field data-invalid={!!errors.email || undefined}>
                  <FieldLabel htmlFor="emp-email">E-posta</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="emp-email"
                      type="email"
                      value={form.email}
                      onChange={handleEmailChange}
                      placeholder="ad.soyad@shiftup.test"
                      aria-invalid={!!errors.email || undefined}
                    />
                    <InputGroupAddon><Mail /></InputGroupAddon>
                    <InputGroupAddon align="inline-end">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <InputGroupButton
                            size="icon-xs"
                            onClick={regenerateEmail}
                            disabled={!form.full_name.trim()}
                            aria-label="İsimden e-posta üret"
                          >
                            <RefreshCw />
                          </InputGroupButton>
                        </TooltipTrigger>
                        <TooltipContent>İsimden e-posta üret</TooltipContent>
                      </Tooltip>
                    </InputGroupAddon>
                  </InputGroup>
                  {errors.email ? (
                    <FieldError>{errors.email}</FieldError>
                  ) : (
                    <FieldDescription>
                      Giriş için kullanılır.{!isEdit && form.full_name && ' İsimden önerildi.'}
                    </FieldDescription>
                  )}
                </Field>
              </FieldGroup>
            </FieldSet>

            {/* ── Rol ve çalışma tipi ── */}
            <FieldSet className="gap-4">
              <FieldLegend>Rol ve çalışma tipi</FieldLegend>
              <FieldGroup className="gap-4">
                {showStoreField && (
                  <Field>
                    <FieldLabel htmlFor="emp-store">Mağaza</FieldLabel>
                    <Select value={form.store_id || undefined} onValueChange={(v) => setForm((f) => ({ ...f, store_id: v }))}>
                      <SelectTrigger id="emp-store" className="w-full">
                        <SelectValue placeholder="Mağaza seçin" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectableStores.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                            {!s.active && <span className="text-muted-foreground">· Pasif</span>}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      {isEdit
                        ? 'Mağazayı değiştirirseniz çalışan seçilen mağazaya taşınır.'
                        : 'Varsayılan olarak şu an çalışılan mağaza seçilidir.'}
                    </FieldDescription>
                  </Field>
                )}
                <Field data-invalid={!!errors.role_id || undefined}>
                  <FieldLabel htmlFor="emp-system-role">Sistem rolü</FieldLabel>
                  <Select value={form.role_id || undefined} onValueChange={handleRoleChange}>
                    <SelectTrigger id="emp-system-role" className="w-full" aria-invalid={!!errors.role_id || undefined}>
                      <SelectValue placeholder="Rol seçin" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectableRoles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                          <span className="text-muted-foreground">· {ACCESS_LABELS[r.access_level]}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.role_id ? (
                    <FieldError>{errors.role_id}</FieldError>
                  ) : (
                    <FieldDescription>
                      {selectedRole ? roleSummary(selectedRole) : 'Yetki seviyesi ve planlamadaki görev bu rolden gelir.'}
                    </FieldDescription>
                  )}
                </Field>

                <FieldSet className="gap-3">
                  <FieldLegend variant="label" className="mb-0">Çalışma tipi</FieldLegend>
                  <RadioGroup
                    value={form.employment_type}
                    onValueChange={(val) => setForm((f) => ({ ...f, employment_type: val as EmploymentType }))}
                    className="grid gap-3 sm:grid-cols-2"
                  >
                    {EMPLOYMENT_TYPES.map((key) => (
                      <FieldLabel key={key} htmlFor={`emp-type-${key}`}>
                        <Field orientation="horizontal">
                          <FieldContent>
                            <FieldTitle>{EMPLOYMENT_LABELS[key]}</FieldTitle>
                            <FieldDescription>{EMPLOYMENT_HINTS[key]}</FieldDescription>
                          </FieldContent>
                          <RadioGroupItem value={key} id={`emp-type-${key}`} />
                        </Field>
                      </FieldLabel>
                    ))}
                  </RadioGroup>
                </FieldSet>
              </FieldGroup>
            </FieldSet>

            {/* ── Özlük tarihleri — yıllık izin hakkı ve fazla çalışma onayı ── */}
            <FieldSet className="gap-4">
              <FieldLegend>Özlük tarihleri</FieldLegend>
              <FieldGroup className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                <Field className="content-start">
                  <FieldTitle aria-hidden>İşe giriş</FieldTitle>
                  <DateField
                    label="İşe giriş tarihi"
                    hideLabel
                    value={form.hire_date}
                    onChange={(v) => setForm((f) => ({ ...f, hire_date: v }))}
                    clearable
                    fullWidth
                  />
                  <FieldDescription>Yıllık izin hakkı buna göre hesaplanır.</FieldDescription>
                </Field>
                <Field className="content-start">
                  <FieldTitle aria-hidden>Doğum tarihi</FieldTitle>
                  <DateField
                    label="Doğum tarihi"
                    hideLabel
                    value={form.birth_date}
                    onChange={(v) => setForm((f) => ({ ...f, birth_date: v }))}
                    max={today}
                    clearable
                    fullWidth
                  />
                  <FieldDescription>18 yaş altı ve 50 yaş üstüne en az 20 gün izin.</FieldDescription>
                </Field>
                <Field className="content-start">
                  <FieldTitle aria-hidden>Fazla çalışma onayı</FieldTitle>
                  <DateField
                    label="Fazla çalışma onay tarihi"
                    hideLabel
                    value={form.overtime_consent_at}
                    onChange={(v) => setForm((f) => ({ ...f, overtime_consent_at: v }))}
                    clearable
                    fullWidth
                  />
                  <FieldDescription>Yazılı onay tarihi (İş K. Md. 41). Boşsa onay yok sayılır.</FieldDescription>
                </Field>
              </FieldGroup>
            </FieldSet>

            {/* ── Durum — yalnızca düzenlemede ── */}
            {isEdit && (
              <FieldLabel htmlFor="emp-active">
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>Aktif çalışan</FieldTitle>
                    <FieldDescription>
                      Pasif çalışanlar yeni vardiyalara atanmaz; geçmiş kayıtları korunur.
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    id="emp-active"
                    checked={form.active}
                    onCheckedChange={(checked) => setForm((f) => ({ ...f, active: checked }))}
                  />
                </Field>
              </FieldLabel>
            )}
          </FieldGroup>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>İptal</Button>
          <Button type="submit" form="employee-form" disabled={loading}>
            {loading && <Spinner />}
            {isEdit ? 'Kaydet' : 'Ekle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
