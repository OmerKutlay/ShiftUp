'use client'

/**
 * MorePage — mobil "Daha fazla" sekmesi: profil özeti, alt barda olmayan erişilebilir
 * sayfalar (gruplu) ve çıkış. Liste navItems'tan gelir; rol filtresi yan menüyle aynıdır.
 */
import Link from 'next/link'
import {
  Box,
  Button,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Skeleton,
  Typography,
} from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import LogoutIcon from '@mui/icons-material/Logout'

import { useAuth } from '@/context/AuthContext'
import { getMoreItems, groupNavItems } from '@/components/layout/navItems'
import { PageHeader, PersonAvatar } from '@/components/common'

export function MorePage() {
  const { employee, status, signOut } = useAuth()
  const roleName = employee?.roles?.name ?? employee?.role_name ?? null
  const groups = status === 'loading' ? [] : groupNavItems(getMoreItems(roleName))

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 640, mx: 'auto', color: 'text.primary' }}>
      <PageHeader title="Daha fazla" />
      {/* Profil özeti */}
      <Paper
        variant="outlined"
        sx={{ p: 2, mb: 3, display: 'flex', alignItems: 'center', gap: 2, borderColor: 'divider' }}
      >
        {status === 'loading' ? (
          <>
            <Skeleton variant="circular" width={48} height={48} />
            <Box sx={{ flex: 1 }}>
              <Skeleton width="60%" />
              <Skeleton width="35%" />
            </Box>
          </>
        ) : (
          <>
            <PersonAvatar name={employee?.full_name ?? '?'} size={48} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={700} noWrap>
                {employee?.full_name ?? 'Giriş yapılmadı'}
              </Typography>
              {employee && (
                <Typography variant="body2" color="text.secondary" noWrap>
                  {employee.roles?.name ?? employee.role}
                </Typography>
              )}
            </Box>
          </>
        )}
      </Paper>

      {groups.map((g) => (
        <Box component="section" key={g.group} aria-labelledby={`more-${g.group}`} sx={{ mb: 2.5 }}>
          <Typography
            id={`more-${g.group}`}
            component="h2"
            variant="overline"
            color="text.secondary"
            sx={{ display: 'block', px: 1, mb: 0.5, fontWeight: 600 }}
          >
            {g.label}
          </Typography>
          <Paper variant="outlined" sx={{ borderColor: 'divider', overflow: 'hidden' }}>
            <List disablePadding>
              {g.items.map((item, i) => (
                <ListItemButton
                  key={item.href}
                  component={Link}
                  href={item.href}
                  prefetch={false}
                  divider={i < g.items.length - 1}
                  sx={{ minHeight: 52, userSelect: 'none', borderColor: 'divider' }}
                >
                  <ListItemIcon sx={{ color: 'primary.main', minWidth: 40 }}>{item.icon}</ListItemIcon>
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{ fontSize: '0.95rem', fontWeight: 500 }}
                  />
                  <ChevronRightIcon sx={{ color: 'text.disabled' }} />
                </ListItemButton>
              ))}
            </List>
          </Paper>
        </Box>
      ))}

      {status === 'authenticated' && (
        <Button
          fullWidth
          variant="outlined"
          color="error"
          startIcon={<LogoutIcon />}
          onClick={() => void signOut()}
          sx={{ mt: 1 }}
        >
          Çıkış Yap
        </Button>
      )}
    </Box>
  )
}
