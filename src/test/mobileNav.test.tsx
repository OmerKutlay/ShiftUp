/**
 * mobileNav.test.tsx — mobil alt bar sekmeleri, aktif sekme mantığı, /more listesi
 * ve çekerek yenileme yardımcıları.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/renderWithProviders'

let mockPathname = '/'
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const signOut = vi.fn()
let mockAuth: { status: string; employee: unknown } = { status: 'authenticated', employee: null }
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ ...mockAuth, signOut, refreshEmployee: vi.fn() }),
}))

import {
  NAV_ITEMS,
  filterNavItems,
  getActiveTabHref,
  getBottomTabs,
  getMoreItems,
  groupNavItems,
  isNavActive,
  pageMetaFor,
} from '@/components/layout/navItems'
import { ACCESS, type AccessLevel } from '@/lib/auth/roles'
import { MobileBottomNav } from '@/components/layout/MobileBottomNav'
import { MorePage } from '@/components/more/MorePage'
import { dampenPull, decideGesture, PULL_THRESHOLD } from '@/components/layout/PullToRefresh'

function asRole(level: AccessLevel, fullName = 'Ayşe Yılmaz') {
  mockAuth = {
    status: 'authenticated',
    employee: { id: 'e1', full_name: fullName, roles: { name: 'Kasiyer', access_level: level } },
  }
}

const hrefs = (tabs: { href: string }[]) => tabs.map((t) => t.href)

describe('isNavActive', () => {
  it("'/' yalnızca birebir eşleşir", () => {
    expect(isNavActive('/', '/')).toBe(true)
    expect(isNavActive('/schedule', '/')).toBe(false)
  })
  it('diğer rotalar önek ile (alt sayfalar dahil) eşleşir, benzer isimler eşleşmez', () => {
    expect(isNavActive('/schedule', '/schedule')).toBe(true)
    expect(isNavActive('/schedule/2026-10-12', '/schedule')).toBe(true)
    expect(isNavActive('/schedules', '/schedule')).toBe(false)
  })
})

describe('getBottomTabs', () => {
  it('çalışan: Vardiyam, Plan, QR, İzin, Daha fazla', () => {
    const tabs = getBottomTabs(ACCESS.EMPLOYEE)
    expect(hrefs(tabs)).toEqual(['/my-schedule', '/schedule', '/attendance/scan', '/leave', '/more'])
    expect(tabs.map((t) => t.label)).toEqual(['Vardiyam', 'Plan', 'QR Tara', 'İzin', 'Daha fazla'])
  })
  it.each([ACCESS.MANAGER, ACCESS.STORE_MANAGER, ACCESS.ADMIN])('yönetici (%s): Bugün, Plan, QR, Bildirimler, Daha fazla', (role) => {
    expect(hrefs(getBottomTabs(role))).toEqual(['/', '/schedule', '/attendance/scan', '/notifications', '/more'])
  })
  it('rol bilinmiyorsa çalışan sekmeleri', () => {
    expect(hrefs(getBottomTabs(null))[0]).toBe('/my-schedule')
  })
})

describe('getActiveTabHref', () => {
  const manager = getBottomTabs(ACCESS.MANAGER)
  it('ana sayfa yalnızca "/"de Bugün sekmesini seçer', () => {
    expect(getActiveTabHref('/', manager)).toBe('/')
    expect(getActiveTabHref('/schedule', manager)).toBe('/schedule')
  })
  it('alt barda olmayan sayfada "Daha fazla" aktif olur', () => {
    expect(getActiveTabHref('/reports', manager)).toBe('/more')
    expect(getActiveTabHref('/more', manager)).toBe('/more')
  })
})

describe('getMoreItems / filterNavItems', () => {
  it('çalışan yönetici sayfalarını görmez, alt bardakiler tekrarlanmaz', () => {
    const items = hrefs(getMoreItems(ACCESS.EMPLOYEE))
    expect(items).toEqual(expect.arrayContaining(['/open-shifts', '/time-correction', '/notifications']))
    for (const h of ['/', '/dashboard', '/employees', '/settings', '/qr-kiosk', '/my-schedule', '/leave', '/schedule', '/attendance/scan']) {
      expect(items).not.toContain(h)
    }
  })
  it('Müdür Yardımcısı Ayarlar hariç yönetim sayfalarını görür', () => {
    const items = hrefs(getMoreItems(ACCESS.MANAGER))
    expect(items).toEqual(expect.arrayContaining(['/dashboard', '/employees', '/reports', '/my-schedule', '/leave']))
    expect(items).not.toContain('/settings')
    expect(items).not.toContain('/notifications')
  })
  it('Günlük operasyon herkese Daha fazla › Operasyon altında görünür (yöneticide Bugün sekmesi olsa da)', () => {
    const daily = (role: AccessLevel) => getMoreItems(role).find((i) => i.label === 'Günlük operasyon')
    expect(daily(ACCESS.MANAGER)).toMatchObject({ href: '/', group: 'operasyon' })
    // Çalışanın "/" ana sayfası Vardiyam'dır; aynı sayfa ona /daily'de açılır
    expect(daily(ACCESS.EMPLOYEE)).toMatchObject({ href: '/daily', group: 'operasyon' })
    expect(pageMetaFor('/daily', ACCESS.EMPLOYEE).title).toBe('Günlük operasyon')
    expect(pageMetaFor('/daily').title).toBe('Günlük operasyon')
  })
  it('çalışan İş gücü sayfasını "Müsaitlik ve takas" adıyla Planlama grubunda görür', () => {
    const item = getMoreItems(ACCESS.EMPLOYEE).find((i) => i.href === '/workforce')
    expect(item).toMatchObject({ label: 'Müsaitlik ve takas', group: 'planlama' })
    expect(filterNavItems(NAV_ITEMS, ACCESS.MANAGER).find((i) => i.href === '/workforce')?.label).toBe('İş gücü')
  })
  it('Mağaza Müdürü Ayarlar dahil tüm menüyü görür', () => {
    expect(filterNavItems(NAV_ITEMS, ACCESS.STORE_MANAGER)).toHaveLength(NAV_ITEMS.length)
    expect(hrefs(getMoreItems(ACCESS.STORE_MANAGER))).toContain('/settings')
  })
  it('gruplar sabit sırada, boş grup yok', () => {
    const groups = groupNavItems(getMoreItems(ACCESS.EMPLOYEE))
    expect(groups.every((g) => g.items.length > 0)).toBe(true)
    expect(groups.map((g) => g.group)).toEqual(['operasyon', 'planlama', 'devam', 'hesap'])
  })
})

describe('MobileBottomNav', () => {
  beforeEach(() => {
    mockPathname = '/'
  })

  it('çalışan sekmelerini nav landmark içinde, aktif sekmeyi aria-current ile gösterir', () => {
    asRole(ACCESS.EMPLOYEE)
    mockPathname = '/leave'
    renderWithProviders(<MobileBottomNav />)
    const nav = screen.getByRole('navigation', { name: 'Alt menü' })
    expect(nav).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(5)
    expect(screen.getByRole('link', { name: 'İzin' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Vardiyam' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'QR Tara' })).toHaveAttribute('href', '/attendance/scan')
    expect(screen.queryByRole('link', { name: 'Bugün' })).not.toBeInTheDocument()
  })

  it('yönetici "/"de Bugün aktif; /schedule\'da Bugün aktif değil', () => {
    asRole(ACCESS.STORE_MANAGER)
    const { unmount } = renderWithProviders(<MobileBottomNav />)
    expect(screen.getByRole('link', { name: 'Bugün' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Bildirimler' })).toBeInTheDocument()
    unmount()
    mockPathname = '/schedule'
    renderWithProviders(<MobileBottomNav />)
    expect(screen.getByRole('link', { name: 'Bugün' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Plan' })).toHaveAttribute('aria-current', 'page')
  })

  it('oturum yüklenirken sekme göstermez (rol flash\'ı yok)', () => {
    mockAuth = { status: 'loading', employee: null }
    renderWithProviders(<MobileBottomNav />)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})

describe('MorePage', () => {
  it('profil, gruplu bağlantılar ve çıkış', async () => {
    asRole(ACCESS.EMPLOYEE, 'Ayşe Yılmaz')
    mockPathname = '/more'
    renderWithProviders(<MorePage />)
    expect(screen.getByText('Ayşe Yılmaz')).toBeInTheDocument()
    expect(screen.getByText('Kasiyer')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Devam ve izin' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Açık vardiyalar/ })).toHaveAttribute('href', '/open-shifts')
    expect(screen.queryByRole('link', { name: /Çalışanlar/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Çıkış yap' }))
    expect(signOut).toHaveBeenCalled()
  })

  it('bildirim teşhisi Daha fazla sayfasında gösterilmez (Ayarlar › Bildirimler\'de)', () => {
    asRole(ACCESS.STORE_MANAGER)
    renderWithProviders(<MorePage />)
    expect(screen.queryByText('Bildirim teşhisi')).not.toBeInTheDocument()
  })
})

describe('PullToRefresh yardımcıları', () => {
  it('çekme mesafesi sönümlenir ve sınırlanır', () => {
    expect(dampenPull(-10)).toBe(0)
    expect(dampenPull(100)).toBeLessThan(100)
    expect(dampenPull(1000)).toBe(120)
    expect(dampenPull(200)).toBeGreaterThanOrEqual(PULL_THRESHOLD)
  })
  it('yatay veya yukarı hareket iptal, aşağı dikey hareket çekme', () => {
    expect(decideGesture(2, 3)).toBe('wait')
    expect(decideGesture(30, 10)).toBe('cancel')
    expect(decideGesture(0, -20)).toBe('cancel')
    expect(decideGesture(3, 20)).toBe('pull')
  })
})
