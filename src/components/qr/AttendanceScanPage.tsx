'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  Box,
  Typography,
  Paper,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  CircularProgress,
  Chip,
  Divider,
  Stack,
  SelectChangeEvent,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import PersonIcon from '@mui/icons-material/Person'
import type { EmployeeWithRole } from '@/types/employee'
import type { ProcessQrResponse } from '@/types/qr'
import { QR_ACTION_LABELS } from '@/types/qr'
import { fetchActiveEmployees } from '@/lib/employeeRepository'
import { QrScanner } from './QrScanner'

type ScanState = 'idle' | 'processing' | 'success' | 'error'

const ATTENDANCE_STATUS_TR: Record<string, string> = {
  shift_waiting: 'Vardiya Bekleniyor',
  working: 'Çalışıyor',
  on_break: 'Molada',
  working_after_break: 'Çalışıyor (moladan döndü)',
  clocked_out: 'Çıkış Yaptı',
}

const STATUS_COLORS: Record<string, string> = {
  working: '#10b981',
  on_break: '#f59e0b',
  working_after_break: '#10b981',
  clocked_out: '#818cf8',
}

export function AttendanceScanPage() {
  const [employees, setEmployees] = useState<EmployeeWithRole[]>([])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [loadingEmployees, setLoadingEmployees] = useState(true)

  const [scanState, setScanState] = useState<ScanState>('idle')
  const [result, setResult] = useState<ProcessQrResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [scannerActive, setScannerActive] = useState(true)

  // Çalışanları yükle
  useEffect(() => {
    fetchActiveEmployees()
      .then(setEmployees)
      .catch(() => setErrorMsg('Çalışanlar yüklenemedi.'))
      .finally(() => setLoadingEmployees(false))
  }, [])

  const handleScan = useCallback(
    async (qrData: string) => {
      if (!selectedEmployeeId) {
        setErrorMsg('Lütfen önce çalışanı seçin.')
        return
      }
      if (scanState === 'processing') return

      // Tarayıcıyı durdur
      setScannerActive(false)
      setScanState('processing')
      setResult(null)
      setErrorMsg(null)

      try {
        const res = await fetch('/api/qr/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qr_data: qrData, employee_id: selectedEmployeeId }),
        })

        const data = await res.json() as ProcessQrResponse & { error?: string }

        if (!res.ok || !data.success) {
          throw new Error(data.error ?? 'İşlem gerçekleştirilemedi.')
        }

        setResult(data)
        setScanState('success')

        // 4 saniye sonra tekrar taramaya hazır
        setTimeout(() => {
          setScanState('idle')
          setResult(null)
          setScannerActive(true)
        }, 4000)
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Bilinmeyen hata.')
        setScanState('error')
        // 3 saniye sonra tekrar dene
        setTimeout(() => {
          setScanState('idle')
          setErrorMsg(null)
          setScannerActive(true)
        }, 3000)
      }
    },
    [selectedEmployeeId, scanState]
  )

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId)
  const statusColor = result ? STATUS_COLORS[result.new_status] ?? '#94a3b8' : '#94a3b8'

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
      <Box sx={{ mb: 3, textAlign: 'center' }}>
        <Typography variant="overline" color="primary.main" fontWeight={700} letterSpacing={1.5}>
          Attendance
        </Typography>
        <Typography variant="h5" fontWeight={800}>
          QR ile Devam Takibi
        </Typography>
        <Typography variant="body2" color="text.secondary" mt={0.5}>
          Çalışanı seçin ve QR kodu taratın
        </Typography>
      </Box>

      <Paper
        elevation={0}
        sx={{
          p: { xs: 2.5, md: 3 },
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 3,
          bgcolor: 'background.paper',
          width: '100%',
          maxWidth: 440,
        }}
      >
        {/* Çalışan seçimi */}
        <FormControl fullWidth disabled={loadingEmployees} sx={{ mb: 3 }}>
          <InputLabel id="scan-employee-label">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <PersonIcon sx={{ fontSize: 16 }} /> Çalışan
            </Box>
          </InputLabel>
          <Select
            labelId="scan-employee-label"
            value={selectedEmployeeId}
            label="Çalışan"
            onChange={(e: SelectChangeEvent<string>) => setSelectedEmployeeId(e.target.value)}
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

        <Divider sx={{ mb: 3, borderColor: 'rgba(255,255,255,0.08)' }} />

        {/* İçerik alanı */}
        <Stack spacing={2} alignItems="center">
          {/* İşlem durumu */}
          {scanState === 'idle' && (
            <>
              {!selectedEmployeeId ? (
                <Alert severity="info" sx={{ width: '100%' }}>
                  Taramaya başlamak için çalışan seçin.
                </Alert>
              ) : (
                <Typography variant="caption" color="text.secondary" textAlign="center">
                  QR kodu kameranın önüne tutun
                </Typography>
              )}
            </>
          )}

          {scanState === 'processing' && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1.5,
                py: 2,
              }}
            >
              <CircularProgress color="primary" size={48} />
              <Typography variant="subtitle2" fontWeight={600}>
                İşleniyor...
              </Typography>
            </Box>
          )}

          {scanState === 'success' && result && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1.5,
                py: 1,
                width: '100%',
              }}
            >
              <CheckCircleIcon sx={{ fontSize: 56, color: '#10b981' }} />
              <Typography variant="h6" fontWeight={800} color="#10b981" textAlign="center">
                {result.message}
              </Typography>
              {selectedEmployee && (
                <Typography variant="subtitle2" color="text.primary">
                  {selectedEmployee.full_name}
                </Typography>
              )}
              <Chip
                label={ATTENDANCE_STATUS_TR[result.new_status] ?? result.new_status}
                sx={{
                  bgcolor: `${statusColor}20`,
                  color: statusColor,
                  borderColor: `${statusColor}40`,
                  border: '1px solid',
                  fontWeight: 700,
                }}
              />
              <Typography variant="caption" color="text.disabled">
                {QR_ACTION_LABELS[result.action_type]} — {result.timestamp}
              </Typography>
            </Box>
          )}

          {scanState === 'error' && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1.5,
                py: 1,
                width: '100%',
              }}
            >
              <ErrorOutlineIcon sx={{ fontSize: 48, color: 'error.main' }} />
              <Typography variant="subtitle2" fontWeight={700} color="error.main" textAlign="center">
                {errorMsg ?? 'İşlem başarısız.'}
              </Typography>
              <Typography variant="caption" color="text.disabled">
                Birkaç saniye içinde tekrar denenecek...
              </Typography>
            </Box>
          )}

          {/* QR Scanner — sadece idle'da aktif */}
          {selectedEmployeeId && scanState !== 'processing' && (
            <Box sx={{ mt: scanState === 'idle' ? 1 : 2 }}>
              <QrScanner
                onScan={handleScan}
                onError={(e) => setErrorMsg(e)}
                active={scannerActive && scanState === 'idle'}
              />
            </Box>
          )}
        </Stack>
      </Paper>
    </Box>
  )
}
