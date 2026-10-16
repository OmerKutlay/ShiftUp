'use client'

/**
 * PushTestButton — "Test bildirimi gönder": POST /api/push/test ile kendine bildirim ekler.
 * Bildirim normal yoldan (tetikleyici → send-push) gider; telefonun bildirim panelinde
 * görünmüyorsa yönetici PushDiagnosticsPanel ile eksik adımı bulur.
 */
import { useState } from 'react'
import { Alert, Box, Button, CircularProgress } from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import { apiFetch } from '@/lib/api/http'

const SUCCESS_TEXT =
  'Gönderildi — birkaç saniye içinde bildirim panelinde görünmeli. Uygulamayı arka plana alın.'

export function PushTestButton() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const send = async () => {
    setBusy(true)
    setResult(null)
    try {
      await apiFetch('/api/push/test', { method: 'POST', body: {} })
      setResult({ ok: true, text: SUCCESS_TEXT })
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'Test bildirimi gönderilemedi.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ mt: 1 }}>
      <Button
        size="small"
        variant="outlined"
        onClick={() => void send()}
        disabled={busy}
        startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <SendIcon fontSize="small" />}
      >
        Test bildirimi gönder
      </Button>
      {result && (
        <Alert
          severity={result.ok ? 'success' : 'error'}
          onClose={() => setResult(null)}
          sx={{ mt: 1, py: 0 }}
        >
          {result.text}
        </Alert>
      )}
    </Box>
  )
}
