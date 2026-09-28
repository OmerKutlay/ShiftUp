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
  CircularProgress,
  Chip,
  Divider,
  Stack,
  SelectChangeEvent,
  Alert,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import LocationOffIcon from '@mui/icons-material/LocationOff'
import PersonIcon from '@mui/icons-material/Person'
import type { EmployeeWithRole } from '@/types/employee'
import type { ProcessQrResponse } from '@/types/qr'
import { QR_ACTION_LABELS } from '@/types/qr'
import type { GpsCoordinates } from '@/types/location'
import { fetchActiveEmployees } from '@/lib/employeeRepository'
import { QrScanner } from './QrScanner'

type ScanState = 'idle' | 'getting_location' | 'processing' | 'success' | 'error'

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

// GPS koordinatlarını al
function getCurrentPosition(): Promise<GpsCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Tarayıcınız konum özelliğini desteklemiyor.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        })
      },
      (err) => {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            reject(new Error('Konum izni reddedildi. Attendance için konum erişimine izin vermelisin.'))
            break
          case err.POSITION_UNAVAILABLE:
            reject(new Error('GPS bilgisi alınamadı. Lütfen tekrar dene.'))
            break
          case err.TIMEOUT:
            reject(new Error('Konum alınırken zaman aşımı oluştu. Lütfen tekrar dene.'))
            break
          default:
            reject(new Error('Konum alınamadı.'))
        }
      },
      { timeout: 10000, maximumAge: 30000, enableHighAccuracy: true }
    )
  })
}

export function AttendanceScanPage() {
  const [employees, setEmployees] = useState<EmployeeWithRole[]>([])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [loadingEmployees, setLoadingEmployees] = useState(true)

  const [scanState, setScanState] = useState<ScanState>('idle')
  const [result, setResult] = useState<ProcessQrResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [scannerActive, setScannerActive] = useState(true)
  const [locationStatus, setLocationStatus] = useState<string | null>(null)

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
      if (scanState !== 'idle') return

      setScannerActive(false)
      setResult(null)
      setErrorMsg(null)

      // Konum alma
      setScanState('getting_location')
      setLocationStatus('Konum doğrulanıyor...')

      let location: GpsCoordinates | undefined
      try {
        location = await getCurrentPosition()
        setLocationStatus(`Konum alındı (±${Math.round(location.accuracy)}m)`)
      } catch (locErr) {
        const msg = locErr instanceof Error ? locErr.message : 'Konum alınamadı.'
        setErrorMsg(msg)
        setLocationStatus(null)
        setScanState('error')
        setTimeout(() => {
          setScanState('idle')
          setErrorMsg(null)
          setLocationStatus(null)
          setScannerActive(true)
        }, 4000)
        return
      }

      setScanState('processing')

      try {
        const res = await fetch('/api/qr/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            qr_data: qrData,
            employee_id: selectedEmployeeId,
            location,
          }),
        })

        const data = await res.json() as ProcessQrResponse & { error?: string }

        if (!res.ok || !data.success) {
          throw new Error(data.error ?? 'İşlem gerçekleştirilemedi.')
        }

        setResult(data)
        setScanState('success')
        setLocationStatus(null)

        setTimeout(() => {
          setScanState('idle')
          setResult(null)
          setLocationStatus(null)
          setScannerActive(true)
        }, 4000)
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Bilinmeyen hata.')
        setScanState('error')
        setLocationStatus(null)
        setTimeout(() => {
          setScanState('idle')
          setErrorMsg(null)
          setScannerActive(true)
        }, 3500)
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
            <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
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

        <Stack spacing={2} alignItems="center">
          {/* İşlem durumu */}
          {scanState === 'idle' && (
            <>
              {!selectedEmployeeId ? (
                <Alert severity="info" sx={{ width: '100%' }}>
                  Taramaya başlamak için çalışan seçin.
                </Alert>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                  <LocationOnIcon sx={{ fontSize: 14, color: 'primary.main' }} />
                  <Typography variant="caption" color="text.secondary">
                    Konum doğrulaması aktif — QR tarandıktan sonra konum alınır
                  </Typography>
                </Box>
              )}
            </>
          )}

          {scanState === 'getting_location' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 2 }}>
              <CircularProgress color="primary" size={40} />
              <Typography variant="subtitle2" fontWeight={600}>
                {locationStatus ?? 'Konum alınıyor...'}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <LocationOnIcon sx={{ fontSize: 14, color: 'primary.main' }} />
                <Typography variant="caption" color="text.secondary">
                  GPS konum izni istenebilir
                </Typography>
              </Box>
            </Box>
          )}

          {scanState === 'processing' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 2 }}>
              <CircularProgress color="primary" size={48} />
              <Typography variant="subtitle2" fontWeight={600}>İşleniyor...</Typography>
              {locationStatus && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <LocationOnIcon sx={{ fontSize: 13, color: '#10b981' }} />
                  <Typography variant="caption" color="text.secondary">{locationStatus}</Typography>
                </Box>
              )}
            </Box>
          )}

          {scanState === 'success' && result && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 1, width: '100%' }}>
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
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <LocationOnIcon sx={{ fontSize: 13, color: '#10b981' }} />
                <Typography variant="caption" color="text.disabled">
                  {QR_ACTION_LABELS[result.action_type]} — {result.timestamp}
                </Typography>
              </Box>
            </Box>
          )}

          {scanState === 'error' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 1, width: '100%' }}>
              {errorMsg?.toLowerCase().includes('konum') || errorMsg?.toLowerCase().includes('location') ? (
                <LocationOffIcon sx={{ fontSize: 48, color: 'error.main' }} />
              ) : (
                <ErrorOutlineIcon sx={{ fontSize: 48, color: 'error.main' }} />
              )}
              <Typography variant="subtitle2" fontWeight={700} color="error.main" textAlign="center">
                {errorMsg ?? 'İşlem başarısız.'}
              </Typography>
              <Typography variant="caption" color="text.disabled">
                Birkaç saniye içinde tekrar denenecek...
              </Typography>
            </Box>
          )}

          {/* QR Scanner */}
          {selectedEmployeeId && (scanState === 'idle') && (
            <Box sx={{ mt: 1 }}>
              <QrScanner
                onScan={handleScan}
                onError={(e) => setErrorMsg(e)}
                active={scannerActive}
              />
            </Box>
          )}
        </Stack>
      </Paper>
    </Box>
  )
}
