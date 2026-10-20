'use client'

/**
 * DataTable — ortak veri tablosu (shadcn "Data Table" kalıbı, TanStack Table v8).
 * DESIGN_GUIDE §5 "Tablolar":
 *   - üstte araç çubuğu (toolbar), tablo kenarlıklı kutuda, başlık bg-muted ve yapışkan
 *   - sıralanabilir başlıklar (column.enableSorting), sayfalama ("N kayıttan 1–20")
 *   - mobilde `renderMobileItem` verilirse tablo yerine Item kartları
 *
 * Kullanım:
 *   const columns: ColumnDef<Row>[] = [{ accessorKey: 'full_name', header: 'Çalışan' }, …]
 *   <DataTable columns={columns} data={rows} toolbar={…} empty={<Empty…/>} />
 */
import { useState } from 'react'
import {
  flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useIsMobile } from '@/hooks/useIsMobile'
import { cn } from '@/lib/utils'

export type { ColumnDef }

/** Sütun meta bilgisi: hizalama ve hücre sınıfı */
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    align?: 'left' | 'right' | 'center'
    className?: string
    headerClassName?: string
  }
}

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  /** Tablonun üstündeki araç çubuğu (arama, filtreler, eylemler) */
  toolbar?: React.ReactNode
  /** Veri yokken gösterilecek içerik (shadcn Empty) */
  empty?: React.ReactNode
  /** Sayfa başına satır; 0 = sayfalama yok */
  pageSize?: number
  initialSorting?: SortingState
  getRowId?: (row: T, index: number) => string
  /** Satıra tıklanınca (tüm satır tıklanabilir olur) */
  onRowClick?: (row: T) => void
  /** Mobilde tablo yerine bu kartlar gösterilir */
  renderMobileItem?: (row: T) => React.ReactNode
  className?: string
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const

export function DataTable<T>({
  columns, data, toolbar, empty, pageSize = 20, initialSorting = [], getRowId, onRowClick, renderMobileItem, className,
}: DataTableProps<T>) {
  const isMobile = useIsMobile()
  const [sorting, setSorting] = useState<SortingState>(initialSorting)
  // TanStack Table kendi içinde kararlı fonksiyonlar döndürür; React Compiler uyarısı bilinçli olarak kapalı
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(pageSize > 0 && { getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize } } }),
    autoResetPageIndex: true,
  })

  const rows = table.getRowModel().rows
  const total = data.length
  const { pageIndex, pageSize: size } = table.getState().pagination
  const from = total === 0 ? 0 : pageIndex * size + 1
  const to = Math.min(total, (pageIndex + 1) * size)

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {toolbar}

      {total === 0 && empty ? (
        <div className="rounded-lg border">{empty}</div>
      ) : isMobile && renderMobileItem ? (
        <div className="flex flex-col gap-2">
          {rows.map((r) => <div key={r.id}>{renderMobileItem(r.original)}</div>)}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="hover:bg-transparent">
                  {hg.headers.map((h) => {
                    const meta = h.column.columnDef.meta
                    const sortable = h.column.getCanSort()
                    const dir = h.column.getIsSorted()
                    const label = h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())
                    return (
                      <TableHead
                        key={h.id}
                        className={cn(ALIGN[meta?.align ?? 'left'], meta?.headerClassName)}
                        aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={h.column.getToggleSortingHandler()}
                            className={cn(
                              '-mx-2 inline-flex h-8 items-center gap-1 rounded-md px-2 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                              meta?.align === 'right' && 'flex-row-reverse'
                            )}
                          >
                            {label}
                            {dir === 'asc' ? <ArrowUp className="size-3.5" /> : dir === 'desc' ? <ArrowDown className="size-3.5" />
                              : <ArrowUpDown className="size-3.5 opacity-40" />}
                          </button>
                        ) : label}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  onClick={onRowClick ? () => onRowClick(r.original) : undefined}
                  className={cn(onRowClick && 'cursor-pointer')}
                >
                  {r.getVisibleCells().map((c) => {
                    const meta = c.column.columnDef.meta
                    return (
                      <TableCell key={c.id} className={cn('h-12', ALIGN[meta?.align ?? 'left'], meta?.className)}>
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pageSize > 0 && total > size && (
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="text-sm text-muted-foreground tabular-nums">
            {total} kayıttan {from}–{to}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Önceki sayfa"
            >
              <ChevronLeft />
            </Button>
            <span className="text-sm tabular-nums">
              {pageIndex + 1} / {table.getPageCount()}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Sonraki sayfa"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
