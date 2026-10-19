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
| `VAPID_PUBLIC_KEY` | | Web Push VAPID açık anahtarı (gizli değil). Yoksa push kapalıdır — bkz. [Push bildirimleri](#push-bildirimleri) |

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

## Push bildirimleri

Bildirimler (`notifications` tablosu) eklendiğinde abone cihazlara Web Push gönderilir. Vardiya
hatırlatmaları repoda olmayan `shift-reminder` Edge Function'ından geldiği için dağıtım
veritabanından tetiklenir:

```
INSERT notifications ──trigger (pg_net, async)──▶ send-push Edge Function ──VAPID──▶ FCM / Mozilla / Apple
                                                   │ push_subscriptions (404/410 → silinir)
tarayıcı: /api/push/subscription ──▶ push_subscriptions      public/sw-push.js → bildirim + tıklama
```

- Abonelik: `GET /api/push/config`, `POST`/`DELETE /api/push/subscription` (oturum zorunlu, kiosk hariç).
  Aynı cihaz başka hesapla açılırsa abonelik yeni hesaba devredilir; çıkışta cihazın aboneliği silinir.
- Tetikleyici (`20261016100000_push_subscriptions.sql`) pg_net veya Vault secret'ları yoksa sessizce
  hiçbir şey yapmaz; bildirim eklemeyi asla hata verdirmez. Edge Function içeriği DB'den yeniden okur.
- iOS/iPadOS'ta push yalnızca 16.4+ sürümde, uygulama **ana ekrana eklenip** oradan açıldığında çalışır.
- Bildirime tıklanınca açılan sayfa: `src/lib/notificationLinks.ts` (Edge Function'daki kopyası
  `supabase/functions/send-push/links.ts`; eşitliği testle doğrulanır).

### Hızlı kurulum (önerilen)

Aşağıdaki adımların hepsini tek komutla yapar; tekrar çalıştırılabilir (anahtarlar
`.push-keys.local` dosyasında saklanır ve yeniden kullanılır):

```bash
npx supabase login && npx wrangler login     # bir kez
export SUPABASE_DB_URL='postgresql://...'     # panel › Connect › Session pooler (psql gerekir)
bash scripts/setup-push.sh
```

`SUPABASE_DB_URL` verilmezse veritabanı adımı için `push-setup.local.sql` üretilir; SQL Editor'de
çalıştırıp dosyayı silin. Kurulumdan sonra uygulama açıldığında çıkan **Bildirimleri aç** kartıyla
(veya **Bildirimler** sayfasındaki kart) cihaz kaydolur. Bir halka eksikse **Ayarlar › Bildirimler**
(Mağaza Müdürü+) hangi adımın eksik olduğunu gösterir.

### Kurulum (elle)

1. **VAPID anahtarları üret** (bir kez; özel anahtarı kimseyle paylaşmayın):
   ```bash
   npx web-push generate-vapid-keys
   ```
2. **Uygulama (Cloudflare Workers):** açık anahtarı ekleyin — `wrangler.jsonc` → `vars.VAPID_PUBLIC_KEY`
   veya panelden / `npx wrangler secret put VAPID_PUBLIC_KEY`. Yerelde `.env.local`.
3. **Edge Function secret'ları** (`SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` otomatik gelir):
   ```bash
   npx supabase secrets set \
     VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:destek@ornek.com \
     PUSH_WEBHOOK_SECRET=$(openssl rand -hex 32)
   ```
4. **Fonksiyonu deploy edin** (`supabase/config.toml` → `verify_jwt = false`; kimlik `x-push-secret` ile):
   ```bash
   npx supabase functions deploy send-push
   ```
5. **Migration'ı uygulayın** — yukarıdaki geçmiş uyarısı geçerlidir, düz `db push` çalıştırmayın.
   `20261016100000_push_subscriptions.sql` ve `20261017100000_push_diagnostics.sql` dosyalarını
   SQL Editor'de çalıştırıp geçmişe kaydedin:
   ```bash
   npx supabase migration repair --status applied 20261016100000 20261017100000
   ```
6. **Vault secret'larını kaydedin** (SQL Editor; anahtar 3. adımdaki `PUSH_WEBHOOK_SECRET` ile aynı):
   ```sql
   select vault.create_secret('https://<proje-ref>.supabase.co/functions/v1/send-push', 'push_function_url');
   select vault.create_secret('<PUSH_WEBHOOK_SECRET>', 'push_webhook_secret');
   -- değiştirmek için: select vault.update_secret(id, '<yeni>') from vault.secrets where name = 'push_webhook_secret';
   ```
7. **Doğrulama:** Bildirimler sayfasındaki karttan "Aç" deyin, sonra kendinize bir bildirim oluşturun.
   İstek sonuçları: `select * from net._http_response order by created desc limit 10;`
   ve Edge Function logları (panel › Edge Functions › send-push › Logs).

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
