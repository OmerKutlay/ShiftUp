'use client'

/**
 * ServiceWorkerUpdater — SW kaydı + "Yeni sürüm hazır" uyarısı.
 *
 * Yeni SW kendiliğinden etkinleşmez (açık formlar/kamera sürüm ortasında bozulmasın); kullanıcı
 * "Güncelle"ye basınca bekleyen SW etkinleşir ve sayfa bir kez yenilenir.
 * Kayıt/dev davranışı: src/lib/pwa/registerServiceWorker.ts
 */
import { useEffect, useState } from 'react'
import { Button, CircularProgress, IconButton, Snackbar } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { applyUpdate, registerServiceWorker } from '@/lib/pwa/registerServiceWorker'
import { BOTTOM_NAV_OVERLAY_OFFSET } from '@/components/layout/MobileBottomNav'

interface Props {
  /** Uyarı görünürlüğü değişince (PwaLayer diğer alt kartları bu sırada gizler) */
  onVisibleChange?: (visible: boolean) => void
}

export function ServiceWorkerUpdater({ onVisibleChange }: Props) {
  const [waitingReg, setWaitingReg] = useState<ServiceWorkerRegistration | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [updating, setUpdating] = useState(false)

  useEffect(() => registerServiceWorker({ onUpdateReady: setWaitingReg }), [])

  const open = !!waitingReg && !dismissed

  useEffect(() => {
    onVisibleChange?.(open)
  }, [open, onVisibleChange])

  const handleUpdate = () => {
    if (!waitingReg) return
    setUpdating(true)
    applyUpdate(waitingReg)
  }

  return (
    <Snackbar
      open={open}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      message="Yeni sürüm hazır"
      // Mobilde alt navigasyonun ve taşan QR butonunun üstünde kalsın
      sx={{ bottom: { xs: `calc(${BOTTOM_NAV_OVERLAY_OFFSET}px + env(safe-area-inset-bottom))`, md: 24 } }}
      action={
        <>
          <Button
            color="primary"
            size="small"
            onClick={handleUpdate}
            disabled={updating}
            startIcon={updating ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            Güncelle
          </Button>
          <IconButton
            size="small"
            aria-label="Kapat"
            color="inherit"
            onClick={() => setDismissed(true)}
            disabled={updating}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </>
      }
    />
  )
}
