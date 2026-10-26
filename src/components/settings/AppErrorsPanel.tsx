'use client'

/**
 * AppErrorsPanel — son 100 uygulama hatası (salt okunur, yalnızca Admin).
 * Kaynak: app_errors (sunucu 500'leri + tarayıcı hataları, 30 gün saklanır).
 */
import { useState } from 'react'
import useSWR from 'swr'
import { Bug, ChevronDown, CircleAlert, RotateCw } from 'lucide-react'
import { apiFetch } from '@/lib/api/http'
import { TableSkeleton } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

interface AppError {
  id: string
  created_at: string
  source: string
  message: string
  stack: string | null
  request_id: string | null
  employee_id: string | null
  store_id: string | null
  meta: Record<string, unknown> | null
}

const fmt = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Istanbul',
})

function ErrorRow({ e }: { e: AppError }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-lg border p-3 text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 text-left"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={e.source.startsWith('client:') ? 'secondary' : 'outline'} className="font-mono">{e.source}</Badge>
            <span className="text-xs text-muted-foreground tabular-nums">{fmt.format(new Date(e.created_at))}</span>
          </span>
          <span className="break-words font-medium">{e.message}</span>
        </span>
        <ChevronDown className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <dl className="mt-3 flex flex-col gap-2 text-xs">
          {e.request_id && <div><dt className="text-muted-foreground">İstek (cf-ray)</dt><dd className="font-mono">{e.request_id}</dd></div>}
          {e.employee_id && <div><dt className="text-muted-foreground">Çalışan</dt><dd className="font-mono">{e.employee_id}</dd></div>}
          {e.store_id && <div><dt className="text-muted-foreground">Mağaza</dt><dd className="font-mono">{e.store_id}</dd></div>}
          {e.meta && <div><dt className="text-muted-foreground">Ek bilgi</dt><dd className="font-mono break-all">{JSON.stringify(e.meta)}</dd></div>}
          {e.stack && (
            <div>
              <dt className="text-muted-foreground">Yığın izi</dt>
              <dd><pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono whitespace-pre-wrap break-all">{e.stack}</pre></dd>
            </div>
          )}
        </dl>
      )}
    </li>
  )
}

export function AppErrorsPanel() {
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    '/api/app-errors',
    (url: string) => apiFetch<{ errors: AppError[] }>(url),
  )
  const errors = data?.errors ?? []

  return (
    <Card className="gap-5 shadow-xs">
      <CardHeader className="px-4 max-sm:grid-cols-1! md:px-6">
        <CardTitle>Uygulama hataları</CardTitle>
        <CardDescription>Son 100 hata (sunucu ve tarayıcı). 30 gün sonra otomatik silinir.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => void mutate()} disabled={isValidating}>
            <RotateCw />
            Yenile
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 md:px-6">
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Hatalar yüklenemedi</AlertTitle>
            <AlertDescription>{error instanceof Error ? error.message : 'Bilinmeyen hata'}</AlertDescription>
          </Alert>
        )}
        {isLoading && <TableSkeleton rows={5} columns={2} />}
        {!isLoading && !error && errors.length === 0 && (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Bug /></EmptyMedia>
              <EmptyTitle>Kayıtlı hata yok</EmptyTitle>
              <EmptyDescription>Son 30 günde bildirilen bir hata bulunmuyor.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {errors.length > 0 && <ul className="flex flex-col gap-2">{errors.map((e) => <ErrorRow key={e.id} e={e} />)}</ul>}
      </CardContent>
    </Card>
  )
}
