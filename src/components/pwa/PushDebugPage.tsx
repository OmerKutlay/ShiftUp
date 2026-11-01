'use client'

/**
 * PushDebugPage — GEÇİCİ bildirim teşhis sayfası (/push-debug, tüm çalışanlar).
 *
 * Bu cihazda push zincirinin her halkasını kontrol eder ve test eder:
 *   cihaz/tarayıcı → bildirim izni → service worker → tarayıcı aboneliği (VAPID eşleşmesi)
 *   → sunucu kaydı (son başarı / push servisinin ret sebebi) → arka plan durumu (pil, veri tasarrufu)
 * Testler: yerel bildirim (yalnızca işletim sistemi), anlık sunucu testi (SW'den "ulaştı" mesajı
 * beklenir), 20 sn gecikmeli arka plan testi, aboneliği sıfırlayıp yeniden kurma, raporu kopyalama.
 *
 * Sorun çözülünce sayfa, /api/push/debug ve Bildirimler sayfasındaki bağlantı kaldırılacak.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ClipboardCopy, RefreshCw } from 'lucide-react'
import { Page, PageHeader, StatusBadge, type BadgeTone } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { apiFetch } from '@/lib/api/http'
import { detectPlatform, isStandaloneDisplay, type DevicePlatform } from '@/lib/pwa/deviceInfo'
import {
  bufferToUrlBase64,
  describeError,
  getCurrentSubscription,
  subscribe,
  unsubscribe,
} from '@/lib/pwa/push'

interface Check {
  label: string
  value: string
  tone: BadgeTone
  hint?: string
}

interface Section {
  title: string
  checks: Check[]
}

interface ServerSubscription {
  id: string
  host: string
  endpointTail: string
  thisDevice: boolean | null
  userAgent: string | null
  createdAt: string
  lastSuccessAt: string | null
  failureCount: number
  lastError: string | null
  lastErrorAt: string | null
}

interface ServerState {
  server: { vapidPublicKey: string | null }
  employee: { name: string; role: string | null }
  subscriptions: ServerSubscription[]
  recent: { id: string; type: string; title: string; created_at: string; is_read: boolean }[]
}

interface LogLine {
  at: string
  text: string
  tone: BadgeTone
}

const ok = (label: string, value: string, hint?: string): Check => ({ label, value, tone: 'success', hint })
const warn = (label: string, value: string, hint?: string): Check => ({ label, value, tone: 'warning', hint })
const bad = (label: string, value: string, hint?: string): Check => ({ label, value, tone: 'danger', hint })
const info = (label: string, value: string, hint?: string): Check => ({ label, value, tone: 'neutral', hint })

/** Sıra önemli: Chromium tabanlılar UA'da "Chrome/" da taşır */
const BROWSERS: Array<[RegExp, string]> = [
  [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
  [/EdgA?\/([\d.]+)/, 'Edge'],
  [/OPR\/([\d.]+)/, 'Opera'],
  [/MiuiBrowser\/([\d.]+)/, 'Mi Browser'],
  [/HuaweiBrowser\/([\d.]+)/, 'Huawei Browser'],
  [/Firefox\/([\d.]+)/, 'Firefox'],
  [/CriOS\/([\d.]+)/, 'Chrome (iOS)'],
  [/Chrome\/([\d.]+)/, 'Chrome'],
  [/Version\/([\d.]+).*Safari/, 'Safari'],
]

function browserName(ua: string): string {
  for (const [re, name] of BROWSERS) {
    const m = ua.match(re)
    if (m) return `${name} ${m[1]}`
  }
  return 'Bilinmiyor'
}

function osName(ua: string): string {
  const android = ua.match(/Android ([\d.]+)/)
  if (android) return `Android ${android[1]}`
  const ios = ua.match(/OS (\d+)[_.](\d+)/)
  if (/iPhone|iPad|iPod/.test(ua) && ios) return `iOS ${ios[1]}.${ios[2]}`
  if (/Windows/.test(ua)) return 'Windows'
  if (/Mac OS X/.test(ua)) return 'macOS'
  return 'Bilinmiyor'
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'medium' })
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))])
}

