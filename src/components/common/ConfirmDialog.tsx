'use client'

/**
 * ConfirmProvider / useConfirm — window.confirm yerine uygulama temasına uygun onay diyaloğu.
 *
 *   const confirm = useConfirm()
 *   if (!(await confirm({ title: 'Silinsin mi?', message: '…', confirmText: 'Sil', tone: 'error' }))) return
 */
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { TriangleAlert } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ConfirmOptions {
  title: React.ReactNode
  message?: React.ReactNode
  /** Madde madde gösterilecek liste (ör. kural ihlalleri) */
  items?: string[]
  /** Listenin altındaki soru / ek açıklama */
  footer?: React.ReactNode
  confirmText?: string
  cancelText?: string
  tone?: 'warning' | 'error'
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const [open, setOpen] = useState(false)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    // Önceki diyalog açıksa iptal sayılır
    resolver.current?.(false)
    setOptions(opts)
    setOpen(true)
    return new Promise<boolean>((resolve) => { resolver.current = resolve })
  }, [])

  const close = (value: boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setOpen(false)
  }

  const isError = (options?.tone ?? 'warning') === 'error'

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={open} onOpenChange={(next) => { if (!next) close(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader className="flex-row items-start gap-3">
            <span
              aria-hidden
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-full',
                isError ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'
              )}
            >
              <TriangleAlert className="size-5" />
            </span>
            <div className="flex min-w-0 flex-col gap-1.5 pt-1">
              <AlertDialogTitle className="leading-snug">{options?.title}</AlertDialogTitle>
              {options?.message ? (
                <AlertDialogDescription>{options.message}</AlertDialogDescription>
              ) : (
                <AlertDialogDescription className="sr-only">Onay gerekiyor</AlertDialogDescription>
              )}
            </div>
          </AlertDialogHeader>

          {options?.items && options.items.length > 0 && (
            <ul
              className={cn(
                'max-h-60 list-disc space-y-1 overflow-y-auto rounded-xl py-2.5 pr-3 pl-7 text-sm text-ink',
                isError ? 'bg-danger-soft' : 'bg-warning-soft'
              )}
            >
              {options.items.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          )}
          {options?.footer && <p className="text-sm text-ink-secondary">{options.footer}</p>}

          <AlertDialogFooter>
            <AlertDialogCancel className="border-transparent bg-transparent" onClick={() => close(false)}>
              {options?.cancelText ?? 'İptal'}
            </AlertDialogCancel>
            <AlertDialogAction
              autoFocus
              className={buttonVariants({ variant: isError ? 'destructive' : 'default' })}
              onClick={() => close(true)}
            >
              {options?.confirmText ?? 'Devam Et'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm, ConfirmProvider içinde kullanılmalı')
  return ctx
}
