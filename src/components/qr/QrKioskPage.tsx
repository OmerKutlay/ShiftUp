'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Box,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  Chip,
  LinearProgress,
  SelectChangeEvent,
  Stack,
  Divider,
  Paper,
} from '@mui/material'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import type { EmployeeWithRole } from '@/types/employee'
import type { QrActionType } from '@/types/qr'
import { QR_ACTION_LABELS } from '@/types/qr'
import { fetchActiveEmployees } from '@/lib/employeeRepository'
import { QrCodeDisplay } from './QrCodeDisplay'
import { formatInTimeZone } from '@/lib/dateUtils'

const QR_TTL_SECONDS = 60
const REFRESH_INTERVAL_MS = QR_TTL_SECONDS * 1000

const ACTION_COLORS: Record<QrActionType, string> = {
  clock_in: '#10b981',
  break_start: '#f59e0b',
  break_end: '#60a5fa',
  clock_out: '#818cf8',
}

export function QrKioskPage() {
  const [employees, setEmployees] = useState<EmployeeWithRole[]>([])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [selectedAction, setSelectedAction] = useState<QrActionType>('clock_in')
  const [qrData, setQrData] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<Date | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [loadingEmployees, setLoadingEmployees] = useState(true)
  const [generatingQr, setGeneratingQr] = useState(false)
  const [expired, setExpired] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Çalışanları yükle
  useEffect(() => {
    fetchActiveEmployees()
      .then(setEmployees)
      .catch(() => setError('Çalışanlar yüklenemedi.'))
      .finally(() => setLoadingEmployees(false))
  }, [])

  const clearTimers = () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
  }

  // generateQrRef: auto-refresh için döngüsel ref problemi önler
  const generateQrRef = useRef<((employeeId: string, action: QrActionType) => Promise<void>) | undefined>(undefined)

  const generateQr = useCallback(async (employeeId: string, action: QrActionType) => {
    if (!employeeId) return
    clearTimers()
    setGeneratingQr(true)
    setExpired(false)
    setError(null)

    try {
      const res = await fetch('/api/qr/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          action_type: action,
          ttl_seconds: QR_TTL_SECONDS,
        }),
      })

      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error ?? 'QR üretilemedi.')
      }

      const data = await res.json() as { qr_data: string; expires_at: string }
      setQrData(data.qr_data)
      const exp = new Date(data.expires_at)
      setExpiresAt(exp)
      setSecondsLeft(QR_TTL_SECONDS)

      // Countdown
      countdownRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            clearInterval(countdownRef.current!)
            return 0
          }
          return s - 1
        })
      }, 1000)

      // Süresi dolunca expired göster + otomatik yenile (ref üzerinden çağır)
      refreshTimerRef.current = setTimeout(() => {
        setExpired(true)
        setTimeout(() => generateQrRef.current?.(employeeId, action), 1500)
      }, REFRESH_INTERVAL_MS)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'QR üretilemedi.')
    } finally {
      setGeneratingQr(false)
    }
  }, [])

  // generateQr'ı ref'e ata — effect içinde güvenli güncelleme
  useEffect(() => {
    generateQrRef.current = generateQr
  }, [generateQr])

  // Seçim değişince yeni QR üret
  useEffect(() => {
    if (selectedEmployeeId) {
      void generateQr(selectedEmployeeId, selectedAction) // eslint-disable-line react-hooks/set-state-in-effect
    }
    return clearTimers
  }, [selectedEmployeeId, selectedAction, generateQr])

  const handleEmployeeChange = (e: SelectChangeEvent<string>) => {
    setSelectedEmployeeId(e.target.value)
  }

  const handleActionChange = (e: SelectChangeEvent<string>) => {
    setSelectedAction(e.target.value as QrActionType)
  }

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId)
  const progressValue = (secondsLeft / QR_TTL_SECONDS) * 100
  const actionColor = ACTION_COLORS[selectedAction]

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: '#0f172a',
        color: 'text.primary',
        p: { xs: 2, md: 4 },
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {/* Header */}
      <Box sx={{ mb: 4, textAlign: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 0.5 }}>
          <QrCode2Icon sx={{ fontSize: 22, color: 'primary.main' }} />
          <Typography variant="overline" color="primary.main" fontWeight={700} letterSpacing={1.5}>
            QR Kiosk
          </Typography>
        </Box>
        <Typography variant="h5" fontWeight={800}>
          Dinamik QR Kod
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Çalışan ve işlem tipini seçin — QR otomatik yenilenir
        </Typography>
      </Box>

      <Paper
        elevation={0}
        sx={{
          p: { xs: 2.5, md: 4 },
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 3,
          bgcolor: 'background.paper',
          width: '100%',
          maxWidth: 480,
        }}
      >
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Seçimler */}
        <Stack spacing={2.5} sx={{ mb: 3 }}>
          <FormControl fullWidth disabled={loadingEmployees}>
            <InputLabel id="employee-label">Çalışan</InputLabel>
            <Select
              labelId="employee-label"
              value={selectedEmployeeId}
              label="Çalışan"
              onChange={handleEmployeeChange}
            >
              {employees.map((e) => (
                <MenuItem key={e.id} value={e.id}>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{e.full_name}</Typography>
                    <Typography variant="caption" color="text.secondary">{e.role}</Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel id="action-label">İşlem Tipi</InputLabel>
            <Select
              labelId="action-label"
              value={selectedAction}
              label="İşlem Tipi"
              onChange={handleActionChange}
            >
              {(Object.entries(QR_ACTION_LABELS) as [QrActionType, string][]).map(([key, label]) => (
                <MenuItem key={key} value={key}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: ACTION_COLORS[key],
                      }}
                    />
                    {label}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        <Divider sx={{ mb: 3, borderColor: 'rgba(255,255,255,0.08)' }} />

        {/* QR Alanı */}
        {!selectedEmployeeId ? (
          <Box
            sx={{
              height: 260,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'rgba(255,255,255,0.03)',
              borderRadius: 2,
              border: '1px dashed',
              borderColor: 'divider',
            }}
          >
            <Typography variant="body2" color="text.disabled">
              Çalışan seçildiğinde QR oluşturulur
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            {/* İşlem etiketi */}
            <Chip
              label={QR_ACTION_LABELS[selectedAction]}
              sx={{
                bgcolor: `${actionColor}20`,
                color: actionColor,
                borderColor: `${actionColor}50`,
                border: '1px solid',
                fontWeight: 700,
                fontSize: '0.8rem',
              }}
            />

            {/* QR kod */}
            <QrCodeDisplay
              data={qrData ?? ''}
              size={240}
              loading={generatingQr}
              expired={expired}
            />

            {/* Çalışan adı */}
            {selectedEmployee && (
              <Typography variant="subtitle2" fontWeight={700} color="text.primary">
                {selectedEmployee.full_name}
              </Typography>
            )}

            {/* Süre göstergesi */}
            {!expired && !generatingQr && qrData && (
              <Box sx={{ width: '100%' }}>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    mb: 0.5,
                    alignItems: 'center',
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Geçerlilik süresi
                  </Typography>
                  <Typography
                    variant="caption"
                    fontWeight={700}
                    color={secondsLeft <= 10 ? 'error.main' : 'text.secondary'}
                  >
                    {secondsLeft}s
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={progressValue}
                  sx={{
                    height: 4,
                    borderRadius: 2,
                    bgcolor: 'rgba(255,255,255,0.08)',
                    '& .MuiLinearProgress-bar': {
                      bgcolor: secondsLeft <= 10 ? 'error.main' : actionColor,
                      borderRadius: 2,
                    },
                  }}
                />
              </Box>
            )}

            {/* Son yenilenme zamanı */}
            {expiresAt && !generatingQr && (
              <Typography variant="caption" color="text.disabled">
                Son yenilenme: {formatInTimeZone(new Date(expiresAt.getTime() - QR_TTL_SECONDS * 1000).toISOString())}
              </Typography>
            )}
          </Box>
        )}
      </Paper>
    </Box>
  )
}
