'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Loader2, LocateFixed, MapPin, Save } from 'lucide-react'
import type { StoreLocation } from '@/types/location'
import { PageHeader, ListSkeleton, SectionCard, SectionRow, EmptyRow } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { apiFetch } from '@/lib/api/http'
import { cn } from '@/lib/utils'
import { SettingsAlert } from './SettingsAlert'

interface StoreLocationForm {
  id?: string
  name: string
  latitude: string
  longitude: string
  allowed_radius_meters: string
  max_accuracy_meters: string
  active: boolean
}

const DEFAULT_FORM: StoreLocationForm = {
  name: '',
  latitude: '',
  longitude: '',
  allowed_radius_meters: '150',
  max_accuracy_meters: '50',
  active: true,
}

function locationToForm(loc: StoreLocation): StoreLocationForm {
  return {
    id: loc.id,
    name: loc.name,
    latitude: String(loc.latitude),
    longitude: String(loc.longitude),
    allowed_radius_meters: String(loc.allowed_radius_meters),
    max_accuracy_meters: String(loc.max_accuracy_meters),
    active: loc.active,
  }
}

/** embedded: sekmeli Ayarlar sayfasının içinde (başlık ve sayfa dolgusu olmadan) */
export function StoreLocationPage({ embedded = false }: { embedded?: boolean } = {}) {
  const locationsQ = useSWR('/api/store-location', (url: string) => apiFetch<{ locations: StoreLocation[] }>(url))
  const locations = locationsQ.data?.locations ?? []
  const isFirstLoad = !locationsQ.data && !locationsQ.error
  const [saving, setSaving] = useState(false)
  const [actionError, setError] = useState<string | null>(null)
  const loadError = locationsQ.error ? (locationsQ.error instanceof Error ? locationsQ.error.message : 'Yükleme hatası.') : null
  const error = actionError ?? loadError
  const [success, setSuccess] = useState<string | null>(null)

  const [form, setForm] = useState<StoreLocationForm>(DEFAULT_FORM)
  const [isEditing, setIsEditing] = useState(false)
  const [gettingLocation, setGettingLocation] = useState(false)

  const load = () => locationsQ.mutate()

  const handleEdit = (loc: StoreLocation) => {
    setForm(locationToForm(loc))
    setIsEditing(true)
    setError(null)
    setSuccess(null)
  }

  const handleNew = () => {
    setForm(DEFAULT_FORM)
    setIsEditing(false)
    setError(null)
    setSuccess(null)
  }

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('Tarayıcınız konum desteklemiyor.')
      return
    }
    setGettingLocation(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }))
        setGettingLocation(false)
      },
      () => {
        setError('Konum alınamadı.')
        setGettingLocation(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const handleSave = async () => {
    setError(null)
    setSuccess(null)

    const lat = parseFloat(form.latitude)
    const lon = parseFloat(form.longitude)
    const radius = parseInt(form.allowed_radius_meters, 10)
    const accuracy = parseInt(form.max_accuracy_meters, 10)

    if (!form.name.trim()) { setError('Mağaza adı zorunludur.'); return }
    if (isNaN(lat)) { setError('Geçersiz latitude.'); return }
    if (isNaN(lon)) { setError('Geçersiz longitude.'); return }
    if (isNaN(radius) || radius < 10 || radius > 5000) { setError('Yarıçap 10–5000m arası olmalı.'); return }
    if (isNaN(accuracy) || accuracy < 5 || accuracy > 500) { setError('Maks. doğruluk 5–500m arası olmalı.'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/store-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: form.id,
          name: form.name.trim(),
          latitude: lat,
          longitude: lon,
          allowed_radius_meters: radius,
          max_accuracy_meters: accuracy,
          active: form.active,
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Kayıt hatası.')
      setSuccess(form.id ? 'Mağaza konumu güncellendi.' : 'Mağaza konumu eklendi.')
      await load()
      handleNew()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kayıt hatası.')
    } finally {
      setSaving(false)
    }
  }

  const updateField = (field: keyof StoreLocationForm, value: string | boolean) => {
    setForm((f) => ({ ...f, [field]: value }))
  }

  return (
    <div className={embedded ? undefined : 'p-4 text-ink md:p-6'}>
      {!embedded && (
        <PageHeader
          title="Mağaza konumu"
          subtitle="QR devam takibinde kullanılan geofence konumunu yönetin"
        />
      )}

      {(error || success) && (
        <div className="mb-4 flex flex-col gap-2">
          {error && <SettingsAlert tone="danger" onClose={() => setError(null)}>{error}</SettingsAlert>}
          {success && <SettingsAlert tone="success" onClose={() => setSuccess(null)}>{success}</SettingsAlert>}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 md:gap-6">
        {/* Form */}
        <Card className="gap-5 py-5">
          <CardHeader className="px-5">
            <CardTitle>{isEditing ? 'Konumu düzenle' : 'Yeni konum ekle'}</CardTitle>
            <CardDescription className="text-ink-secondary">
              Çalışanlar QR okuturken bu noktaya olan uzaklıkları kontrol edilir.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 px-5">
            <Field id="store-name" label="Mağaza adı *">
              <Input
                id="store-name"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="store-lat" label="Enlem (latitude)">
                <Input
                  id="store-lat"
                  inputMode="decimal"
                  value={form.latitude}
                  onChange={(e) => updateField('latitude', e.target.value)}
                  placeholder="41.008650"
                />
              </Field>
              <Field id="store-lon" label="Boylam (longitude)">
                <Input
                  id="store-lon"
                  inputMode="decimal"
                  value={form.longitude}
                  onChange={(e) => updateField('longitude', e.target.value)}
                  placeholder="28.978430"
                />
              </Field>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleGetCurrentLocation}
              disabled={gettingLocation}
              className="self-start"
            >
              {gettingLocation ? <Loader2 className="animate-spin" /> : <LocateFixed />}
              Mevcut Konumumu Kullan
            </Button>

            <Separator />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="store-radius" label="İzin verilen yarıçap (m)" hint="Önerilen: 100–200m">
                <Input
                  id="store-radius"
                  type="number"
                  min={10}
                  max={5000}
                  value={form.allowed_radius_meters}
                  onChange={(e) => updateField('allowed_radius_meters', e.target.value)}
                  aria-describedby="store-radius-hint"
                />
              </Field>
              <Field id="store-accuracy" label="Maks. GPS doğruluğu (m)" hint="Önerilen: 50m">
                <Input
                  id="store-accuracy"
                  type="number"
                  min={5}
                  max={500}
                  value={form.max_accuracy_meters}
                  onChange={(e) => updateField('max_accuracy_meters', e.target.value)}
                  aria-describedby="store-accuracy-hint"
                />
              </Field>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="store-active"
                checked={form.active}
                onCheckedChange={(v) => updateField('active', v)}
              />
              <Label htmlFor="store-active">Aktif</Label>
            </div>

            <div className="flex justify-end gap-2">
              {isEditing && (
                <Button variant="ghost" onClick={handleNew} disabled={saving}>
                  İptal
                </Button>
              )}
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                {isEditing ? 'Güncelle' : 'Kaydet'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Liste */}
        <SectionCard title="Kayıtlı konumlar" count={isFirstLoad ? undefined : locations.length}>
          {isFirstLoad && (
            <div className="p-4">
              <ListSkeleton count={2} lines={3} actions={2} />
            </div>
          )}
          {!isFirstLoad && locations.length === 0 && (
            <EmptyRow>Henüz mağaza konumu eklenmemiş.</EmptyRow>
          )}
          {locations.map((loc) => (
            <SectionRow
              key={loc.id}
              className={cn('items-start py-3', form.id === loc.id && 'bg-muted/60')}
            >
              <span
                className={cn(
                  'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-4',
                  loc.active ? 'bg-brand-soft text-brand' : 'bg-surface-muted text-ink-muted'
                )}
              >
                <MapPin />
              </span>
              <div className={cn('min-w-0 flex-1', !loc.active && 'opacity-70')}>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-bold">{loc.name}</span>
                  <Badge tone={loc.active ? 'success' : 'neutral'}>{loc.active ? 'Aktif' : 'Pasif'}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-ink-secondary tabular-nums">
                  {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge tone="neutral" className="font-medium">Yarıçap {loc.allowed_radius_meters}m</Badge>
                  <Badge tone="neutral" className="font-medium">GPS ≤ {loc.max_accuracy_meters}m</Badge>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => handleEdit(loc)}>
                Düzenle
              </Button>
            </SectionRow>
          ))}
        </SectionCard>
      </div>
    </div>
  )
}

/** Etiket + alan + soluk yardım metni */
function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p id={`${id}-hint`} className="text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}
