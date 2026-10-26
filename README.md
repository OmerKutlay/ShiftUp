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
> "Giriş/çıkış okutulmadı" uyarıları `attendance-missed-scan` (pg_cron, 2 dk) ile
> `public.scan_missed_attendance()` SQL fonksiyonundan gelir
> (`20261023100000_attendance_missed_scan_cron.sql`); uygulama kapalıyken de push gider.
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
- **Mağaza yalıtımı:** bkz. [Çoklu mağaza](#çoklu-mağaza) — her sorgu oturumun aktif mağazasıyla
  sınırlanır; istemciden gelen her id'nin mağazaya ait olduğu doğrulanır.

## Çoklu mağaza

`20261027100000_multi_store.sql` — `stores` tablosu; mevcut veri "ana mağaza"ya
(`00000000-0000-0000-0003-000000000001`) taşınır.

- **Çalışan:** her çalışanın tek bir ana mağazası vardır (`employees.store_id`). Mağaza değişikliği
  (transfer) yalnızca Admin tarafından, çalışanın eski mağazada bugün veya sonrası için vardiyası
  yoksa yapılır. Geçmiş vardiyalar `shift_assignments.store_id` ile eski mağazada kalır; puantaj ve
  raporlar vardiyanın mağazasına göre hesaplanır.
- **Yetki:** Admin şirket genelidir — mağaza açar/yeniden adlandırır/pasife alır (Ayarlar › Mağazalar)
  ve yan menüdeki mağaza seçiciyle aktif mağazayı değiştirir (`shiftup_store` httpOnly çerezi,
  `POST /api/stores/active`). Müdür, yönetici, çalışan ve kiosk yalnızca kendi mağazasını görür.
- **Aktif mağaza** sunucuda çözülür (`src/lib/storeScope.ts`, `getCurrentEmployee` →
  `SessionEmployee.store_id`); istemci mağaza parametresi göndermez. Mağaza değişince SWR önbelleği
  tümüyle temizlenir.
- **Mağazaya özel:** vardiyalar, vardiya şablonları (ad mağaza içinde tekil), açık vardiyalar, konum
  (mağaza başına tek aktif geofence), kiosk QR'ı (mağaza başına tek aktif kod, Realtime kanalı
  `kiosk-qr:<store_id>`), denetim kaydı. İzin, mesai düzeltme, takas ve uygunluk çalışanın
  mağazasından okunur.
- **Resmi tatiller:** `store_id` boş = ulusal (tüm mağazalar, yalnızca Admin yönetir); dolu = o
  mağazanın yerel tatili (Müdür+). Ulusal tatil gününe yerel tatil eklenemez; ulusal kayıt her zaman
  geçerlidir (tatil ücretini etkiler, mağaza değiştiremez).
- **Bildirimler:** "giriş/çıkış okutulmadı", izin/düzeltme/takas talepleri yalnızca ilgili mağazanın
  yöneticilerine ve tüm adminlere gider.
- **Puantaj / fazla çalışma:** puantaj mağaza bazlıdır (vardiyanın mağazası). Fazla çalışma raporu
  (haftalık 45 / yıllık 270 saat) ise çalışanın tüm mağazalardaki vardiyalarını toplar — sınır
  işveren düzeyindedir. Vardiya atamadaki yasal kontroller de çalışanın tüm vardiyalarına bakar.

## Raporlar › Bordro puantajı

Muhasebeye (Logo, Mikro, Netsis, Luca, Zirve…) verilecek aylık özet. Belirli bir yazılıma özel değil,
tek ve sade bir düzen: muhasebeci sütunları kendi programına eşler ya da elle girer.
`GET /api/reports/payroll?month=YYYY-MM[&format=xlsx|csv]` — Müdür Yardımcısı+, aktif mağaza,
kullanıcı başına 10 indirme / 10 dk, her indirme denetim kaydına (`report.payroll.export`) yazılır.
Format verilmezse JSON (ekran önizlemesi). Hesap `src/lib/payrollTimesheet.ts`; çalışılan saat ve fazla
mesai mevcut puantaj hesabından (`timesheet.ts`) gelir, yeniden hesaplanmaz.

**Excel** ("Puantaj" + "Açıklamalar" sayfaları) gün kodlarını da içerir; **CSV** (UTF-8 BOM, `;` ayraç,
ondalık virgül) yalnızca toplamlardır. Sütunlar:

