'use client'

/**
 * KvkkPanel — Ayarlar › KVKK: şirket (veri sorumlusu) bilgileri + aktif mağazadaki çalışanların
 * aydınlatma metni onay durumu.
 *
 * Şirket bilgisi mağazadan bağımsızdır; yalnızca Admin düzenler, Mağaza Müdürü+ görür.
 * Onay listesi yalnızca aktif mağazanın aktif çalışanlarını gösterir.
 */
import { Fragment, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import { CircleAlert, ExternalLink, Users } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { ACCESS } from '@/lib/auth/roles'
import { formatInTimeZone } from '@/lib/dateUtils'
import { COMPANY_FIELD_LIMITS, KVKK_NOTICE_VERSION, PRIVACY_PATH, type CompanySettings } from '@/lib/kvkk'
import {
  COMPANY_SETTINGS_KEY, KVKK_LIST_KEY, fetchCompanySettings, fetchKvkkAckList, saveCompanySettings,
} from '@/lib/api/kvkk'
import { ListSkeleton, PersonAvatar, StatusBadge } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle,
} from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'

function CompanyForm({ canEdit }: { canEdit: boolean }) {
  const { data, mutate } = useSWR(COMPANY_SETTINGS_KEY, fetchCompanySettings)
  // Düzenleme taslağı: dokunulana kadar sunucudaki değer gösterilir
  const [draft, setDraft] = useState<CompanySettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const form: CompanySettings = draft ?? {
    legal_name: data?.settings.legal_name ?? '',
    address: data?.settings.address ?? '',
    kvkk_email: data?.settings.kvkk_email ?? '',
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const saved = await saveCompanySettings(form)
      await mutate({ settings: saved }, { revalidate: false })
      setDraft(null)
      toast.success('Şirket bilgileri kaydedildi.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi.')
    } finally {
      setBusy(false)
    }
  }

  const set = (key: keyof CompanySettings) => (v: string) => setDraft({ ...form, [key]: v })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Veri sorumlusu bilgileri</CardTitle>
        <CardDescription>
          Aydınlatma metninde görünür. Boş bırakılan alanlar köşeli parantezli yer tutucuyla gösterilir.
          {!canEdit && ' Yalnızca Admin düzenleyebilir.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={(e) => { e.preventDefault(); void save() }}
          className="flex max-w-xl flex-col gap-5"
        >
          <FieldGroup className="gap-5">
            {error && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="company-name">Şirket unvanı</FieldLabel>
              <Input
                id="company-name"
                value={form.legal_name ?? ''}
                maxLength={COMPANY_FIELD_LIMITS.legal_name}
                disabled={!canEdit || busy}
                onChange={(e) => set('legal_name')(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="company-address">Adres</FieldLabel>
              <Textarea
                id="company-address"
                rows={3}
                value={form.address ?? ''}
                maxLength={COMPANY_FIELD_LIMITS.address}
                disabled={!canEdit || busy}
                onChange={(e) => set('address')(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="company-email">KVKK başvuru e-postası</FieldLabel>
              <Input
                id="company-email"
                type="email"
                value={form.kvkk_email ?? ''}
                maxLength={COMPANY_FIELD_LIMITS.kvkk_email}
                disabled={!canEdit || busy}
                onChange={(e) => set('kvkk_email')(e.target.value)}
              />
              <FieldDescription>Çalışanların m.11 başvurularını göndereceği adres.</FieldDescription>
            </Field>
          </FieldGroup>
          {canEdit && (
            <Button type="submit" disabled={busy} className="w-fit">
              {busy && <Spinner />}
              Kaydet
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

function AckList() {
  const { data, error, isLoading } = useSWR(KVKK_LIST_KEY, fetchKvkkAckList)
  const rows = data?.employees ?? []
  const done = rows.filter((r) => r.kvkk_notice_ack_at && r.kvkk_notice_version === KVKK_NOTICE_VERSION).length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bilgilendirme durumu</CardTitle>
        <CardDescription>
          Aktif mağazadaki çalışanların güncel aydınlatma metnini (sürüm {KVKK_NOTICE_VERSION}) teyit durumu
          {data ? ` — ${done}/${rows.length} çalışan` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error instanceof Error ? error.message : 'Liste alınamadı.'}</AlertDescription>
          </Alert>
        )}
        {isLoading && <ListSkeleton count={4} actions={1} />}
        {data && rows.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><Users /></EmptyMedia>
              <EmptyTitle>Aktif çalışan yok</EmptyTitle>
              <EmptyDescription>Bu mağazada teyit bekleyen çalışan bulunmuyor.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {rows.length > 0 && (
          <ItemGroup>
            {rows.map((r, i) => {
              const current = !!r.kvkk_notice_ack_at && r.kvkk_notice_version === KVKK_NOTICE_VERSION
              return (
                <Fragment key={r.id}>
                  {i > 0 && <ItemSeparator />}
                  <Item size="sm" className="px-0">
                    <ItemMedia><PersonAvatar name={r.full_name} /></ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="truncate">{r.full_name}</ItemTitle>
                      <ItemDescription className="tabular-nums">
                        {r.kvkk_notice_ack_at
                          ? `Sürüm ${r.kvkk_notice_version ?? '?'} · ${formatInTimeZone(r.kvkk_notice_ack_at, 'dd.MM.yyyy HH:mm')}`
                          : 'Henüz teyit etmedi'}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <StatusBadge
                        tone={current ? 'success' : r.kvkk_notice_ack_at ? 'warning' : 'neutral'}
                        label={current ? 'Güncel' : r.kvkk_notice_ack_at ? 'Eski sürüm' : 'Bekliyor'}
                      />
                    </ItemActions>
                  </Item>
                </Fragment>
              )
            })}
          </ItemGroup>
        )}
      </CardContent>
    </Card>
  )
}

export function KvkkPanel() {
  const { employee } = useAuth()
  const isAdmin = employee?.roles?.access_level === ACCESS.ADMIN
  return (
    <div className="flex max-w-3xl flex-col gap-4 md:gap-6">
      <Alert tone="warning">
        <CircleAlert />
        <AlertTitle>Aydınlatma metni bir şablondur</AlertTitle>
        <AlertDescription>
          Yayına almadan önce şirketin hukuk müşaviri tarafından gözden geçirilmelidir (saklama süreleri, yurt dışı
          aktarım dayanağı). Yurt dışı aktarımda standart sözleşme imzalandıysa 5 iş günü içinde Kurum&apos;a bildirilmelidir. Konum yalnızca QR okutulduğunda alınır ve ham koordinat saklanmaz.{' '}
          <Link href={PRIVACY_PATH} prefetch={false} className="inline-flex items-center gap-1 underline underline-offset-2">
            Metni görüntüle <ExternalLink className="size-3.5" aria-hidden />
          </Link>
        </AlertDescription>
      </Alert>
      <CompanyForm canEdit={isAdmin} />
      <AckList />
    </div>
  )
}