/** Cihazdaki tüm kontroller (yalnızca tarayıcıda) */
async function collectChecks(server: ServerState | null): Promise<{ sections: Section[]; raw: Record<string, unknown> }> {
  const ua = navigator.userAgent
  const platform: DevicePlatform = detectPlatform()
  const standalone = isStandaloneDisplay()
  const raw: Record<string, unknown> = { ua, platform, standalone }

  // ── Cihaz ──
  const device: Check[] = [
    info('İşletim sistemi', osName(ua)),
    info('Tarayıcı', browserName(ua)),
    standalone
      ? ok('Açılış biçimi', 'Ana ekrandan (uygulama)')
      : platform === 'ios'
        ? bad('Açılış biçimi', 'Tarayıcı sekmesi', 'iPhone’da bildirimler yalnızca ana ekrana eklenen uygulamada çalışır.')
        : warn('Açılış biçimi', 'Tarayıcı sekmesi', 'Android’de sekmede de çalışır; ama en güvenilir sonuç için uygulamayı yükleyip ana ekrandan açın.'),
  ]
  if (/HuaweiBrowser|HMSCore/.test(ua)) {
    device.push(bad('Google Play Hizmetleri', 'Huawei tarayıcısı', 'Google hizmetleri olmayan cihazlarda web bildirimi çalışmaz; Chrome kullanın.'))
  }

  // ── İzinler ──
  const perms: Check[] = []
  const hasNotification = 'Notification' in window
  const hasSw = 'serviceWorker' in navigator
  const hasPushManager = 'PushManager' in window
  raw.apis = { Notification: hasNotification, serviceWorker: hasSw, PushManager: hasPushManager }
  perms.push(
    hasNotification && hasSw && hasPushManager
      ? ok('Web Push desteği', 'Var')
      : bad('Web Push desteği', `Yok (Notification:${hasNotification ? '✓' : '✗'} SW:${hasSw ? '✓' : '✗'} Push:${hasPushManager ? '✓' : '✗'})`,
        platform === 'ios' ? 'iOS 16.4+ ve ana ekrandan açılış gerekir.' : 'Güncel Chrome kullanın.'),
  )
  const permission = hasNotification ? Notification.permission : 'unsupported'
  raw.notificationPermission = permission
  perms.push(
    permission === 'granted'
      ? ok('Bildirim izni', 'Verildi')
      : permission === 'denied'
        ? bad('Bildirim izni', 'Engellendi', platform === 'android'
          ? 'Android Ayarlar › Uygulamalar › ShiftUp (veya Chrome) › Bildirimler’i açın; Chrome’da ayrıca site ayarları › Bildirimler › İzin ver.'
          : 'Telefon ayarlarından ShiftUp bildirimlerine izin verin.')
        : warn('Bildirim izni', permission === 'default' ? 'Henüz sorulmadı' : String(permission), 'Aşağıdaki “Aboneliği sıfırla ve yeniden kur” düğmesine basın.'),
  )
  try {
    const st = await navigator.permissions?.query({ name: 'notifications' as PermissionName })
    if (st) {
      raw.permissionsApi = st.state
      if (st.state !== 'granted' && permission === 'granted') {
        perms.push(warn('İzin (Permissions API)', st.state, 'Tarayıcı ile işletim sistemi izni çelişiyor; sistem ayarlarını kontrol edin.'))
      } else perms.push(info('İzin (Permissions API)', st.state))
    }
  } catch {
    /* desteklenmiyor */
  }

  // ── Service worker ──
  const swChecks: Check[] = []
  let reg: ServiceWorkerRegistration | null = null
  if (hasSw) {
    try {
      reg = (await navigator.serviceWorker.getRegistration()) ?? null
    } catch (err) {
      swChecks.push(bad('Kayıt', describeError(err)))
    }
    raw.sw = reg
      ? { scope: reg.scope, active: reg.active?.state ?? null, waiting: !!reg.waiting, installing: !!reg.installing, controller: !!navigator.serviceWorker.controller }
      : null
    if (!reg) swChecks.push(bad('Kayıt', 'Yok', 'Sayfayı yenileyin; düzelmezse uygulamayı kapatıp açın.'))
    else {
      swChecks.push(reg.active ? ok('Etkin worker', reg.active.state) : bad('Etkin worker', 'Yok', 'Service worker etkin değil; sayfayı yenileyin.'))
      swChecks.push(navigator.serviceWorker.controller ? ok('Sayfa kontrolü', 'Var') : warn('Sayfa kontrolü', 'Yok', 'İlk açılışta normal; sayfayı yenileyin.'))
      if (reg.waiting) swChecks.push(warn('Güncelleme', 'Bekliyor', 'Uygulamadaki “Güncelle” uyarısını onaylayın.'))
      swChecks.push(info('Kapsam', new URL(reg.scope).pathname))
      if (hasPushManager && reg.pushManager?.permissionState) {
        try {
          const ps = await reg.pushManager.permissionState({ userVisibleOnly: true })
          raw.pushPermissionState = ps
          swChecks.push(ps === 'granted' ? ok('Push izni (pushManager)', ps) : warn('Push izni (pushManager)', ps))
        } catch (err) {
          swChecks.push(warn('Push izni (pushManager)', describeError(err)))
        }
      }
    }
  }

  // ── Abonelik ──
  const subChecks: Check[] = []
  const sub = await getCurrentSubscription()
  const serverKey = server?.server.vapidPublicKey?.replace(/=+$/, '') ?? null
  if (!sub) {
    subChecks.push(bad('Tarayıcı aboneliği', 'Yok', 'Bildirim gelmesi için bu cihaz abone olmalı: “Aboneliği sıfırla ve yeniden kur”.'))
  } else {
    const host = new URL(sub.endpoint).hostname
    const subKey = bufferToUrlBase64(sub.options.applicationServerKey)
    raw.subscription = { host, expirationTime: sub.expirationTime, keyMatches: serverKey ? subKey === serverKey : null }
    subChecks.push(ok('Tarayıcı aboneliği', 'Var'))
    subChecks.push(info('Push servisi', host))
    if (sub.expirationTime) subChecks.push(info('Geçerlilik', fmtTime(new Date(sub.expirationTime).toISOString())))
    if (serverKey) {
      subChecks.push(subKey === serverKey
        ? ok('VAPID anahtarı', 'Sunucuyla eşleşiyor')
        : bad('VAPID anahtarı', 'Eşleşmiyor', 'Eski anahtarla abone olunmuş: aboneliği sıfırlayın.'))
    }
    const mine = server?.subscriptions.find((s) => s.thisDevice)
    if (!server) subChecks.push(warn('Sunucu kaydı', 'Kontrol edilemedi'))
    else if (!mine) subChecks.push(bad('Sunucu kaydı', 'Bu cihaz kayıtlı değil', 'Sunucu bu cihaza gönderemez: aboneliği sıfırlayın; hata çıkarsa raporu kopyalayıp iletin.'))
    else {
      subChecks.push(ok('Sunucu kaydı', 'Kayıtlı'))
      subChecks.push(mine.lastSuccessAt ? ok('Son başarılı gönderim', fmtTime(mine.lastSuccessAt)) : info('Son başarılı gönderim', 'Henüz yok'))
      if (mine.lastError) subChecks.push(bad('Push servisinin son reddi', `${mine.lastError} (${fmtTime(mine.lastErrorAt)})`))
      if (mine.failureCount > 0) subChecks.push(warn('Ardışık hata', String(mine.failureCount)))
    }
  }

  // ── Arka plan ──
  const bg: Check[] = [
    navigator.onLine ? ok('Bağlantı', 'Çevrim içi') : bad('Bağlantı', 'Çevrim dışı'),
  ]
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (conn) {
    raw.connection = { saveData: conn.saveData, effectiveType: conn.effectiveType }
    bg.push(conn.saveData
      ? warn('Veri tasarrufu', 'Açık', 'Veri tasarrufu / Lite modu arka plan bildirimlerini geciktirebilir; kapatın.')
      : ok('Veri tasarrufu', 'Kapalı'))
  }
  const getBattery = (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> }).getBattery
  if (getBattery) {
    const b = await withTimeout(getBattery.call(navigator).catch(() => null), 2000, null)
    if (b) {
      raw.battery = { level: b.level, charging: b.charging }
      const pct = Math.round(b.level * 100)
      bg.push(!b.charging && pct <= 20
        ? warn('Pil', `%${pct}, şarjda değil`, 'Düşük pilde güç tasarrufu bildirimleri geciktirir.')
        : info('Pil', `%${pct}${b.charging ? ', şarjda' : ''}`))
    }
  }
  try {
    const persisted = await navigator.storage?.persisted?.()
    if (persisted !== undefined) {
      raw.storagePersisted = persisted
      bg.push(info('Kalıcı depolama', persisted ? 'Evet' : 'Hayır'))
    }
  } catch {
    /* desteklenmiyor */
  }
  bg.push(info('Uygulama rozeti (badge)', 'setAppBadge' in navigator ? 'Destekleniyor' : 'Desteklenmiyor'))

  return {
    sections: [
      { title: 'Cihaz', checks: device },
      { title: 'İzinler', checks: perms },
      { title: 'Service worker', checks: swChecks },
      { title: 'Abonelik', checks: subChecks },
      { title: 'Arka plan', checks: bg },
    ],
    raw,
  }
}

