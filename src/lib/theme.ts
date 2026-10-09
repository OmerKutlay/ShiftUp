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
  },
  shape: {
    borderRadius: 12,
  },
  components: {
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
