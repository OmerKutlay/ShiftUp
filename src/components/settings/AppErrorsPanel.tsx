'use client'

/**
 * AppErrorsPanel — son 100 uygulama hatası (salt okunur, yalnızca Admin).
 * Kaynak: app_errors (sunucu 500'leri + tarayıcı hataları, 30 gün saklanır).
 * Denetim kaydıyla aynı dil: DataTable (mobilde Item kartları), satıra dokununca ayrıntı Dialog'u.
 */
import { useState } from 'react'
import useSWR from 'swr'
import { Bug, ChevronRight, CircleAlert, Monitor, RotateCw, Server } from 'lucide-react'
import { apiFetch } from '@/lib/api/http'
import { DataTable, TableSkeleton, type ColumnDef } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'

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

const isClient = (e: AppError) => e.source.startsWith('client:')

function SourceBadge({ e }: { e: AppError }) {
  return <Badge variant={isClient(e) ? 'secondary' : 'outline'} className="font-mono">{e.source}</Badge>
}

function DetailsDialog({ e, onClose }: { e: AppError | null; onClose: () => void }) {
  return (
    <Dialog open={!!e} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {e && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6 break-words">{e.message}</DialogTitle>
              <DialogDescription className="tabular-nums">{fmt.format(new Date(e.created_at))}</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Kaynak</dt>
              <dd><SourceBadge e={e} /></dd>
              {e.request_id && (<><dt className="text-muted-foreground">İstek (cf-ray)</dt><dd className="font-mono break-all">{e.request_id}</dd></>)}
              {e.employee_id && (<><dt className="text-muted-foreground">Çalışan</dt><dd className="font-mono break-all">{e.employee_id}</dd></>)}
              {e.store_id && (<><dt className="text-muted-foreground">Mağaza</dt><dd className="font-mono break-all">{e.store_id}</dd></>)}
              {e.meta && (<><dt className="text-muted-foreground">Ek bilgi</dt><dd className="font-mono break-all">{JSON.stringify(e.meta)}</dd></>)}
            </dl>
            {e.stack && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Yığın izi</p>
                <pre className="max-h-64 overflow-auto rounded-lg border bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">{e.stack}</pre>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function AppErrorsPanel() {
  const [selected, setSelected] = useState<AppError | null>(null)
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    '/api/app-errors',
    (url: string) => apiFetch<{ errors: AppError[] }>(url),
  )
  const errors = data?.errors ?? []

  const columns: ColumnDef<AppError>[] = [
    {
      id: 'when',
      header: 'Zaman',
      accessorFn: (e) => e.created_at,
      meta: { className: 'w-40 whitespace-nowrap tabular-nums' },
      cell: ({ row }) => fmt.format(new Date(row.original.created_at)),
    },
    {
      id: 'source',
      header: 'Kaynak',
      enableSorting: false,
      meta: { className: 'w-40' },
      cell: ({ row }) => <SourceBadge e={row.original} />,
    },
    {
      id: 'message',
      header: 'Mesaj',
      enableSorting: false,
      meta: { className: 'max-w-0 w-full' },
      cell: ({ row }) => <span className="block truncate font-medium" title={row.original.message}>{row.original.message}</span>,
    },
    {
      id: 'details',
      header: () => <span className="sr-only">Ayrıntılar</span>,
      enableSorting: false,
      meta: { align: 'right', className: 'w-12 py-0' },
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="Hata ayrıntıları"
          onClick={(ev) => { ev.stopPropagation(); setSelected(row.original) }}
        >
          <ChevronRight />
        </Button>
      ),
    },
  ]

  const mobileItem = (e: AppError) => (
    <Item variant="outline" size="sm" asChild className="items-start">
      <button type="button" onClick={() => setSelected(e)} className="w-full text-left">
        <ItemMedia variant="icon">{isClient(e) ? <Monitor /> : <Server />}</ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="line-clamp-2 break-words">{e.message}</ItemTitle>
          <ItemDescription className="font-mono text-xs">{e.source}</ItemDescription>
          <ItemDescription className="tabular-nums">{fmt.format(new Date(e.created_at))}</ItemDescription>
        </ItemContent>
        <ChevronRight className="mt-1.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </Item>
  )

  const empty = (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Bug /></EmptyMedia>
        <EmptyTitle>Kayıtlı hata yok</EmptyTitle>
        <EmptyDescription>Son 30 günde bildirilen bir hata bulunmuyor.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )

  return (
    <Card className="gap-5 shadow-xs">
      <CardHeader className="px-4 max-sm:grid-cols-1! md:px-6">
        <CardTitle>Uygulama hataları</CardTitle>
        <CardDescription>Son 100 hata (sunucu ve tarayıcı). 30 gün sonra otomatik silinir. Ayrıntılar için kayda dokunun.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => void mutate()} disabled={isValidating}>
            {isValidating ? <Spinner /> : <RotateCw />}
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
        {isLoading && <TableSkeleton rows={5} columns={3} />}
        {!isLoading && !error && (
          <DataTable
            columns={columns}
            data={errors}
            initialSorting={[{ id: 'when', desc: true }]}
            getRowId={(e) => e.id}
            onRowClick={setSelected}
            renderMobileItem={mobileItem}
            empty={empty}
          />
        )}
      </CardContent>

      <DetailsDialog e={selected} onClose={() => setSelected(null)} />
    </Card>
  )
}
