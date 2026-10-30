'use client'

/**
 * AdminLoginPanel — Ayarlar › Admin girişi (yalnızca Admin).
 *
 * Admin hesapları yalnızca ayrı giriş adresinden (/login/admin) girer ve e-posta kodundan önce
 * admin şifresi ister. Burada giriş adresi kopyalanır ve adminlerin şifreleri belirlenir:
 * kendi şifresini değiştiren admin mevcut şifresini de girer; başka bir admine (ör. şifresini
 * unutan ya da yeni admin yapılan) doğrudan yeni şifre atanır.
 */
import { useState, useSyncExternalStore } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { CircleAlert, Copy, KeyRound, Link2, ShieldCheck } from 'lucide-react'

import { apiFetch } from '@/lib/api/http'
import type { AdminPasswordRow } from '@/types/adminPassword'
import { ListSkeleton, StatusBadge } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'

const ADMIN_PASSWORDS_KEY = '/api/admin-passwords'
/** Sunucudaki kuralla aynı (adminPasswordProblem); sunucu yine doğrular */
const MIN_LENGTH = 10

const dateFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

function PasswordDialog({ row, onClose, onSaved }: {
  row: AdminPasswordRow
  onClose: () => void
  onSaved: () => void
}) {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (row.is_self && !current) { setError('Mevcut admin şifrenizi girin.'); return }
    if (password.length < MIN_LENGTH) { setError(`Yeni şifre en az ${MIN_LENGTH} karakter olmalı.`); return }
    if (password !== repeat) { setError('Yeni şifreler eşleşmiyor.'); return }
    setSaving(true)
    try {
      await apiFetch(ADMIN_PASSWORDS_KEY, {
        method: 'POST',
        body: { employee_id: row.id, password, ...(row.is_self ? { current_password: current } : {}) },
      })
      toast.success('Admin şifresi kaydedildi', { description: row.full_name })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="contents">
          <DialogHeader>
            <DialogTitle>{row.is_self ? 'Admin şifremi değiştir' : `${row.full_name} · admin şifresi`}</DialogTitle>
            <DialogDescription>
              {row.is_self
                ? 'Sonraki admin girişlerinde yeni şifre istenir; açık oturumlarınız kapanmaz.'
                : 'Bu admin sonraki girişinde bu şifreyi kullanır. Şifreyi kendisine güvenli bir yoldan iletin.'}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {row.is_self && (
              <Field>
                <FieldLabel htmlFor="admin-pw-current">Mevcut şifre</FieldLabel>
                <Input
                  id="admin-pw-current"
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => { setCurrent(e.target.value); setError(null) }}
                  autoFocus
                />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="admin-pw-new">Yeni şifre</FieldLabel>
              <Input
                id="admin-pw-new"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null) }}
                autoFocus={!row.is_self}
              />
              <FieldDescription>En az {MIN_LENGTH} karakter. Başka bir yerde kullanmadığınız bir şifre seçin.</FieldDescription>
            </Field>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="admin-pw-repeat">Yeni şifre (tekrar)</FieldLabel>
              <Input
                id="admin-pw-repeat"
                type="password"
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => { setRepeat(e.target.value); setError(null) }}
                aria-invalid={!!error}
              />
              {error && <FieldError>{error}</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>İptal</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner />}
              Kaydet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const noopSubscribe = () => () => {}

function LoginLinkCard() {
  // Sunucuda origin bilinmez; hidrasyon uyumsuzluğu olmasın diye istemcide tamamlanır
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => '')
  const url = `${origin}/login/admin`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Admin giriş adresi kopyalandı')
    } catch {
      toast.error('Kopyalanamadı. Adresi elle seçip kopyalayın.')
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Link2 className="size-5" /> Admin giriş adresi</CardTitle>
        <CardDescription>
          Admin hesapları normal giriş sayfasından giremez; bu adresi kullanır. Normal girişte admin
          e-postasına kod gönderilmez.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-sm">{url}</code>
        <Button variant="outline" onClick={() => void copy()}>
          <Copy />
          Kopyala
        </Button>
      </CardContent>
    </Card>
  )
}

export function AdminLoginPanel() {
  const [editing, setEditing] = useState<AdminPasswordRow | null>(null)
  const { data, error, isLoading, mutate } = useSWR(
    ADMIN_PASSWORDS_KEY,
    (url: string) => apiFetch<{ admins: AdminPasswordRow[] }>(url),
  )

  return (
    <div className="flex max-w-3xl flex-col gap-4 md:gap-6">
      <LoginLinkCard />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5" /> Admin şifreleri</CardTitle>
          <CardDescription>
            Admin girişinde e-posta kodundan önce bu şifre istenir. Şifresi olmayan admin giriş yapamaz.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Adminler yüklenemedi</AlertTitle>
              <AlertDescription>{error instanceof Error ? error.message : 'Yükleme hatası.'}</AlertDescription>
            </Alert>
          )}
          {isLoading && <ListSkeleton count={3} avatar={false} />}

          <ItemGroup className="gap-2">
            {(data?.admins ?? []).map((a) => (
              <Item key={a.id} variant="outline" size="sm" className="flex-wrap">
                <ItemContent className="min-w-0">
                  <ItemTitle className="flex flex-wrap items-center gap-2">
                    <span className="truncate">{a.full_name}{a.is_self && ' (siz)'}</span>
                    {a.has_password
                      ? <StatusBadge tone="success" label="Şifre var" />
                      : <StatusBadge tone="warning" label="Şifre yok" />}
                  </ItemTitle>
                  <ItemDescription className="truncate">
                    {a.email ?? 'E-posta yok'}
                    {a.password_updated_at && ` · güncellendi ${dateFmt.format(new Date(a.password_updated_at))}`}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button variant="outline" size="sm" onClick={() => setEditing(a)}>
                    <KeyRound />
                    {a.is_self ? 'Şifremi değiştir' : a.has_password ? 'Yeni şifre belirle' : 'Şifre belirle'}
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </CardContent>
      </Card>

      {editing && (
        <PasswordDialog key={editing.id} row={editing} onClose={() => setEditing(null)} onSaved={() => void mutate()} />
      )}
    </div>
  )
}
