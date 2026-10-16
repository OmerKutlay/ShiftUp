'use client'

/**
 * ConfirmProvider / useConfirm — window.confirm yerine uygulama temasına uygun onay diyaloğu.
 *
 *   const confirm = useConfirm()
 *   if (!(await confirm({ title: 'Silinsin mi?', message: '…', confirmText: 'Sil', tone: 'error' }))) return
 */
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  alpha,
} from '@mui/material'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'

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

  const tone = options?.tone ?? 'warning'

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={open}
        onClose={() => close(false)}
        maxWidth="xs"
        fullWidth
        aria-labelledby="confirm-dialog-title"
      >
        <DialogTitle id="confirm-dialog-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700 }}>
          <WarningAmberIcon sx={{ color: `${tone}.main` }} />
          {options?.title}
        </DialogTitle>
        <DialogContent>
          {options?.message && <DialogContentText>{options.message}</DialogContentText>}
          {options?.items && options.items.length > 0 && (
            <Box
              component="ul"
              sx={{
                mt: options.message ? 1.5 : 0,
                mb: 0,
                pl: 2.5,
                pr: 1.5,
                py: 1,
                bgcolor: (t) => alpha(t.palette[tone].main, 0.08),
                border: 1,
                borderColor: `${tone}.light`,
                borderRadius: 1,
                maxHeight: 240,
                overflowY: 'auto',
                typography: 'body2',
                color: 'text.primary',
                '& li + li': { mt: 0.5 },
              }}
            >
              {options.items.map((item, i) => <li key={i}>{item}</li>)}
            </Box>
          )}
          {options?.footer && <DialogContentText sx={{ mt: 1.5 }}>{options.footer}</DialogContentText>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={() => close(false)} color="inherit">
            {options?.cancelText ?? 'İptal'}
          </Button>
          <Button variant="contained" color={tone} onClick={() => close(true)} autoFocus>
            {options?.confirmText ?? 'Devam Et'}
          </Button>
        </DialogActions>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm, ConfirmProvider içinde kullanılmalı')
  return ctx
}
