'use client'

/**
 * PushPermissionCard — bu cihazda push bildirimlerini açma/kapatma.
 *
 * Açıklamalı kart (Bildirimler sayfasının üstü, Ayarlar › Bildirimler).
 *
 * Durumlar: desteklenmiyor / iOS'ta ana ekrana ekleme gerekli / izin sorulmadı /
 * açık (abone) / izin verilmiş ama abone değil / reddedilmiş (ayarlardan açma yönergesi).
 */
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material'
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive'
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff'
import IosShareIcon from '@mui/icons-material/IosShare'
import { usePushSubscription, type PushStatus } from '@/hooks/usePushSubscription'
import { isIos } from '@/lib/pwa/push'

interface Props {
  /** Abonelik açıkken kartı tamamen gizle */
  hideWhenSubscribed?: boolean
}

function deniedHelp(): string {
  if (isIos()) return 'Ayarlar › Bildirimler › ShiftUp bölümünden bildirimlere izin verin.'
  return 'Tarayıcının adres çubuğundaki site ayarlarından (kilit simgesi) Bildirimler iznini "İzin ver" yapın, ardından sayfayı yenileyin.'
}

function statusText(status: PushStatus): string {
  switch (status) {
    case 'subscribed':
      return 'Bu cihazda bildirimler açık.'
    case 'granted':
    case 'default':
      return 'Vardiya hatırlatmaları ve talep onayları anında telefonunuza gelsin.'
    case 'denied':
      return `Bildirim izni engellenmiş. ${deniedHelp()}`
    case 'ios-needs-install':
      return 'iPhone/iPad’de bildirimler için ShiftUp’ı ana ekrana ekleyin: Paylaş › Ana Ekrana Ekle, ardından uygulamayı ana ekrandan açın.'
    case 'ios-too-old':
      return 'Bildirimler için iOS 16.4 veya üzeri gerekir.'
    case 'disabled':
      return 'Anlık bildirimler henüz yapılandırılmadı.'
    case 'unsupported':
      return 'Bu tarayıcı anlık bildirimleri desteklemiyor.'
    default:
      return ''
  }
}

export function PushPermissionCard({ hideWhenSubscribed = false }: Props) {
  const { status, busy, error, enable, disable } = usePushSubscription()

  if (status === 'loading') return null
  // Sunucu yapılandırılmamışsa kullanıcıya gösterilecek bir eylem yok
  if (status === 'disabled') return null

  const canEnable = status === 'default' || status === 'granted'
  const isOn = status === 'subscribed'

  if (isOn && hideWhenSubscribed) return null

  const icon =
    status === 'ios-needs-install' ? (
      <IosShareIcon />
    ) : isOn || canEnable ? (
      <NotificationsActiveIcon />
    ) : (
      <NotificationsOffIcon />
    )

  return (
    <Paper
      sx={{
        mb: 2,
        p: 2,
        display: 'flex',
        alignItems: { xs: 'flex-start', sm: 'center' },
        flexDirection: { xs: 'column', sm: 'row' },
        gap: 1.5,
        bgcolor: isOn ? 'rgba(16,185,129,0.08)' : 'rgba(20,184,166,0.08)',
        border: '1px solid',
        borderColor: isOn ? 'rgba(16,185,129,0.3)' : 'rgba(20,184,166,0.3)',
        borderRadius: 2,
      }}
    >
      <Box sx={{ display: 'flex', gap: 1.5, flex: 1, minWidth: 0 }}>
        <Box sx={{ color: isOn ? 'success.main' : 'primary.main', display: 'flex', mt: 0.25 }}>{icon}</Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            {isOn ? 'Bildirimler açık' : 'Vardiya hatırlatmaları ve onaylar için bildirimleri aç'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {statusText(status)}
          </Typography>
          {error && (
            <Alert severity="warning" sx={{ mt: 1, py: 0 }}>
              {error}
            </Alert>
          )}
        </Box>
      </Box>
      {canEnable && (
        <Button
          variant="contained"
          size="small"
          onClick={() => void enable()}
          disabled={busy}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
          sx={{ flexShrink: 0, alignSelf: { xs: 'stretch', sm: 'center' } }}
        >
          Aç
        </Button>
      )}
      {isOn && (
        <Button
          variant="text"
          size="small"
          onClick={() => void disable()}
          disabled={busy}
          sx={{ flexShrink: 0, color: 'text.secondary' }}
        >
          Kapat
        </Button>
      )}
    </Paper>
  )
}