| Sütun | Anlamı |
|---|---|
| Sicil No, TC Kimlik No | **Boş gelir** — KVKK gereği saklanmaz; muhasebe doldurur |
| Ad Soyad | Çalışan |
| Çalışılan Gün | Giriş-çıkış kaydı olan gün sayısı |
| Normal Saat | Net çalışma − fazla mesai |
| Fazla Mesai Saat (%50) | Haftalık (Pzt–Paz) 45 saati aşan net süre, Pazar'ı o ayda olan haftalar |
| Genel Tatil Çalışılan Gün / Saat | Tam gün resmi tatilde çalışma (GTÇ); saat, normal saatin içindedir |
| Gece Çalışması Saat | 20:00–06:00 arası |
| Hafta Tatili / Genel Tatil (Çalışılmadı) / Yıllık İzin / Mazeret İzni | Ücretli günler (prim gününe dahil) |
| Raporlu Gün / Ücretsiz İzin / Devamsız Gün | Eksik gün nedenleri |
| Eksik Gün, Eksik Gün Nedeni Kodu | SGK kodu: rapor `01`, devamsızlık `15`, ücretsiz izin `21`; birden fazla neden `12` |
| SGK Prim Günü | İşte olunan gün (30 esaslı) − eksik gün |

Gün kodları (Excel): `Ç` çalıştı, `HT` hafta tatili, `GT` genel tatil, `GTÇ` genel tatilde çalıştı,
`Yİ` yıllık izin, `R` rapor, `Üİ` ücretsiz izin, `M` mazeret/diğer izin, `D` devamsız, `P` planlı (henüz olmadı).
SGK eksik gün nedeni listesi (01–29) "Açıklamalar" sayfasındadır; kaynak:
<https://www.alomaliye.com/2020/06/22/eksik-gunlerde-kullanilacak-sgk-kodlari/> (SGK Genelgesi 2020/20).

Kurallar ve sınırlar (02 ve 14 numaralı kodlar güncel listede yoktur; liste sgk.gov.tr ile doğrulanamadı, üçüncü taraf kaynaklara dayanır):

- Ay 30 gün kabul edilir; tam çalışılan ayda 28/29/31 günlük de olsa prim günü 30'dur. 31 günlük ayda
  31. gün eksik gün sayılmaz (yalnızca işte olunan gün 30 iken; 3. gün ve sonrası girişte sayılır). İşte olunan
  gün = takvim günü sayısı, en çok 30 (işe giriş tarihi çalışan kaydından okunur; işten çıkış tarihi
  eklendiğinde aynı hesaba bağlanacak).
- Rapor günleri bu raporda eksik gün sayılır (eski "Aylık puantaj" SGK sütunu yalnızca ücretsiz izin ve
  devamsızlığı düşer).
- İşten çıkış tarihi tutulmadığından ay içinde ayrılanların eksik günü (kod 16) elle girilmelidir.
- Fazla mesai bu mağazadaki vardiyalardan hesaplanır (puantaj mağaza bazlıdır); birden fazla mağazada
  çalışanın işveren düzeyindeki haftalık toplamı için Raporlar › Fazla çalışma'ya bakın.
- Ay bitmeden alınan çıktı geçicidir; gelecek günler eksik sayılmaz.
- Ay içinde mağaza değiştiren çalışan, çalıştığı her mağazanın dosyasında görünür; prim gününü iki dosyada
  birleştirmek muhasebenin işidir.
- Ay sınırını aşan haftanın fazla mesaisi, haftanın Pazar günü hangi aydaysa o aya yazılır. Normal saat
  (net − fazla mesai) en az 0'dır.
- İşe girişi ay sonundan sonra olan çalışan listelenmez. Ay içinde hiç kaydı (vardiya/izin/devam) olmayan
  çalışan listelenir ama Not sütununda "Kontrol edin: ay içinde kayıt yok" yazar.
- CSV'de eksik gün nedeni kodu `="01"` biçimindedir; Excel baştaki sıfırı atmasın diye.

## İşten ayrılış

Çalışanlar Çalışanlar › satır menüsü › **İşten çıkış** ile (Müdür+; kendi seviyesindeki/üstündeki biri ve kendisi hariç, Admin hepsini) çıkarılır: son çalışma günü (dahil; en fazla 30 gün geriye, 1 yıl ileriye), neden (SGK kodlarının sadeleştirilmişi) ve not girilir. Onaydan önce etkiler önizlenir: son günden sonraki vardiyalar (tüm mağazalarda) silinir ya da açık vardiyaya çevrilir, bekleyen izin / mesai düzeltme / takas talepleri iptal edilir, çıkış tarihindeki kullanılmamış yıllık izin (İş K. Md. 59) `employees.termination_leave_balance` alanına kaydedilir. Her şey denetim kaydına yazılır. **Geri al** yalnızca Admin içindir; silinen vardiyalar geri yüklenmez.

