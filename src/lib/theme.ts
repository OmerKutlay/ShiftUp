import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#14b8a6',    // teal-500
      dark: '#0d9488',    // teal-600
      light: '#2dd4bf',
    },
    secondary: {
      main: '#6366f1',    // indigo-500
      dark: '#4f46e5',
    },
    background: {
      default: '#0f172a', // slate-950
      paper: 'rgba(30, 41, 59, 0.8)',  // slate-800 with transparency
    },
    text: {
      primary: '#f1f5f9',  // slate-100
      secondary: '#94a3b8', // slate-400
    },
    divider: 'rgba(255, 255, 255, 0.08)',
    error: { main: '#ef4444' },
    warning: { main: '#f59e0b' },
    success: { main: '#10b981' },
    info: { main: '#60a5fa' },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h5: { fontWeight: 800 },
    h6: { fontWeight: 700 },
    subtitle2: { fontWeight: 600 },
    // Sayfa başlığı üstündeki etiket ("Raporlama", "Planlama"…) BÜYÜK HARF değil, yazıldığı gibi
    overline: { textTransform: 'none', fontSize: '0.8rem' },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiAlert: {
      styleOverrides: {
        // Uzun, boşluksuz mesajlar (ör. DB hata metinleri) dar ekranda taşmasın
        message: { overflowWrap: 'anywhere', minWidth: 0 },
      },
    },
    MuiDialog: {
      styleOverrides: {
        // Telefonda 32px kenar boşluğu form alanlarını gereksiz daraltıyor
        paper: ({ theme }) => ({
          // Varsayılan paper rengi yarı saydam; modal içeriğin arkasındaki sayfa okunabilirliği bozuyor
          backgroundColor: '#1e293b',
          [theme.breakpoints.down('sm')]: {
            margin: 16,
            '&.MuiDialog-paperFullWidth': { width: 'calc(100% - 32px)' },
            maxHeight: 'calc(100% - 32px)',
          },
        }),
      },
    },
    MuiPopover: {
      styleOverrides: { paper: { backgroundColor: '#1e293b' } },
    },
    MuiTabs: {
      // Dar ekranda sığmayan sekmeler kesilip erişilemez olmasın: kaydırılabilir + oklar
      defaultProps: { variant: 'scrollable', scrollButtons: 'auto', allowScrollButtonsMobile: true },
    },
    // Sekme ve toggle etiketleri MUI varsayılanı olan BÜYÜK HARF yerine yazıldığı gibi görünsün
    MuiTab: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } },
    },
    MuiToggleButton: {
      styleOverrides: { root: { textTransform: 'none' } },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 8,
          // WCAG 2.5.5: minimum touch target 44×44px
          minHeight: 44,
        },
        sizeSmall: {
          minHeight: 36,   // small butonlar için biraz esneklik
          minWidth: 36,
        },
      },
    },
    // IconButton touch target — tüm sayfadaki edit/refresh/hamburger butonları
    MuiIconButton: {
      styleOverrides: {
        root: {
          minWidth: 44,
          minHeight: 44,
        },
        sizeSmall: {
          minWidth: 36,
          minHeight: 36,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          borderRadius: 6,
        },
      },
    },
    // Sayfa yükleme skeleton'ları — koyu arka planda yumuşak wave efekti
    MuiSkeleton: {
      defaultProps: { animation: 'wave' },
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(148, 163, 184, 0.10)', // slate-400 @ 10%
        },
        wave: {
          '&::after': {
            background: 'linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.08), transparent)',
          },
        },
      },
    },
    // ListItemButton touch target (nav items)
    MuiListItemButton: {
      styleOverrides: {
        root: {
          minHeight: 44,
        },
      },
    },
  },
})
