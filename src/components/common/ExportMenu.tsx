'use client'

/**
 * ExportMenu — rapor ve planlardaki "Dışa aktar" düğmesi: PDF / CSV / Excel seçenekleri.
 * Dosya hazırlanırken düğme kilitlenir; hata toast ile gösterilir (ham JSON'a gidilmez).
 */
import { useState, type ReactNode } from 'react'
import { Download, FileSpreadsheet, FileText, Sheet } from 'lucide-react'
import { toast } from 'sonner'
import { downloadErrorMessage } from '@/lib/export/download'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'

export type ExportFormat = 'pdf' | 'csv' | 'xlsx'

export interface ExportOption {
  format: ExportFormat
  /** Varsayılan: "PDF indir" / "CSV indir" / "Excel indir" */
  label?: string
  run: () => Promise<void> | void
}

const DEFAULT_LABEL: Record<ExportFormat, string> = { pdf: 'PDF indir', csv: 'CSV indir', xlsx: 'Excel indir' }
const ICON: Record<ExportFormat, ReactNode> = { pdf: <FileText />, csv: <Sheet />, xlsx: <FileSpreadsheet /> }

export function ExportMenu({
  options, disabled, label = 'Dışa aktar', iconOnly, className, extra,
}: {
  options: ExportOption[]
  disabled?: boolean
  label?: string
  /** Mobil başlık eylemlerinde yalnızca simge */
  iconOnly?: boolean
  className?: string
  /** Menünün sonunda ayraçla eklenen ek öğeler (ör. Yazdır) */
  extra?: ReactNode
}) {
  const [busy, setBusy] = useState<ExportFormat | null>(null)

  const run = async (o: ExportOption) => {
    setBusy(o.format)
    try {
      await o.run()
    } catch (err) {
      toast.error(downloadErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={iconOnly ? 'icon' : 'default'}
          disabled={disabled || busy !== null}
          aria-label={iconOnly ? label : undefined}
          className={className}
        >
          {busy ? <Spinner /> : <Download />}
          {!iconOnly && (busy ? 'Hazırlanıyor…' : label)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {options.map((o) => (
          <DropdownMenuItem key={o.format} onClick={() => void run(o)}>
            {ICON[o.format]}
            {o.label ?? DEFAULT_LABEL[o.format]}
          </DropdownMenuItem>
        ))}
        {extra && (
          <>
            <DropdownMenuSeparator />
            {extra}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
