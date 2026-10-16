/**
 * navItems — Uygulama navigasyonunun tek kaynağı.
 *
 * Masaüstü yan menü (AppShell), mobil alt bar (MobileBottomNav) ve /more sayfası
 * aynı listeyi ve aynı rol filtresini kullanır. Saf fonksiyonlar test edilebilir.
 */
import TodayIcon from '@mui/icons-material/Today'
import PeopleIcon from '@mui/icons-material/People'
import ScheduleIcon from '@mui/icons-material/Schedule'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner'
import BarChartIcon from '@mui/icons-material/BarChart'
import BeachAccessIcon from '@mui/icons-material/BeachAccess'
import DashboardIcon from '@mui/icons-material/Dashboard'
import SettingsIcon from '@mui/icons-material/Settings'
import GroupsIcon from '@mui/icons-material/Groups'
import WorkIcon from '@mui/icons-material/Work'
import EventNoteIcon from '@mui/icons-material/EventNote'
import EditNoteIcon from '@mui/icons-material/EditNote'
import NotificationsIcon from '@mui/icons-material/Notifications'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'

import { hasRole, MANAGER_ROLES, ADMIN_ROLES, type RoleName } from '@/lib/auth/roles'

/** /more sayfasındaki gruplama */
export type NavGroup = 'operasyon' | 'planlama' | 'devam' | 'yonetim' | 'hesap'

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  operasyon: 'Operasyon',
  planlama: 'Planlama',
  devam: 'Devam & İzin',
  yonetim: 'Yönetim',
  hesap: 'Hesap',
}

export const NAV_GROUP_ORDER: NavGroup[] = ['operasyon', 'planlama', 'devam', 'yonetim', 'hesap']

export interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  group: NavGroup
  /** Bu nav item yalnızca belirtilen rollere gösterilir. Undefined = herkese. */
  requiredRoles?: RoleName[]
}

/** Masaüstü yan menüdeki öğeler (sıra = menü sırası) */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Genel Bakış',        href: '/dashboard',       icon: <DashboardIcon />,     group: 'operasyon', requiredRoles: MANAGER_ROLES },
  { label: 'Günlük Operasyon',   href: '/',                icon: <TodayIcon />,         group: 'operasyon', requiredRoles: MANAGER_ROLES },
  { label: 'Çalışanlar',         href: '/employees',       icon: <PeopleIcon />,        group: 'yonetim',   requiredRoles: MANAGER_ROLES },
  { label: 'Vardiya Şablonları', href: '/shift-templates', icon: <ScheduleIcon />,      group: 'planlama',  requiredRoles: MANAGER_ROLES },
  { label: 'Haftalık Plan',      href: '/schedule',        icon: <CalendarMonthIcon />, group: 'planlama' },
  { label: 'QR Kiosk',           href: '/qr-kiosk',        icon: <QrCode2Icon />,       group: 'operasyon', requiredRoles: MANAGER_ROLES },
  { label: 'QR Tara',            href: '/attendance/scan', icon: <QrCodeScannerIcon />, group: 'devam' },
  { label: 'Çalışma Özetim',     href: '/my-schedule',     icon: <EventNoteIcon />,     group: 'planlama' },
  { label: 'Açık Vardiyalar',    href: '/open-shifts',     icon: <WorkIcon />,          group: 'planlama' },
  { label: 'İzin Talepleri',     href: '/leave',           icon: <BeachAccessIcon />,   group: 'devam' },
  { label: 'Mesai Düzeltme',     href: '/time-correction', icon: <EditNoteIcon />,      group: 'devam' },
  { label: 'İş Gücü',            href: '/workforce',       icon: <GroupsIcon />,        group: 'yonetim',   requiredRoles: MANAGER_ROLES },
  { label: 'Raporlar',           href: '/reports',         icon: <BarChartIcon />,      group: 'yonetim',   requiredRoles: MANAGER_ROLES },
  { label: 'Ayarlar',            href: '/settings',        icon: <SettingsIcon />,      group: 'yonetim',   requiredRoles: ADMIN_ROLES },
]

