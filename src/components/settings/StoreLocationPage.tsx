'use client'

/**
 * StoreLocationPage — QR devam takibinde kullanılan mağaza konumu (geofence).
 * Yalnızca aktif mağazanın konumlarını listeler/düzenler (mağaza başına tek aktif konum).
 *
 * Ayarlar › Mağaza konumu sekmesi: solda konum formu (Field), sağda kayıtlı konumlar (Item listesi).
 * Listeden "Düzenle" formu doldurur; kayıt sonrası form temizlenir ve sonuç toast ile bildirilir.
 */
import { useRef, useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import {
  CircleAlert, ExternalLink, LocateFixed, MapPin, MapPinOff, MoreHorizontal, Plus, SquarePen,
} from 'lucide-react'
import type { StoreLocation } from '@/types/location'
import { ListSkeleton, Page, PageHeader, StatusBadge } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { apiFetch } from '@/lib/api/http'
import { cn } from '@/lib/utils'

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

const mapsUrl = (loc: StoreLocation) => `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`

// ─── Kayıtlı konum satırı ────────────────────────────────────

function LocationItem({ loc, selected, onEdit }: { loc: StoreLocation; selected: boolean; onEdit: () => void }) {
  return (
    <Item size="sm" className={cn('rounded-none px-4 md:px-6', selected && 'bg-muted/60')}>
      <ItemMedia variant="icon" className={cn(loc.active ? 'text-foreground' : 'text-muted-foreground')}>
        {loc.active ? <MapPin /> : <MapPinOff />}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full min-w-0">
          <span className="truncate">{loc.name}</span>
          {selected && <Badge variant="secondary">Düzenleniyor</Badge>}
        </ItemTitle>
        <ItemDescription className="tabular-nums">
          Yarıçap {loc.allowed_radius_meters} m · GPS ≤ {loc.max_accuracy_meters} m
        </ItemDescription>
        <p className="text-xs text-muted-foreground tabular-nums">
          {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
        </p>
      </ItemContent>
      <ItemActions className="self-start">
        <StatusBadge tone={loc.active ? 'success' : 'neutral'} label={loc.active ? 'Aktif' : 'Pasif'} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground data-[state=open]:bg-muted" aria-label={`${loc.name} işlemleri`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onEdit}>
              <SquarePen />
              Düzenle
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={mapsUrl(loc)} target="_blank" rel="noreferrer">
                <ExternalLink />
                Haritada aç
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  )
}

// ─── Sayfa ───────────────────────────────────────────────────

/** embedded: sekmeli Ayarlar sayfasının içinde (başlık ve sayfa dolgusu olmadan) */
export function StoreLocationPage({ embedded = false }: { embedded?: boolean } = {}) {
  const locationsQ = useSWR('/api/store-location', (url: string) => apiFetch<{ locations: StoreLocation[] }>(url))
  const locations = locationsQ.data?.locations ?? []
  const isFirstLoad = !locationsQ.data && !locationsQ.error
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadError = locationsQ.error ? (locationsQ.error instanceof Error ? locationsQ.error.message : 'Yükleme hatası.') : null

  const [form, setForm] = useState<StoreLocationForm>(DEFAULT_FORM)
  const [isEditing, setIsEditing] = useState(false)
  const [gettingLocation, setGettingLocation] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  const load = () => locationsQ.mutate()

  const handleEdit = (loc: StoreLocation) => {
    setForm(locationToForm(loc))
    setIsEditing(true)
    setError(null)
    // Dar ekranda form listenin üstünde kalır: form görünür alanın dışındaysa forma kaydır
    const top = formRef.current?.getBoundingClientRect().top
    if (top !== undefined && top < 0) formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  const handleNew = () => {
    setForm(DEFAULT_FORM)
    setIsEditing(false)
    setError(null)
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

    const lat = parseFloat(form.latitude)
    const lon = parseFloat(form.longitude)
    const radius = parseInt(form.allowed_radius_meters, 10)
    const accuracy = parseInt(form.max_accuracy_meters, 10)

    if (!form.name.trim()) { setError('Konum etiketi zorunludur.'); return }
    if (isNaN(lat)) { setError('Geçersiz enlem (latitude).'); return }
    if (isNaN(lon)) { setError('Geçersiz boylam (longitude).'); return }
    if (isNaN(radius) || radius < 10 || radius > 5000) { setError('Yarıçap 10–5000 m arası olmalı.'); return }
    if (isNaN(accuracy) || accuracy < 5 || accuracy > 500) { setError('Maks. GPS doğruluğu 5–500 m arası olmalı.'); return }

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
      toast.success(form.id ? 'Mağaza konumu güncellendi' : 'Mağaza konumu eklendi')
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

  const formCard = (
    <Card ref={formRef} className="scroll-mt-20 gap-0 py-0 shadow-xs">
      <CardHeader className="border-b px-4 py-5 md:px-6 [.border-b]:pb-5">
        <CardTitle>{isEditing ? 'Konumu düzenle' : 'Yeni konum'}</CardTitle>
        <CardDescription>
          {isEditing ? form.name || 'Kayıtlı konum' : 'Aktif mağazanın konumu. Çalışanlar QR okuturken bu noktaya olan uzaklıkları kontrol edilir.'}
        </CardDescription>
        {isEditing && (
          <CardAction>
            <Button variant="outline" size="sm" onClick={handleNew} disabled={saving}>
              <Plus />
              Yeni konum
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <form
        noValidate
        onSubmit={(e) => { e.preventDefault(); void handleSave() }}
        className="contents"
      >
        <CardContent className="px-4 py-5 md:px-6">
          <FieldGroup className="gap-6">
            {error && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Konum kaydedilemedi</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Field>
              <FieldLabel htmlFor="store-name">Konum etiketi</FieldLabel>
              <Input
                id="store-name"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="Örn: Ana giriş"
                autoComplete="off"
              />
            </Field>

            <FieldSet className="gap-4">
              <FieldLegend variant="label" className="mb-0">Koordinatlar</FieldLegend>
              <FieldDescription>Mağazanın girişinde alınan konum en iyi sonucu verir.</FieldDescription>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="store-lat">Enlem (latitude)</FieldLabel>
                  <Input
                    id="store-lat"
                    inputMode="decimal"
                    value={form.latitude}
                    onChange={(e) => updateField('latitude', e.target.value)}
                    placeholder="41.008650"
                    className="tabular-nums"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="store-lon">Boylam (longitude)</FieldLabel>
                  <Input
                    id="store-lon"
                    inputMode="decimal"
                    value={form.longitude}
                    onChange={(e) => updateField('longitude', e.target.value)}
                    placeholder="28.978430"
                    className="tabular-nums"
                  />
                </Field>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGetCurrentLocation}
                disabled={gettingLocation}
                className="self-start"
              >
                {gettingLocation ? <Spinner /> : <LocateFixed />}
                Mevcut konumumu kullan
              </Button>
            </FieldSet>

            <FieldSeparator />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="store-radius">İzin verilen yarıçap</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="store-radius"
                    type="number"
                    min={10}
                    max={5000}
                    value={form.allowed_radius_meters}
                    onChange={(e) => updateField('allowed_radius_meters', e.target.value)}
                    aria-describedby="store-radius-hint"
                    className="tabular-nums"
                  />
                  <InputGroupAddon align="inline-end"><InputGroupText>m</InputGroupText></InputGroupAddon>
                </InputGroup>
                <FieldDescription id="store-radius-hint">Önerilen: 100–200 m</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="store-accuracy">Maks. GPS doğruluğu</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="store-accuracy"
                    type="number"
                    min={5}
                    max={500}
                    value={form.max_accuracy_meters}
                    onChange={(e) => updateField('max_accuracy_meters', e.target.value)}
                    aria-describedby="store-accuracy-hint"
                    className="tabular-nums"
                  />
                  <InputGroupAddon align="inline-end"><InputGroupText>m</InputGroupText></InputGroupAddon>
                </InputGroup>
                <FieldDescription id="store-accuracy-hint">Önerilen: 50 m</FieldDescription>
              </Field>
            </div>

            <Field orientation="horizontal" className="rounded-lg border p-4">
              <FieldContent>
                <FieldLabel htmlFor="store-active">Aktif</FieldLabel>
                <FieldDescription>QR doğrulamasında mağazanın yalnızca aktif konumu kullanılır; yeni bir konumu aktif yapmak mevcut aktif konumu pasifleştirir.</FieldDescription>
              </FieldContent>
              <Switch
                id="store-active"
                checked={form.active}
                onCheckedChange={(v) => updateField('active', v)}
              />
            </Field>
          </FieldGroup>
        </CardContent>

        <CardFooter className="justify-end gap-2 border-t px-4 py-4 md:px-6 [.border-t]:pt-4">
          {isEditing && (
            <Button type="button" variant="outline" onClick={handleNew} disabled={saving}>
              İptal
            </Button>
          )}
          <Button type="submit" disabled={saving}>
            {saving && <Spinner />}
            {isEditing ? 'Güncelle' : 'Kaydet'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )

  const listCard = (
    <Card className="gap-0 overflow-hidden py-0 shadow-xs">
      <CardHeader className="border-b px-4 py-5 md:px-6 [.border-b]:pb-5">
        <CardTitle className="flex items-center gap-2">
          Kayıtlı konumlar
          {!isFirstLoad && <Badge variant="secondary" className="tabular-nums">{locations.length}</Badge>}
        </CardTitle>
        <CardDescription>Düzenlemek için konumun menüsünü açın.</CardDescription>
      </CardHeader>
      {isFirstLoad && (
        <div className="p-4 md:px-6">
          <ListSkeleton count={2} lines={2} />
        </div>
      )}
      {loadError && (
        <div className="p-4 md:px-6">
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Konumlar yüklenemedi</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        </div>
      )}
      {!isFirstLoad && !loadError && locations.length === 0 && (
        <Empty className="py-10 md:py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon"><MapPin /></EmptyMedia>
            <EmptyTitle>Henüz konum yok</EmptyTitle>
            <EmptyDescription>QR ile giriş-çıkış için aktif mağazanın konumunu ekleyin.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {locations.length > 0 && (
        <ItemGroup className="py-1">
          {locations.map((loc, i) => (
            <div key={loc.id}>
              {i > 0 && <ItemSeparator />}
              <LocationItem loc={loc} selected={form.id === loc.id} onEdit={() => handleEdit(loc)} />
            </div>
          ))}
        </ItemGroup>
      )}
    </Card>
  )

  const content = (
    <div className="grid grid-cols-1 items-start gap-4 md:gap-6 @4xl/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {formCard}
      {listCard}
    </div>
  )

  if (embedded) return content
  return (
    <Page>
      <PageHeader title="Mağaza konumu" description="Aktif mağazanın QR devam takibinde kullanılan geofence konumunu yönetin" />
      {content}
    </Page>
  )
}