interface LoadedState {
  server: ServerState | null
  serverError: string | null
  sections: Section[]
  raw: Record<string, unknown>
  platform: DevicePlatform
}

/** Sunucu kaydı + cihaz kontrolleri */
async function loadState(): Promise<LoadedState> {
  let server: ServerState | null = null
  let serverError: string | null = null
  try {
    const sub = await getCurrentSubscription()
    const qs = sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ''
    server = await apiFetch<ServerState>(`/api/push/debug${qs}`)
  } catch (err) {
    serverError = err instanceof Error ? err.message : 'Sunucu bilgisi alınamadı.'
  }
  const { sections, raw } = await collectChecks(server)
  return { server, serverError, sections, raw, platform: detectPlatform() }
}

function CheckRow({ check }: { check: Check }) {
  return (
    <div className="flex flex-col gap-1 border-b py-2.5 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium">{check.label}</span>
        <StatusBadge tone={check.tone} label={check.value} className="max-w-[60%] whitespace-normal text-right" />
      </div>
      {check.hint && <p className="text-xs text-muted-foreground">{check.hint}</p>}
    </div>
  )
}

const ANDROID_TIPS = [
  'Ayarlar › Uygulamalar › ShiftUp (yüklü değilse Chrome) › Bildirimler: açık; içindeki tüm kategoriler açık.',
  'Aynı ekranda Pil › “Kısıtlanmamış” (Samsung: “Optimize edilmemiş”, ayrıca Pil › Arka plan kullanım sınırları › “Uyuyan uygulamalar” listesinden çıkarın).',
  'Xiaomi/Redmi: Otomatik başlatma açık, Pil tasarrufu “Kısıtlama yok”. Oppo/Realme/Vivo: Arka plan etkinliğine izin ver.',
  'Rahatsız Etmeyin / Odak modu kapalı olmalı; Chrome’da Lite modu / veri tasarrufu kapalı olmalı.',
  'Google Play Hizmetleri yüklü ve güncel olmalı (Huawei’nin Google’sız modellerinde web bildirimi çalışmaz).',
  'Chrome › Ayarlar › Site ayarları › Bildirimler: bu site “İzin verildi” listesinde olmalı.',
]

