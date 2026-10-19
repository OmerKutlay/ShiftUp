'use client'

/**
 * PushPrompt — oturum açıkken "Bildirimleri aç" önerisi (tek dokunuşla izin + abonelik).
 *
 * Tarayıcılar bildirim iznini yalnızca kullanıcı dokunuşuyla verir (iOS'ta şart), bu yüzden
 * izin otomatik alınamaz; bunun yerine kullanıcıyı ayar aratmadan karşılayan bir kart gösterilir.
 * İzin bir kez verildiyse sonraki girişlerde abonelik sessizce yenilenir (syncSubscription).
 *
 * Gösterilir: izin henüz sorulmamışsa ('default'), kurulu PWA'da (standalone) veya masaüstünde.
 * Mobil tarayıcı sekmesinde gösterilmez — orada InstallPrompt önce kurulumu önerir.
 * Gösterilmez: /login, /qr-kiosk, oturum yoksa ya da son 3 gün içinde "Şimdi değil" dendiyse.
 */
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Paper,
  Slide,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive'
import CloseIcon from '@mui/icons-material/Close'
import { useAuth } from '@/context/AuthContext'
import { C, tint } from '@/lib/palette'
import { BOTTOM_NAV_OVERLAY_OFFSET } from '@/components/layout/MobileBottomNav'
import { usePushSubscription } from '@/hooks/usePushSubscription'
import { isDismissedRecently, isInstallPromptHiddenPath, useIsStandalone } from '@/lib/pwa/install'

const DISMISS_KEY = 'shiftup.pushPrompt.dismissedAt'
const DISMISS_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000

function readDismissed(): boolean {
  try {
    return isDismissedRecently(window.localStorage.getItem(DISMISS_KEY), Date.now(), DISMISS_INTERVAL_MS)
  } catch {
    return false
  }
}

function markDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    /* depolama yoksa yalnızca bu oturum için gizlenir */
  }
}

export function PushPrompt() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const pathname = usePathname()
  const { status } = useAuth()
  const isStandalone = useIsStandalone()
  const [dismissed, setDismissed] = useState(() =>
    typeof window === 'undefined' ? true : readDismissed()
  )

  const eligible =
    status === 'authenticated' &&
    !dismissed &&
    (isStandalone || !isMobile) &&
    !isInstallPromptHiddenPath(pathname)

  // Push durumu (/api/push/config) yalnızca uygun olduğunda sorgulanır
  if (!eligible) return null
  return (
    <PushPromptCard
      onDismiss={() => {
        markDismissed()
        setDismissed(true)
      }}
    />
  )
}

function PushPromptCard({ onDismiss }: { onDismiss: () => void }) {
  const theme = useTheme()
  const { status, busy, error, enable } = usePushSubscription()
  const open = status === 'default' || (busy && status !== 'subscribed')

  return (
    <Slide direction="up" in={open} mountOnEnter unmountOnExit>
      <Paper
        role="dialog"
        aria-labelledby="push-prompt-title"
        elevation={8}
        sx={{
          position: 'fixed',
          left: 'calc(12px + env(safe-area-inset-left))',
          right: 'calc(12px + env(safe-area-inset-right))',
          // Mobil yüzen alt navigasyon kartının üstünde kalsın
          bottom: `calc(${BOTTOM_NAV_OVERLAY_OFFSET}px + env(safe-area-inset-bottom))`,
          maxWidth: 480,
          mx: 'auto',
          zIndex: theme.zIndex.snackbar - 1,
          p: 2,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: '16px',
          boxShadow: `0 8px 24px ${tint(C.ink, 0.12)}`,
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Box sx={{ color: 'primary.main', display: 'flex', mt: 0.25 }}>
            <NotificationsActiveIcon />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography id="push-prompt-title" variant="subtitle2">
              Bildirimleri aç
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {error ??
                'İzin talepleri, onaylar ve vardiya hatırlatmaları uygulama kapalıyken de telefonunuza gelsin.'}
            </Typography>
          </Box>
          <IconButton size="small" aria-label="Kapat" onClick={onDismiss} sx={{ mt: -0.5, mr: -0.5 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1.5 }}>
          <Button size="small" color="inherit" onClick={onDismiss} disabled={busy}>
            Şimdi değil
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={() => void enable()}
            disabled={busy}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            Aç
          </Button>
        </Stack>
      </Paper>
    </Slide>
  )
}
