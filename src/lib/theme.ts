import { createTheme } from '@mui/material/styles'

import { C, tint } from './palette'

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: C.brand,
      dark: C.brandDark,
      light: C.brandLight,
      contrastText: C.white,
    },
    secondary: {
      main: C.plumFill,
      dark: C.plum,
      contrastText: C.white,
    },
    background: {
      default: C.canvas,
      paper: C.surface,
    },
    text: {
      primary: C.ink,
      secondary: C.inkSecondary,
      disabled: C.inkMuted,
    },
    divider: C.border,
    error: { main: C.danger, light: C.dangerFill },
    warning: { main: C.warning, light: C.warningFill },
    success: { main: C.success, light: C.successFill },
    info: { main: C.info, light: C.infoFill },
    action: {
      hover: tint(C.ink, 0.04),
      selected: tint(C.brand, 0.08),
    },
  },
  typography: {
    fontFamily: '"Figtree", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.01em' },
    h5: { fontWeight: 700, letterSpacing: '-0.01em' },
    h6: { fontWeight: 700 },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    button: { fontWeight: 600 },
    // Sayfa başlığı üstündeki etiket ("Raporlama", "Planlama"…) BÜYÜK HARF değil, yazıldığı gibi
    overline: { textTransform: 'none', fontSize: '0.8rem' },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    // Native uygulama hissi: dokunma vurgusu yok, butonlarda çift dokunma zoom gecikmesi yok.
    // Masaüstü görünümünü değiştirmez (yalnızca dokunmatik davranış).
    MuiCssBaseline: {
      styleOverrides: {
        html: { WebkitTapHighlightColor: 'transparent' },
        'button, a, [role="button"], [role="tab"], input[type="button"], input[type="submit"]': {
          touchAction: 'manipulation',
        },
        // Ana ekrana eklenmiş PWA'da sayfa sınırında çift bounce olmasın (çekerek yenileme kendi göstergesini çizer)
        '@media (display-mode: standalone)': {
          'html, body': { overscrollBehaviorY: 'contain' },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 12, alignItems: 'center' },
        // Uzun, boşluksuz mesajlar (ör. DB hata metinleri) dar ekranda taşmasın
        message: { overflowWrap: 'anywhere', minWidth: 0 },
      },
      // Yeni UI: yumuşak zemin + koyu metin, ikon tonun rengiyle
      variants: (
        [
          ['error', C.dangerSoft, C.danger],
          ['warning', C.warningSoft, C.warning],
          ['success', C.successSoft, C.success],
          ['info', C.infoSoft, C.info],
        ] as const
      ).map(([severity, bg, fg]) => ({
        props: { severity, variant: 'standard' as const },
        style: { backgroundColor: bg, color: C.ink, '& .MuiAlert-icon': { color: fg } },
      })),
    },
    MuiToggleButtonGroup: {
      // SegmentedControl ile aynı görünüm: bej zemin, seçili seçenek beyaz
      styleOverrides: {
        root: { backgroundColor: C.surfaceMuted, borderRadius: 10, padding: 3, gap: 2 },
        grouped: {
          border: 0,
          borderRadius: '8px !important',
          margin: 0,
          '&.Mui-selected': {
            backgroundColor: C.surface,
            color: C.ink,
            boxShadow: `0 1px 2px ${tint(C.ink, 0.08)}`,
            '&:hover': { backgroundColor: C.surface },
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        // Telefonda 32px kenar boşluğu form alanlarını gereksiz daraltıyor
        paper: ({ theme }) => ({
          borderRadius: 16,
          [theme.breakpoints.down('sm')]: {
            margin: 16,
            '&.MuiDialog-paperFullWidth': { width: 'calc(100% - 32px)' },
            maxHeight: 'calc(100% - 32px)',
          },
        }),
      },
    },
    MuiPopover: {
      styleOverrides: { paper: { border: `1px solid ${C.border}`, boxShadow: `0 12px 32px ${tint(C.ink, 0.12)}` } },
    },
    // Sekme ve toggle etiketleri MUI varsayılanı olan BÜYÜK HARF yerine yazıldığı gibi görünsün
    MuiTab: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600, color: C.inkSecondary, '&.Mui-selected': { color: C.ink } } },
    },
    MuiTabs: {
      // Dar ekranda sığmayan sekmeler kesilip erişilemez olmasın: kaydırılabilir + oklar
      defaultProps: { variant: 'scrollable', scrollButtons: 'auto', allowScrollButtonsMobile: true },
      styleOverrides: { indicator: { height: 2, borderRadius: 2 } },
    },
    MuiToggleButton: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600, color: C.inkSecondary } },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 4, backgroundColor: C.surfaceMuted },
        bar: { borderRadius: 4 },
      },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { fontWeight: 700 } },
    },
    MuiFab: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600, boxShadow: `0 6px 16px ${tint(C.brand, 0.3)}` },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
        outlined: { borderColor: C.border },
        rounded: { borderRadius: 14 },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 10,
          boxShadow: 'none',
          '&:hover': { boxShadow: 'none' },
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
      // Renkli dolu chip'ler yumuşak zemin + koyu ton (rozet görünümü)
      variants: (
        [
          ['default', C.surfaceMuted, C.inkSecondary],
          ['primary', C.brandSoft, C.brandDark],
          ['secondary', C.plumSoft, C.plum],
          ['error', C.dangerSoft, C.danger],
          ['warning', C.warningSoft, C.warning],
          ['success', C.successSoft, C.success],
          ['info', C.infoSoft, C.info],
        ] as const
      ).map(([color, bg, fg]) => ({
        props: { color, variant: 'filled' as const },
        style: { backgroundColor: bg, color: fg },
      })),
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { backgroundColor: C.surface, borderRadius: 10 },
        notchedOutline: { borderColor: C.border },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: C.border },
        head: { color: C.inkSecondary, fontWeight: 600 },
      },
    },
    MuiTooltip: {
      styleOverrides: { tooltip: { backgroundColor: C.ink, fontSize: '0.75rem' } },
    },
    MuiAvatar: {
      styleOverrides: { root: { fontWeight: 700, fontSize: '0.8rem' } },
    },
    // Sayfa yükleme skeleton'ları — açık zeminde yumuşak wave efekti
    MuiSkeleton: {
      defaultProps: { animation: 'wave' },
      styleOverrides: {
        root: {
          backgroundColor: tint(C.ink, 0.06),
        },
        wave: {
          '&::after': {
            background: `linear-gradient(90deg, transparent, ${tint(C.surface, 0.6)}, transparent)`,
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