const IOS_TIPS = [
  'Uygulama Safari’den Paylaş › Ana Ekrana Ekle ile eklenmiş ve ana ekrandaki simgeden açılmış olmalı.',
  'Ayarlar › Bildirimler › ShiftUp: Bildirimlere İzin Ver açık; Kilit Ekranı / Bildirim Merkezi açık.',
  'Odaklanma (Rahatsız Etmeyin, Uyku) modları ShiftUp’ı susturmamalı.',
]

export function PushDebugPage() {
  const [server, setServer] = useState<ServerState | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [sections, setSections] = useState<Section[] | null>(null)
  const [raw, setRaw] = useState<Record<string, unknown>>({})
  const [log, setLog] = useState<LogLine[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [platform, setPlatform] = useState<DevicePlatform>('other')
  const waitingFor = useRef<{ id: string; at: number } | null>(null)

  const addLog = useCallback((text: string, tone: BadgeTone = 'neutral') => {
    const at = new Date().toLocaleTimeString('tr-TR')
    setLog((l) => [{ at, text, tone }, ...l].slice(0, 30))
  }, [])

  const apply = useCallback((s: LoadedState) => {
    setServer(s.server)
    setServerError(s.serverError)
    setSections(s.sections)
    setRaw(s.raw)
    setPlatform(s.platform)
  }, [])

  const refresh = useCallback(async () => apply(await loadState()), [apply])

  // İlk yükleme: kontroller tarayıcı API'lerine bağlı, yalnızca istemcide çalışır
  useEffect(() => {
    let cancelled = false
    void loadState().then((s) => {
      if (!cancelled) apply(s)
    })
    return () => {
      cancelled = true
    }
  }, [apply])

  // SW push aldığında açık sayfalara PUSH_RECEIVED gönderir (public/sw-push.js)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; notificationId?: string } | null
      if (data?.type !== 'PUSH_RECEIVED') return
      const w = waitingFor.current
      if (w && data.notificationId === w.id) {
        addLog(`Push cihaza ulaştı ✓ (${((Date.now() - w.at) / 1000).toFixed(1)} sn)`, 'success')
        waitingFor.current = null
      } else addLog('Push alındı (başka bir bildirim)', 'info')
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [addLog])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } catch (err) {
      addLog(describeError(err), 'danger')
    } finally {
      setBusy(null)
    }
  }

  const localTest = () => run('local', async () => {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      addLog('Yerel test için önce bildirim izni gerekli.', 'warning')
      return
    }
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) {
      addLog('Service worker kaydı yok.', 'danger')
      return
    }
    await reg.showNotification('Yerel test', {
      body: 'Bu bildirim sunucusuz, doğrudan telefonda oluşturuldu. Görüyorsanız telefonun bildirim ayarları doğru.',
      icon: '/icon-192.png',
      tag: 'local-test',
    })
    addLog('Yerel bildirim gösterildi — bildirim panelinde görünmüyorsa telefonun ShiftUp/Chrome bildirim ayarlarını kontrol edin.', 'info')
  })

  const serverTest = () => run('server', async () => {
    const res = await apiFetch<{ notificationId: string | null }>('/api/push/debug', { method: 'POST', body: { delaySeconds: 0 } })
    if (!res.notificationId) {
      addLog('Test bildirimi oluşturulamadı.', 'danger')
      return
    }
    waitingFor.current = { id: res.notificationId, at: Date.now() }
    addLog('Test bildirimi sunucuda oluşturuldu, cihaza ulaşması bekleniyor…')
    const id = res.notificationId
    setTimeout(() => {
      if (waitingFor.current?.id === id) {
        waitingFor.current = null
        addLog('20 sn içinde cihaza ulaşmadı ✗ — aşağıdaki “Abonelik” bölümünde push servisinin reddini kontrol edin.', 'danger')
      }
      void refresh()
    }, 20_000)
    setTimeout(() => void refresh(), 5_000)
  })

  const backgroundTest = () => run('bg', async () => {
    await apiFetch('/api/push/debug', { method: 'POST', body: { delaySeconds: 20 } })
    addLog('20 sn sonra test bildirimi gönderilecek. Şimdi uygulamayı kapatın (son uygulamalardan kaydırın) ve ekranı kilitleyin; bildirim gelirse arka plan teslimi çalışıyor.', 'info')
  })

  const resubscribe = () => run('resub', async () => {
    addLog('Abonelik sıfırlanıyor…')
    await unsubscribe()
    const result = await subscribe()
    if (result.ok) addLog('Abone olundu ve sunucuya kaydedildi ✓', 'success')
    else addLog(`Abone olunamadı: ${result.reason}${result.detail ? ` — ${result.detail}` : ''}`, 'danger')
    await refresh()
  })

  const copyReport = () => run('copy', async () => {
    const report = {
      at: new Date().toISOString(),
      raw,
      sections: sections?.map((s) => ({ [s.title]: s.checks.map((c) => `${c.label}: ${c.value}`) })),
      server: server && {
        employee: server.employee,
        subscriptions: server.subscriptions.map(({ userAgent: _ua, ...s }) => s),
        recent: server.recent.map((n) => `${n.created_at} ${n.type} ${n.title}`),
      },
      log: log.map((l) => `${l.at} ${l.text}`),
    }
    const text = JSON.stringify(report, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      addLog('Rapor panoya kopyalandı.', 'success')
    } catch {
      addLog('Panoya kopyalanamadı; ekran görüntüsü alın.', 'warning')
    }
  })

  return (
    <Page size="narrow">
      <PageHeader
        title="Bildirim teşhisi"
        description="Bu cihazda anlık bildirimlerin neden gelmediğini adım adım kontrol eder. (Geçici sayfa)"
        actions={
          <Button variant="outline" onClick={() => void run('refresh', refresh)} disabled={busy !== null}>
            {busy === 'refresh' ? <Spinner /> : <RefreshCw />}
            Yenile
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        <Card className="gap-3 shadow-xs">
          <CardHeader className="px-4 md:px-6">
            <CardTitle>Testler</CardTitle>
            <CardDescription>
              Sırasıyla deneyin. Sorun sürerse “Raporu kopyala” ile çıktıyı iletin.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 px-4 sm:grid-cols-2 md:px-6">
            <Button variant="outline" onClick={() => void resubscribe()} disabled={busy !== null}>
              {busy === 'resub' && <Spinner />}Aboneliği sıfırla ve yeniden kur
            </Button>
            <Button variant="outline" onClick={() => void localTest()} disabled={busy !== null}>
              {busy === 'local' && <Spinner />}Yerel bildirim göster
            </Button>
            <Button onClick={() => void serverTest()} disabled={busy !== null}>
              {busy === 'server' && <Spinner />}Sunucudan test bildirimi
            </Button>
            <Button variant="outline" onClick={() => void backgroundTest()} disabled={busy !== null}>
              {busy === 'bg' && <Spinner />}Arka plan testi (20 sn)
            </Button>
            <Button variant="secondary" className="sm:col-span-2" onClick={() => void copyReport()} disabled={busy !== null || !sections}>
              <ClipboardCopy />Raporu kopyala
            </Button>
            {log.length > 0 && (
              <ul className="flex flex-col gap-1.5 rounded-lg border p-3 text-xs sm:col-span-2" aria-live="polite">
                {log.map((l, i) => (
                  <li key={`${l.at}-${i}`} className="flex gap-2">
                    <span className="shrink-0 tabular-nums text-muted-foreground">{l.at}</span>
                    <span className={l.tone === 'danger' ? 'text-destructive' : l.tone === 'success' ? 'text-success' : undefined}>
                      {l.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {serverError && (
          <Alert tone="danger">
            <AlertTitle>Sunucu bilgisi alınamadı</AlertTitle>
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        {sections === null ? (
          <div className="flex justify-center py-10"><Spinner className="size-6 text-muted-foreground" /></div>
        ) : (
          sections.map((s) => (
            <Card key={s.title} className="gap-1 shadow-xs">
              <CardHeader className="px-4 md:px-6">
                <CardTitle className="text-base">{s.title}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 md:px-6">
                {s.checks.map((c) => <CheckRow key={c.label} check={c} />)}
              </CardContent>
            </Card>
          ))
        )}

        {server && (
          <Card className="gap-1 shadow-xs">
            <CardHeader className="px-4 md:px-6">
              <CardTitle className="text-base">Hesabınızın kayıtlı cihazları ({server.subscriptions.length})</CardTitle>
              <CardDescription>{server.employee.name}{server.employee.role ? ` · ${server.employee.role}` : ''}</CardDescription>
            </CardHeader>
            <CardContent className="px-4 md:px-6">
              {server.subscriptions.length === 0 && (
                <p className="py-2 text-sm text-muted-foreground">
                  Hiç kayıtlı cihaz yok — bu hesaba hiçbir telefona anlık bildirim gönderilemez.
                </p>
              )}
              {server.subscriptions.map((s) => (
                <div key={s.id} className="flex flex-col gap-1 border-b py-2.5 text-sm last:border-b-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{s.host} …{s.endpointTail}</span>
                    {s.thisDevice && <StatusBadge tone="brand" label="Bu cihaz" />}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {s.userAgent ? `${osName(s.userAgent)} · ${browserName(s.userAgent)} · ` : ''}
                    eklendi {fmtTime(s.createdAt)} · son başarı {fmtTime(s.lastSuccessAt)}
                    {s.failureCount > 0 ? ` · ${s.failureCount} hata` : ''}
                  </span>
                  {s.lastError && <span className="text-xs text-destructive">Son ret: {s.lastError}</span>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {server && server.recent.length > 0 && (
          <Card className="gap-1 shadow-xs">
            <CardHeader className="px-4 md:px-6">
              <CardTitle className="text-base">Son bildirimleriniz (uygulama içi)</CardTitle>
              <CardDescription>Burada olup telefona gelmeyen bildirim push zincirinde takılmıştır.</CardDescription>
            </CardHeader>
            <CardContent className="px-4 md:px-6">
              {server.recent.map((n) => (
                <div key={n.id} className="flex justify-between gap-2 border-b py-2 text-sm last:border-b-0">
                  <span className="min-w-0 truncate">{n.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtTime(n.created_at)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {platform !== 'other' && (
          <Card className="gap-2 shadow-xs">
            <CardHeader className="px-4 md:px-6">
              <CardTitle className="text-base">{platform === 'android' ? 'Android ayarları' : 'iPhone ayarları'}</CardTitle>
              <CardDescription>
                Yerel bildirim görünüyor ama uygulama kapalıyken bildirim gelmiyorsa en sık sebep bunlardır.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 md:px-6">
              <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                {(platform === 'android' ? ANDROID_TIPS : IOS_TIPS).map((t) => <li key={t}>{t}</li>)}
              </ol>
            </CardContent>
          </Card>
        )}
      </div>
    </Page>
  )
}
