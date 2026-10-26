/**
 * navItems — Uygulama navigasyonunun tek kaynağı.
 *
 * Masaüstü yan menü (AppShell), mobil alt bar (MobileBottomNav) ve /more sayfası
 * aynı listeyi ve aynı rol filtresini kullanır. Saf fonksiyonlar test edilebilir.
 */
import {
  BriefcaseBusiness, CalendarClock, CalendarDays, ChartColumnBig, ClipboardCheck, FilePenLine, House, Layers,
  LayoutDashboard, Menu, Bell, Plane, QrCode, ScanLine, Settings, Users, UsersRound,
} from 'lucide-react'

import { hasRole, MANAGER_ROLES, ADMIN_ROLES, ACCESS, type AccessLevel } from '@/lib/auth/roles'

/** /more sayfasındaki gruplama */
export type NavGroup = 'operasyon' | 'planlama' | 'devam' | 'yonetim' | 'hesap'

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  operasyon: 'Operasyon',
  planlama: 'Planlama',
  devam: 'Devam ve izin',
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
  requiredRoles?: AccessLevel[]
  /** Yönetici olmayanlara farklı ad / grup / adres (aynı sayfanın çalışan görünümü) */
  employeeLabel?: string
  employeeGroup?: NavGroup
  employeeHref?: string
}

/**
 * Günlük operasyonun çalışan adresi. "/" yöneticinin ana sayfasıdır; çalışanın ana sayfası
 * (uygulama açılışı, giriş sonrası) Vardiyam olarak kalsın diye aynı sayfa çalışana burada açılır.
 */
export const DAILY_EMPLOYEE_HREF = '/daily'

/** Masaüstü yan menüdeki öğeler (sıra = menü sırası) */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Genel bakış',        href: '/dashboard',       icon: <LayoutDashboard />,     group: 'operasyon', requiredRoles: MANAGER_ROLES },
  { label: 'Günlük operasyon',   href: '/',                icon: <ClipboardCheck />,         group: 'operasyon', employeeHref: DAILY_EMPLOYEE_HREF },
  { label: 'Çalışanlar',         href: '/employees',       icon: <Users />,        group: 'yonetim',   requiredRoles: MANAGER_ROLES },
  { label: 'Vardiya şablonları', href: '/shift-templates', icon: <Layers />,      group: 'planlama',  requiredRoles: MANAGER_ROLES },
  { label: 'Haftalık plan',      href: '/schedule',        icon: <CalendarDays />, group: 'planlama' },
  { label: 'QR Kiosk',           href: '/qr-kiosk',        icon: <QrCode />,       group: 'operasyon', requiredRoles: MANAGER_ROLES },
  { label: 'QR Tara',            href: '/attendance/scan', icon: <ScanLine />, group: 'devam' },
  { label: 'Çalışma özetim',     href: '/my-schedule',     icon: <CalendarClock />,     group: 'planlama' },
  { label: 'Açık vardiyalar',    href: '/open-shifts',     icon: <BriefcaseBusiness />,          group: 'planlama' },
  { label: 'İzinler',            href: '/leave',           icon: <Plane />,   group: 'devam' },
  { label: 'Mesai düzeltme',     href: '/time-correction', icon: <FilePenLine />,      group: 'devam' },
  { label: 'İş gücü',            href: '/workforce',       icon: <UsersRound />,        group: 'yonetim',   employeeLabel: 'Müsaitlik ve takas', employeeGroup: 'planlama' },
  { label: 'Raporlar',           href: '/reports',         icon: <ChartColumnBig />,      group: 'yonetim',   requiredRoles: MANAGER_ROLES },
  { label: 'Ayarlar',            href: '/settings',        icon: <Settings />,      group: 'yonetim',   requiredRoles: ADMIN_ROLES },
]

/** Yalnızca mobilde (alt bar / /more) erişilen ek sayfalar — masaüstü menüsü değişmez */
export const NOTIFICATIONS_ITEM: NavItem = {
  label: 'Bildirimler', href: '/notifications', icon: <Bell />, group: 'hesap',
}
export const MORE_HREF = '/more'