/** Yalnızca mobilde (alt bar / /more) erişilen ek sayfalar — masaüstü menüsü değişmez */
export const NOTIFICATIONS_ITEM: NavItem = {
  label: 'Bildirimler', href: '/notifications', icon: <NotificationsIcon />, group: 'hesap',
}
export const MORE_HREF = '/more'
export const MORE_ITEM: NavItem = {
  label: 'Daha Fazla', href: MORE_HREF, icon: <MoreHorizIcon />, group: 'hesap',
}

/** QR Tara rotası — alt bardaki öne çıkan orta buton */
export const SCAN_HREF = '/attendance/scan'

export interface BottomTab {
  label: string
  href: string
  icon: React.ReactNode
  /** Ortadaki büyük, yuvarlak birincil eylem */
  center?: boolean
}

export function isManagerRole(roleName: string | null | undefined): boolean {
  return hasRole(roleName, MANAGER_ROLES)
}

/** Rolün görebileceği öğeler */
export function filterNavItems(items: NavItem[], roleName: string | null | undefined): NavItem[] {
  return items.filter((item) => !item.requiredRoles || hasRole(roleName, item.requiredRoles))
}

/** href pathname için aktif mi? '/' yalnızca birebir eşleşir, diğerleri önek (alt sayfalar dahil). */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Role göre mobil alt bar sekmeleri (5 adet, ortadaki QR Tara) */
export function getBottomTabs(roleName: string | null | undefined): BottomTab[] {
  const scan: BottomTab = { label: 'QR Tara', href: SCAN_HREF, icon: <QrCodeScannerIcon />, center: true }
  const more: BottomTab = { label: 'Daha fazla', href: MORE_HREF, icon: <MoreHorizIcon /> }
  const plan: BottomTab = { label: 'Plan', href: '/schedule', icon: <CalendarMonthIcon /> }

  if (isManagerRole(roleName)) {
    return [
      { label: 'Bugün', href: '/', icon: <TodayIcon /> },
      plan,
      scan,
      { label: 'Bildirimler', href: '/notifications', icon: <NotificationsIcon /> },
      more,
    ]
  }
  return [
    { label: 'Vardiyam', href: '/my-schedule', icon: <EventNoteIcon /> },
    plan,
    scan,
    { label: 'İzin', href: '/leave', icon: <BeachAccessIcon /> },
    more,
  ]
}

/**
 * Alt barda aktif sekmenin href'i. Alt barda olmayan bir sayfadaysa (ör. /reports)
 * o sayfaya /more üzerinden ulaşıldığı için "Daha fazla" aktif sayılır.
 */
export function getActiveTabHref(pathname: string, tabs: BottomTab[]): string | null {
  const match = tabs.find((t) => isNavActive(pathname, t.href))
  if (match) return match.href
  return tabs.some((t) => t.href === MORE_HREF) ? MORE_HREF : null
}

/** /more sayfasında listelenecek öğeler: erişilebilir olup alt barda bulunmayanlar */
export function getMoreItems(roleName: string | null | undefined): NavItem[] {
  const tabHrefs = new Set(getBottomTabs(roleName).map((t) => t.href))
  return filterNavItems([...NAV_ITEMS, NOTIFICATIONS_ITEM], roleName).filter((i) => !tabHrefs.has(i.href))
}

/** Öğeleri NAV_GROUP_ORDER sırasıyla gruplar (boş gruplar atlanır) */
export function groupNavItems(items: NavItem[]): Array<{ group: NavGroup; label: string; items: NavItem[] }> {
  return NAV_GROUP_ORDER
    .map((group) => ({ group, label: NAV_GROUP_LABELS[group], items: items.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0)
}

/** Mobil üst bar başlığı: en uzun eşleşen öğenin etiketi, yoksa 'ShiftUp' */
export function getPageTitle(pathname: string): string {
  let best: NavItem | null = null
  for (const item of [...NAV_ITEMS, NOTIFICATIONS_ITEM, MORE_ITEM]) {
    if (isNavActive(pathname, item.href) && (!best || item.href.length > best.href.length)) best = item
  }
  return best?.label ?? 'ShiftUp'
}
