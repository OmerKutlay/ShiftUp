'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Typography,
  Paper,
  Button,
  Stack,
  TextField,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
  Divider,
  Chip,
} from '@mui/material'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import SaveIcon from '@mui/icons-material/Save'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import type { StoreLocation } from '@/types/location'

interface StoreLocationForm {
  id?: string
  name: string
  latitude: string
  longitude: string
  allowed_radius_meters: string
  max_accuracy_meters: string
  active: boolean
}

const DEFAULT_FORM: StoreLocationForm = {
  name: '',
  latitude: '',
  longitude: '',
  allowed_radius_meters: '150',
  max_accuracy_meters: '50',
  active: true,
}

function locationToForm(loc: StoreLocation): StoreLocationForm {
  return {
    id: loc.id,
    name: loc.name,
    latitude: String(loc.latitude),
    longitude: String(loc.longitude),
    allowed_radius_meters: String(loc.allowed_radius_meters),
    max_accuracy_meters: String(loc.max_accuracy_meters),
    active: loc.active,
  }
}

export function StoreLocationPage() {
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [form, setForm] = useState<StoreLocationForm>(DEFAULT_FORM)
  const [isEditing, setIsEditing] = useState(false)
  const [gettingLocation, setGettingLocation] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/store-location')
      const data = await res.json() as { locations?: StoreLocation[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Yükleme hatası.')
      setLocations(data.locations ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yükleme hatası.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleEdit = (loc: StoreLocation) => {
    setForm(locationToForm(loc))
    setIsEditing(true)
    setError(null)
    setSuccess(null)
  }

  const handleNew = () => {
    setForm(DEFAULT_FORM)
    setIsEditing(false)
    setError(null)
    setSuccess(null)
  }

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('Tarayıcınız konum desteklemiyor.')
      return
    }
    setGettingLocation(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }))
        setGettingLocation(false)
      },
      () => {
        setError('Konum alınamadı.')
        setGettingLocation(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const handleSave = async () => {
    setError(null)
    setSuccess(null)

    const lat = parseFloat(form.latitude)
    const lon = parseFloat(form.longitude)
    const radius = parseInt(form.allowed_radius_meters, 10)
    const accuracy = parseInt(form.max_accuracy_meters, 10)

    if (!form.name.trim()) { setError('Mağaza adı zorunludur.'); return }
    if (isNaN(lat)) { setError('Geçersiz latitude.'); return }
    if (isNaN(lon)) { setError('Geçersiz longitude.'); return }
    if (isNaN(radius) || radius < 10 || radius > 5000) { setError('Yarıçap 10–5000m arası olmalı.'); return }
    if (isNaN(accuracy) || accuracy < 5 || accuracy > 500) { setError('Maks. doğruluk 5–500m arası olmalı.'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/store-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: form.id,
          name: form.name.trim(),
          latitude: lat,
          longitude: lon,
          allowed_radius_meters: radius,
          max_accuracy_meters: accuracy,
          active: form.active,
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Kayıt hatası.')
      setSuccess(form.id ? 'Mağaza konumu güncellendi.' : 'Mağaza konumu eklendi.')
      await load()
      handleNew()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kayıt hatası.')
    } finally {
      setSaving(false)
    }
  }

  const updateField = (field: keyof StoreLocationForm, value: string | boolean) => {
    setForm((f) => ({ ...f, [field]: value }))
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, minHeight: '100dvh', bgcolor: '#0f172a', color: 'text.primary' }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <LocationOnIcon sx={{ fontSize: 18, color: 'primary.main' }} />
          <Typography variant="overline" color="primary.main" fontWeight={700} letterSpacing={1.5}>
            Ayarlar
          </Typography>
        </Box>
        <Typography variant="h5" fontWeight={800}>Mağaza Konumu</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          QR devam takibinde kullanılan geofence konumunu yönetin
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
        {/* Form */}
        <Paper elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} mb={2}>
            {isEditing ? 'Konumu Düzenle' : 'Yeni Konum Ekle'}
          </Typography>
          <Stack spacing={2}>
            <TextField
              fullWidth
              size="small"
              label="Mağaza Adı *"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
            />

            <Stack direction="row" spacing={1}>
              <TextField
                fullWidth
                size="small"
                label="Enlem (Latitude)"
                value={form.latitude}
                onChange={(e) => updateField('latitude', e.target.value)}
                placeholder="41.008650"
              />
              <TextField
                fullWidth
                size="small"
                label="Boylam (Longitude)"
                value={form.longitude}
                onChange={(e) => updateField('longitude', e.target.value)}
                placeholder="28.978430"
              />
            </Stack>

            <Button
              variant="outlined"
              size="small"
              startIcon={gettingLocation ? <CircularProgress size={14} /> : <MyLocationIcon />}
              onClick={handleGetCurrentLocation}
              disabled={gettingLocation}
              sx={{ alignSelf: 'flex-start' }}
            >
              Mevcut Konumumu Kullan
            </Button>

            <Divider sx={{ borderColor: 'divider' }} />

            <Stack direction="row" spacing={1}>
              <TextField
                fullWidth
                size="small"
                label="İzin Verilen Yarıçap (m)"
                type="number"
                value={form.allowed_radius_meters}
                onChange={(e) => updateField('allowed_radius_meters', e.target.value)}
                inputProps={{ min: 10, max: 5000 }}
                helperText="Önerilen: 100–200m"
              />
              <TextField
                fullWidth
                size="small"
                label="Maks. GPS Doğruluğu (m)"
                type="number"
                value={form.max_accuracy_meters}
                onChange={(e) => updateField('max_accuracy_meters', e.target.value)}
                inputProps={{ min: 5, max: 500 }}
                helperText="Önerilen: 50m"
              />
            </Stack>

            <FormControlLabel
              control={
                <Switch
                  checked={form.active}
                  onChange={(e) => updateField('active', e.target.checked)}
                  color="primary"
                />
              }
              label="Aktif"
            />

            <Stack direction="row" spacing={1} justifyContent="flex-end">
              {isEditing && (
                <Button variant="text" onClick={handleNew} disabled={saving}>
                  İptal
                </Button>
              )}
              <Button
                variant="contained"
                startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
                onClick={handleSave}
                disabled={saving}
                sx={{ fontWeight: 700 }}
              >
                {isEditing ? 'Güncelle' : 'Kaydet'}
              </Button>
            </Stack>
          </Stack>
        </Paper>

        {/* List */}
        <Box>
          <Typography variant="subtitle1" fontWeight={700} mb={2}>
            Kayıtlı Konumlar
          </Typography>
          {loading && <CircularProgress color="primary" size={28} />}
          {!loading && locations.length === 0 && (
            <Alert severity="info">Henüz mağaza konumu eklenmemiş.</Alert>
          )}
          <Stack spacing={1.5}>
            {locations.map((loc) => (
              <Paper
                key={loc.id}
                elevation={0}
                sx={{
                  p: 2,
                  border: '1px solid',
                  borderColor: loc.active ? 'primary.dark' : 'divider',
                  borderRadius: 2,
                  opacity: loc.active ? 1 : 0.6,
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="subtitle2" fontWeight={700}>{loc.name}</Typography>
                      <Chip
                        label={loc.active ? 'Aktif' : 'Pasif'}
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: '0.6rem',
                          bgcolor: loc.active ? 'rgba(20,184,166,0.15)' : 'rgba(255,255,255,0.06)',
                          color: loc.active ? 'primary.main' : 'text.disabled',
                        }}
                      />
                    </Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      📍 {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                    </Typography>
                    <Typography variant="caption" color="text.disabled" display="block">
                      Yarıçap: {loc.allowed_radius_meters}m · GPS: max {loc.max_accuracy_meters}m
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => handleEdit(loc)}
                    sx={{ fontSize: '0.7rem' }}
                  >
                    Düzenle
                  </Button>
                </Box>
              </Paper>
            ))}
          </Stack>
        </Box>
      </Box>
    </Box>
  )
}