/** QR Tara rotası — alt barın ortasındaki sekme */
export const SCAN_HREF = '/attendance/scan'

export interface BottomTab {
  label: string
  href: string
  icon: React.ReactNode
}

export function isManagerRole(accessLevel: AccessLevel | null | undefined): boolean {
  return hasRole(accessLevel, MANAGER_ROLES)
}

/** Rolün görebileceği öğeler (yönetici olmayanlara çalışan adı / grubu ile) */
export function filterNavItems(items: NavItem[], accessLevel: AccessLevel | null | undefined): NavItem[] {
  const manager = isManagerRole(accessLevel)
  return items
    .filter((item) => !item.requiredRoles || hasRole(accessLevel, item.requiredRoles))
    .map((item) => (manager ? item : {
      ...item,
      label: item.employeeLabel ?? item.label,
      group: item.employeeGroup ?? item.group,
      href: item.employeeHref ?? item.href,
    }))
}

/** href pathname için aktif mi? '/' yalnızca birebir eşleşir, diğerleri önek (alt sayfalar dahil). */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Role göre mobil alt bar sekmeleri (5 adet, ortadaki QR Tara) */
export function getBottomTabs(accessLevel: AccessLevel | null | undefined): BottomTab[] {
  const scan: BottomTab = { label: 'QR Tara', href: SCAN_HREF, icon: <ScanLine /> }
  const more: BottomTab = { label: 'Daha fazla', href: MORE_HREF, icon: <Menu /> }
  const plan: BottomTab = { label: 'Plan', href: '/schedule', icon: <CalendarDays /> }

  if (isManagerRole(accessLevel)) {
    return [
      { label: 'Bugün', href: '/', icon: <House /> },
      plan,
      scan,
      { label: 'Bildirimler', href: '/notifications', icon: <Bell /> },
      more,
    ]
  }
  return [
    { label: 'Vardiyam', href: '/my-schedule', icon: <CalendarClock /> },
    plan,
    scan,
    { label: 'İzin', href: '/leave', icon: <Plane /> },
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

/**
 * /more sayfasında listelenecek öğeler: erişilebilir olup alt barda bulunmayanlar.
 * Günlük operasyon yöneticide "Bugün" sekmesi olsa da Operasyon grubunda adıyla da listelenir.
 */
export function getMoreItems(accessLevel: AccessLevel | null | undefined): NavItem[] {
  const tabHrefs = new Set(getBottomTabs(accessLevel).map((t) => t.href))
  return filterNavItems([...NAV_ITEMS, NOTIFICATIONS_ITEM], accessLevel).filter((i) => i.href === '/' || !tabHrefs.has(i.href))
}

/** Öğeleri NAV_GROUP_ORDER sırasıyla gruplar (boş gruplar atlanır) */
export function groupNavItems(items: NavItem[]): Array<{ group: NavGroup; label: string; items: NavItem[] }> {
  return NAV_GROUP_ORDER
    .map((group) => ({ group, label: NAV_GROUP_LABELS[group], items: items.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0)
}

/** Üst çubuk / breadcrumb için sayfa başlığı ve grup adı (en uzun eşleşen öğe) */
export function pageMetaFor(
  pathname: string,
  accessLevel?: AccessLevel | null,
): { title: string; group: string | null } {
  // Rol bilinmiyorsa (oturum yükleniyor) yönetici adları önce gelir; çalışan adresleri de eşleşsin
  const all = [...NAV_ITEMS, NOTIFICATIONS_ITEM]
  const items = accessLevel === undefined
    ? [...all, ...filterNavItems(all, ACCESS.EMPLOYEE)]
    : filterNavItems(all, accessLevel)
  const match = items
    .filter((i) => isNavActive(pathname, i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]
  if (match) return { title: match.label, group: NAV_GROUP_LABELS[match.group] }
  if (pathname === MORE_HREF) return { title: 'Daha fazla', group: null }
  if (pathname === '/gizlilik') return { title: 'Aydınlatma metni', group: null }
  return { title: 'ShiftUp', group: null }
}