`active` anlamı: son çalışma günü geçince pasif. Oturum, giriş, QR ve kiosk kontrolleri `isEffectivelyActive()` (`src/lib/employment.ts`) ile ertesi gün 00:00'da (Europe/Istanbul) çalışanı reddeder; `apply_employee_terminations()` pg_cron işi (00:15) `active=false` yapar , push aboneliklerini siler ve oturumları (auth.sessions) kapatır. Bordro/norm hesapları için `isEmployedOn(employee, 'YYYY-MM-DD')` kullanılabilir. Vardiya / devam / izin kaydı olan çalışan kalıcı silinemez (409 `HAS_RECORDS`); yasal kayıtlar için işten çıkış kullanılır.

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

## İşletim

### Veri saklama (retention)
`public.purge_expired_data()` (pg_cron `purge-expired-data`, her gün 03:30 Türkiye saati) sınırsız büyüyen
operasyonel tabloları gruplar halinde temizler ve silinen satır sayısını jsonb olarak döner:

| Tablo | Saklama |
|---|---|
| `qr_tokens` | süresi dolmuş / kullanılmış, 2 günden eski |
| `rate_limits` | süresi dolmuş, 1 günden eski |
| `notifications` | okunmuş 90 gün, okunmamış 180 gün |
| `app_errors` | 30 gün |

Yasal kayıtlar (`audit_logs`, devam/vardiya/izin/mesai düzeltme/takas kayıtları) **asla** silinmez.
`net._http_response` pg_net tarafından yönetilir.

### Hata günlüğü (`app_errors`)
Ücretsiz, harici servis yok. `serverError()` (`src/lib/apiErrors.ts`) 500'leri `console.error` ile birlikte
`app_errors`'a yazar (`src/lib/errorLog.ts`: asenkron `ctx.waitUntil`, hata başına dakikada 1 + isolate başına
dakikada 30 satır sınırı). Tarayıcı hataları (`error.tsx`, `global-error.tsx`, ErrorBoundary)
`POST /api/client-errors` ile gelir (oturum zorunlu, kullanıcı başına 5/dk, 8 KB; çalışan/mağaza oturumdan).
Admin: Ayarlar → Hatalar (son 100 kayıt). Workers Logs `wrangler.jsonc` içinde zaten açık.

### Yedekleme
`.github/workflows/db-backup.yml` her Pazar 01:00 UTC'de (ve elle, "Run workflow") `public` şemasının
`pg_dump` yedeğini alır, **şifreli** artifact olarak 90 gün saklar. Repo herkese açık olduğundan artifact'ler
giriş yapmış herhangi bir GitHub kullanıcısı tarafından indirilebilir; bu yüzden şifreleme ve güçlü
(en az 32 rastgele karakter; iş daha kısa parolayı reddeder) bir parola zorunludur. Parolayı kaybederseniz yedek açılamaz; ayrıca saklayın.

Secret'lar (yoksa iş sessizce atlanır):
```bash
gh secret set SUPABASE_DB_URL      # Session pooler URL (runner'larda IPv6 yok; doğrudan bağlantı çalışmaz)
openssl rand -base64 32      # parola üret (ör.), sonra:
gh secret set BACKUP_PASSPHRASE    # en az 32 karakter
```

Geri yükleme:
```bash
gh run download -n db-backup            # shiftup-YYYYMMDD-HHMM.dump.enc
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in shiftup-*.dump.enc -out backup.dump   # parola sorulur
pg_restore --no-owner --clean --if-exists -d "$HEDEF_DB_URL" backup.dump
```
- Zamanlanmış workflow'lar repoda 60 gün etkinlik olmazsa GitHub tarafından durdurulur; arada bir elle çalıştırın.
- Düzenli aralıklarla bir geri yükleme tatbikatı (boş test DB'ye `pg_restore`) önerilir.
- `app_errors` DB hata metinleriyle satır değerleri içerebilir; yalnızca Admin görür, 30 gün saklanır.

Yedek yalnızca `public` şemasıdır (auth kullanıcıları ve storage dahil değildir). Geri yüklemeyi önce
boş bir test veritabanında deneyin.
