# ShiftUp — Mağaza Vardiya Yönetim Sistemi

Next.js 16 (App Router) + Supabase tabanlı vardiya planlama, QR ile devam takibi, izin ve
mesai yönetimi uygulaması.

## Kurulum

```bash
npm install
cp .env.example .env.local   # değerleri doldurun
npm run dev                  # http://localhost:3000
```

### Ortam değişkenleri

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase proje URL'i |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅ | Yalnızca Supabase Auth oturumu için kullanılır; tablolara anon erişim kapalıdır |
| `SUPABASE_SECRET_KEY` | ✅ | Sunucu tarafı veri erişimi — asla istemciye gönderilmez |
| `AUTH_MODE` | | `production` (varsayılan, e-posta OTP) veya `development` (sabit `DEV_OTP`) |
| `DEV_OTP` | dev | `AUTH_MODE=development` iken geçerli kod |
| `DEV_SESSION_SECRET` | | Dev oturum çerezinin HMAC anahtarı (yoksa service role key kullanılır) |
| `CRON_SECRET` | | `/api/attendance/alerts/scan` cron çağrısı için Bearer anahtarı |
| `ATTENDANCE_REQUIRE_LOCATION` | | `false` yapılmadıkça QR okutmada konum (geofence) zorunludur |
| `WT_MIN_REST_HOURS` / `WT_MAX_DAILY_HOURS` / `WT_MAX_WEEKLY_HOURS` | | Çalışma süresi sınırlarını sıkılaştırır (yasal üst sınır 11s/gün, 45s/hafta aşılamaz) |

## Veritabanı

Şema `supabase/migrations/` altındadır ve sıfırdan kurulumla canlı veritabanı aynı şemaya ulaşır
(eşitleme migration'ları idempotenttir).

```bash
npx supabase db reset        # yerel: migration'lar + seed
npx supabase db push         # bağlı (canlı) projeye uygula
```

> **Migration geçmişi uyumsuzluğu:** canlı projede eski migration'lar MCP ile farklı sürüm
> numaralarıyla uygulanmıştır; repodaki `202609…`–`20261001…` dosyaları canlı
> `supabase_migrations.schema_migrations` tablosunda yer almaz. Bu yüzden canlıya düz
> `supabase db push` çalıştırmayın — önce `supabase migration repair --status applied <sürümler>`
> ile eşitleyin. `20261012…` migration'ları canlıya uygulanmış ve geçmişe kaydedilmiştir.
>
> Vardiya hatırlatma bildirimleri `shift-reminder-job` (pg_cron, 5 dk) ile `shift-reminder`
> Edge Function'ını çağırır; fonksiyonun kaynağı bu repoda değildir.
>
> Bütünlük migration'ı (`20261012100100_integrity_constraints.sql`) mevcut veride çakışma
> bulursa ilgili tekil kısıtı oluşturmaz ve `WARNING` basar — hiçbir veri silinmez. Çıktıyı
> kontrol edip uyarıdaki sorguyla kayıtları inceleyin.

## Komutlar

```bash
npm run dev          # Geliştirme sunucusu
npm run build        # Production build
npm run typecheck    # next typegen + TypeScript kontrolü
npm run lint         # ESLint (Next 16'da `next lint` kaldırıldı — ESLint CLI)
npm run test         # Vitest
```

CI (`.github/workflows/ci.yml`) her PR'da typecheck, lint, test ve build çalıştırır.

## Güvenlik modeli

- **Tarayıcı veritabanına doğrudan erişmez.** Tüm tablolarda RLS açıktır ve anon/authenticated
  rollerine hiçbir policy tanımlı değildir. Veri yalnızca `src/app/api/*` route'larından,
  service role ile okunur/yazılır; her route yetkiyi kendisi kontrol eder
  (`requireAuth`, `requireMinRole`, `canAccessEmployee`).
- **Rol hiyerarşisi:** Yönetici > Mağaza Müdürü > Müdür Yardımcısı > Çalışan. Yöneticiler yalnızca
  kendilerinden düşük roldeki çalışanları düzenleyebilir; kimse kendi talebini onaylayamaz.
- **Sayfa koruması:** `src/middleware.ts` oturumu, hesabın aktifliğini ve sayfa rolünü kontrol eder;
  başka origin'den gelen yazma isteklerini reddeder.
- **Devam kaydı:** QR + geofence zorunlu, QR token'ları tek kullanımlık ve atomik tüketilir;
  durum geçişleri iyimser kilitle (optimistic lock) yapılır.
- **Denetim kaydı:** override, mesai düzeltme, izin/takas kararları ve çalışan yönetimi
  `audit_logs` tablosuna yazılır (değiştirilemez).

## İş Kanunu kuralları

`src/lib/laborLaw.ts` — günlük 11 saat net (Md. 63), haftalık 45 saat ve fazla çalışma (Md. 41),
ara dinlenme (Md. 68), gece çalışması 7,5 saat (Md. 69), hafta tatili (Md. 46), yıllık izin
hakkı (Md. 53). Saatler her zaman Europe/Istanbul'a göre hesaplanır; gece yarısını geçen
vardiyalar desteklenir.

## Mimari

```
src/
├── app/
│   ├── api/                 # Route handler'lar (tek veri erişim noktası)
│   ├── (sayfalar)/          # Her sayfa ince bir sunucu bileşeni + client bileşen
│   ├── error.tsx, global-error.tsx, not-found.tsx, offline/
│   └── icon-*.png/          # PWA ikonları (next/og ile üretilir)
├── components/              # UI bileşenleri
├── lib/
│   ├── api/                 # Client tarafı fetch sarmalayıcıları
│   ├── *Repository.ts       # Sunucu tarafı veri erişimi (lib/db)
│   ├── *Service.ts          # İş kuralları (devam, mesai düzeltme, izin)
│   └── laborLaw.ts, workingTimeService.ts, workforcePlanner.ts
├── middleware.ts            # Oturum + sayfa yetkisi + CSRF
└── types/
supabase/migrations/         # Şema, RLS, kısıtlar
docs/                        # Geliştirici notları (ör. telefonla QR testi: docs/dev-tunnel.md)
```
