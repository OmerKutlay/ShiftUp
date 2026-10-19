'use client'

/**
 * PushDiagnosticsPanel — anlık bildirim zincirinin adım adım teşhisi (Mağaza Müdürü+).
 *
 * GET /api/push/diagnostics'in `steps` listesini ✓ / ✗ / ? simgeleriyle gösterir; ilk
 * başarısız adımın ipucu ne yapılacağını söyler (çoğunlukla scripts/setup-push.sh).
 * Bu cihazın aboneliği sunucuda kayıtlı mı diye kontrol için endpoint de gönderilir.
 *
 * collapsible: başlığa tıklanınca açılır ve ancak o zaman yüklenir (varsayılan: hep açık).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, Collapse, List, ListItem, ListItemIcon, ListItemText, Paper, Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import RefreshIcon from '@mui/icons-material/Refresh'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { apiFetch } from '@/lib/api/http'
import { getCurrentSubscription } from '@/lib/pwa/push'
import type { PushDiagnosticStep } from '@/lib/pushDiagnostics'

interface DiagnosticsResponse {
  steps: PushDiagnosticStep[]
}

interface Props {
  collapsible?: boolean
}

/** Teşhis isteği; bu cihazın endpoint'i (destek yoksa / abone değilse) gönderilmez */
async function fetchDiagnostics(): Promise<{ steps: PushDiagnosticStep[] } | { error: string }> {
  try {
    const sub = await getCurrentSubscription().catch(() => null)
    const qs = sub?.endpoint ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ''
    const res = await apiFetch<DiagnosticsResponse>(`/api/push/diagnostics${qs}`)
    return { steps: res.steps }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Teşhis bilgisi alınamadı.' }
  }
}

function StepIcon({ ok }: { ok: boolean | null }) {
  if (ok === true) return <CheckCircleIcon fontSize="small" sx={{ color: 'success.main' }} aria-label="Tamam" />
  if (ok === false) return <CancelIcon fontSize="small" sx={{ color: 'error.main' }} aria-label="Sorun" />
  return <HelpOutlineIcon fontSize="small" sx={{ color: 'text.disabled' }} aria-label="Bilinmiyor" />
}

export function PushDiagnosticsPanel({ collapsible = false }: Props) {
  const [open, setOpen] = useState(!collapsible)
  const [steps, setSteps] = useState<PushDiagnosticStep[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    // Hata önceden temizlenmez: aksi halde ilk yükleme efekti de tetiklenirdi
    setLoading(true)
    const result = await fetchDiagnostics()
    if ('steps' in result) {
      setSteps(result.steps)
      setError(null)
    } else setError(result.error)
    setLoading(false)
  }, [])

  // İlk açılışta bir kez yükle; sonrası "Yenile" ile
  const shouldLoad = open && steps === null && error === null
  useEffect(() => {
    if (!shouldLoad) return
    let cancelled = false
    void fetchDiagnostics().then((result) => {
      if (cancelled) return
      if ('steps' in result) setSteps(result.steps)
      else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [shouldLoad])

  const firstFailure = steps?.find((s) => s.ok === false)

  return (
    <Paper variant="outlined" sx={{ borderColor: 'divider', overflow: 'hidden' }}>
      <Box
        component={collapsible ? 'button' : 'div'}
        type={collapsible ? 'button' : undefined}
        onClick={collapsible ? () => setOpen((v) => !v) : undefined}
        aria-expanded={collapsible ? open : undefined}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, width: '100%', px: 2, py: 1.25,
          bgcolor: 'transparent', border: 0, color: 'inherit', textAlign: 'left', font: 'inherit',
          cursor: collapsible ? 'pointer' : 'default',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600}>
            Bildirim teşhisi
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Bildirimler telefona gelmiyorsa hangi adımın eksik olduğunu gösterir.
          </Typography>
        </Box>
        {collapsible && (
          <ExpandMoreIcon sx={{ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' }} />
        )}
      </Box>

      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 2, pb: 2 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {error}
            </Alert>
          )}
          {(shouldLoad || (loading && !steps)) && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          {steps && (
            <List dense disablePadding>
              {steps.map((s) => (
                <ListItem key={s.key} disableGutters alignItems="flex-start">
                  <ListItemIcon sx={{ minWidth: 32, mt: 0.5 }}>
                    <StepIcon ok={s.ok} />
                  </ListItemIcon>
                  <ListItemText
                    primary={s.label}
                    secondary={s.hint}
                    primaryTypographyProps={{ variant: 'body2', fontWeight: s === firstFailure ? 700 : 500 }}
                    secondaryTypographyProps={{
                      variant: 'caption',
                      color: s.ok === false ? 'warning.light' : 'text.secondary',
                    }}
                  />
                </ListItem>
              ))}
            </List>
          )}
          {steps && steps.every((s) => s.ok === true) && (
            <Alert severity="success" sx={{ mt: 1, py: 0 }}>
              Sunucu tarafında eksik görünmüyor. Bildirim gelmiyorsa telefonun bildirim ayarlarını ve pil tasarrufunu kontrol edin.
            </Alert>
          )}
          <Button
            size="small"
            startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <RefreshIcon fontSize="small" />}
            onClick={() => void load()}
            disabled={loading}
            sx={{ mt: 1 }}
          >
            Yenile
          </Button>
        </Box>
      </Collapse>
    </Paper>
  )
}
