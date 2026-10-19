'use client'

/**
 * InstallPrompt — "ShiftUp'ı ana ekrana ekle" önerisi (yalnızca mobil genişlikte).
 *
 * - Android / Chromium: yakalanan `beforeinstallprompt` ile "Yükle" butonu tarayıcının kurulum
 *   penceresini açar.
 * - iOS Safari: kurulum API'si yok; Paylaş → "Ana Ekrana Ekle" adımları anlatılır. iOS'ta web
 *   bildirimleri yalnızca ana ekrana eklenmiş uygulamada çalıştığı için bu ayrıca belirtilir.
 *
 * Gösterilmez: zaten kurulu (standalone) açıldıysa, /login ve /qr-kiosk'ta, oturum yoksa ya da
 * kullanıcı son 7 gün içinde kapattıysa (bkz. src/lib/pwa/install.ts).
 */
import { useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import {
  Box,
  Button,
  IconButton,
  Paper,
  Slide,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import AddToHomeScreenIcon from '@mui/icons-material/AddToHomeScreen'
import CloseIcon from '@mui/icons-material/Close'
import IosShareIcon from '@mui/icons-material/IosShare'
import { useAuth } from '@/context/AuthContext'
import { BOTTOM_NAV_OVERLAY_OFFSET } from '@/components/layout/MobileBottomNav'
import {
  isInstallPromptHiddenPath,
  isIosSafari,
  markInstallDismissed,
  promptInstall,
  readInstallDismissed,
  useInstallPromptEvent,
  useIsStandalone,
} from '@/lib/pwa/install'
import { C } from '@/lib/palette'

const noopSubscribe = () => () => {}

export function InstallPrompt() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const pathname = usePathname()
  const { status } = useAuth()
  const isStandalone = useIsStandalone()
  const installEvent = useInstallPromptEvent()
  // Sunucuda ve hydration'da false — UA yalnızca istemcide okunur
  const iosSafari = useSyncExternalStore(
    noopSubscribe,
    () => isIosSafari(),
    () => false
  )
  // localStorage yalnızca istemcide; sunucuda "kapatılmış" sayılır → hiçbir şey render edilmez
  const [dismissed, setDismissed] = useState(() =>
    typeof window === 'undefined' ? true : readInstallDismissed()
  )

  const variant: 'android' | 'ios' | null = installEvent ? 'android' : iosSafari ? 'ios' : null
  const open =
    variant !== null &&
    isMobile &&
    !dismissed &&
    !isStandalone &&
    status === 'authenticated' &&
    !isInstallPromptHiddenPath(pathname)

  const dismiss = () => {
    markInstallDismissed()
    setDismissed(true)
  }

  const handleInstall = async () => {
    const outcome = await promptInstall()
    // Kurulum penceresini reddettiyse 7 gün tekrar sorma; kabul ettiyse olay zaten temizlendi
    if (outcome === 'dismissed') dismiss()
  }

  return (
    <Slide direction="up" in={open} mountOnEnter unmountOnExit>
      <Paper
        role="dialog"
        aria-labelledby="install-prompt-title"
        elevation={8}
        sx={{
          position: 'fixed',
          left: 'calc(12px + env(safe-area-inset-left))',
          right: 'calc(12px + env(safe-area-inset-right))',
          // Mobil alt navigasyonun ve taşan QR butonunun üstünde kalsın
          bottom: `calc(${BOTTOM_NAV_OVERLAY_OFFSET}px + env(safe-area-inset-bottom))`,
          zIndex: theme.zIndex.snackbar - 1,
          p: 2,
          bgcolor: C.surface,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Box
            component="img"
            src="/icon-192.png"
            alt=""
            sx={{ width: 40, height: 40, borderRadius: 2, flexShrink: 0 }}
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography id="install-prompt-title" variant="subtitle2">
              ShiftUp&apos;ı ana ekrana ekle
            </Typography>
            {variant === 'android' ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Tek dokunuşla açılır, tam ekran çalışır ve bildirimleri kaçırmazsınız.
              </Typography>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  iPhone&apos;da bildirim alabilmek için ShiftUp&apos;ın ana ekrana eklenmesi
                  gerekir.
                </Typography>
                <Box component="ol" sx={{ m: 0, mt: 1, pl: 2.5, typography: 'body2' }}>
                  <li>
                    Alttaki{' '}
                    <Box component="span" sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                      Paylaş{' '}
                      <IosShareIcon
                        fontSize="inherit"
                        sx={{ verticalAlign: 'text-bottom' }}
                        aria-hidden
                      />
                    </Box>{' '}
                    simgesine dokunun
                  </li>
                  <li>
                    <Box component="span" sx={{ fontWeight: 600 }}>
                      &quot;Ana Ekrana Ekle&quot;
                    </Box>{' '}
                    seçeneğini seçin
                  </li>
                </Box>
              </>
            )}
          </Box>
          <IconButton size="small" aria-label="Kapat" onClick={dismiss} sx={{ mt: -0.5, mr: -0.5 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1.5 }}>
          {variant === 'android' ? (
            <>
              <Button size="small" color="inherit" onClick={dismiss}>
                Şimdi değil
              </Button>
              <Button
                size="small"
                variant="contained"
                startIcon={<AddToHomeScreenIcon />}
                onClick={handleInstall}
              >
                Yükle
              </Button>
            </>
          ) : (
            <Button size="small" variant="outlined" onClick={dismiss}>
              Anladım
            </Button>
          )}
        </Stack>
      </Paper>
    </Slide>
  )
}
