# Dummy (sahte) test verisi

Canlı Supabase projesine (`kdafwwshxowyrnwegmhv`) sitenin gerçekten kullanılmış gibi görünmesi için gerçeğe yakın sahte veri yüklenir. **Çalışan listesine (`employees`) dokunulmaz**: mevcut çalışanlar yalnızca okunur ve verilerin sahibi olarak kullanılır. **Elle girilmiş (gerçek) vardiyalar da değiştirilmez**: bu vardiyalara yalnızca dummy devam kaydı eklenir.

Dosyalar: [scripts/dummy-data/](scripts/dummy-data/)

| Dosya | Görev |
|---|---|
| `seed.sql` | Sahte veriyi üretir, her satırın id'sini `public._dummy_seed` tablosuna yazar |
| `cleanup.sql` | Yalnızca `_dummy_seed`'de kayıtlı satırları (ve uygulamanın bunlara sonradan bağladıklarını) siler, sonra `_dummy_seed`'i kaldırır |
| `run.mjs` | SQL'i Management API ile gönderir (token: `mcp.json`) |

## Komutlar

```bash
node scripts/dummy-data/run.mjs seed-dry      # dene + geri al, sayıları göster
node scripts/dummy-data/run.mjs seed          # yükle
node scripts/dummy-data/run.mjs status        # yüklü dummy satır sayıları
node scripts/dummy-data/run.mjs cleanup-dry   # temizliği dene + geri al
node scripts/dummy-data/run.mjs cleanup       # TEMİZLE
```

`seed.sql` ikinci kez çalışmaz (`_dummy_seed` doluysa hata verir); yeniden yüklemek için önce `cleanup`. Bugünkü senaryolar çalıştırma anına göre kırpıldığından en anlamlı sonuç 11:40 – 14:00 arasında çalıştırınca alınır.

`seed-yonetici` modu yalnızca henüz dummy vardiyası olmayan *Yönetici* hesaplarına vardiya, devam, izin, mesai düzeltme, müsaitlik ve bildirim ekler; açık vardiya, takas, bugünkü senaryolar, kontrol listesi ve duyuru üretmez.

## Gerçeklik kuralları

Veri uygulamanın kendi kurallarına ve yazma biçimine uyar:

- **Plan:** Elle girilmiş vardiyası olan haftaya dummy vardiya **eklenmez**; o hafta gerçek plan geçerlidir. Diğer haftalarda tam zamanlılar haftada 6 gün × 8 saat (açılış 10–18 / ara 12–20 / kapanış 14–22, aynı hafta aynı vardiya, haftalık döner) çalışır; bu 42 saat net eder. Yarı zamanlılar 4 gün × 5 saat (10–15 ya da 17–22) çalışır. Haftalık tatil Pazartesi–Cuma arasında sabit bir gündür ve `weekly_rest` olarak onaylıdır. Kapanış vardiyasından açılışa geçişte 12 saat dinlenme kalır.
- **Giriş/çıkış:** Çoğunlukla 2–14 dk erken giriş ve kapanıştan 0–12 dk sonra çıkış vardır. %4 oranında 15–38 dk geç giriş, %2 oranında müdür onaylı erken çıkış görülür. 15 dk'yı aşan sapmalar uygulamadaki gibi çeyrek saate yuvarlanır ve kayda not düşülür (ör. `Giriş 10:24'de okutuldu, 10:30 olarak işlendi.`).
- **Molalar:** Toplam süre planlı mola kadardır: 8 sa → 60 dk, 9,5 sa → 90 dk, 11–12 sa → 120 dk. Mola tek parça ya da 2–3 parçadır (60, 30+30, 15+45, 15+30+15 …). %6 oranında molasını birkaç dakika uzatan olur.
- **Fazla mesai:** Kimsede fazla çalışma onayı olmadığı için yazılmaz.
- **İstisnalar:** %1 gelmeme (bir kısmına mesai düzeltme talebi açılır), %0,8 çıkış okutmayı unutma, %1 elle giriş (`manual_override`).
- **Bildirimler:** Geçmiş tarihli yazılır. Push tetikleyicisi seed süresince kapalıdır; dummy bildirim telefona gitmez.

## Ne yüklenir

Aralık **2026-09-01 → 2026-10-31**. Çalışan havuzu: aktif çalışanlar, *Kiosk* hariç (iki mağaza: Capitol ve Canpark).

| Alan | Tablo | İçerik |
|---|---|---|
| Vardiya planı | `shift_assignments` | Yukarıdaki kurallarla; gerçek planı olan haftalar hariç |
| Haftalık tatil | `leave_requests` (`weekly_rest`) | Dummy haftalarda her çalışana 1 sabit gün, onaylı |
| İzin talepleri | `leave_requests` | Yıllık, hastalık, mazeret, ücretsiz ve diğer; onaylı, reddedilmiş ve bekleyen (bekleyenler kasımda). Gerçek vardiyayla çakışan izin eklenmez. |
| Devam / QR | `attendance_records` | Bugünden önceki her vardiya (gerçek ya da dummy) için giriş, molalar ve çıkış |
| Mesai düzeltme | `manual_time_correction_requests` | Gelmeyen ve çıkış okutmayan vardiyalar için bekleyen, onaylı, reddedilmiş ve `direct` |
| Açık vardiyalar | `open_shifts` | 6 açık, 3 iptal, 6 doldurulmuş |
| Takas talepleri | `shift_swap_requests` | Bekleyen, karşı tarafın kabul ettiği, reddedilmiş, iptal ve devretme. Onaylı takas yalnızca iki tarafı da dummy olan çiftte yapılır; gelecekte böyle çift yoksa üretilmez. |
| Müsaitlik | `employee_availability` | Çalışanların yaklaşık 2/3'üne kısıt (ders, kreş vb.) |
| **Kontrol listeleri** | `checklist_templates`, `checklist_runs` (+ maddeler) | Capitol: Açılış (son saat 10:15), Kapanış (22:30), Haftalık depo düzeni (Pazartesi 13:00), Hafta sonu kasa ara sayımı (Cumartesi ve Pazar 16:00). Canpark: Açılış (09:30), Kapanış (22:30). 1 Eylül'den bugüne her günün uygulaması var: açılışı o gün ilk giren, kapanışı en geç çıkan işaretler. Kayıtların ~%88'i zamanında, ~%7'si geç tamamlanmış, ~%5'i yarım kalmış; bunlar için yöneticilere gecikme bildirimi gitmiş. Arada notlar var (kasa farkı, arıza…). Bugün açılış tamamlanmış, kapanış bekliyor. |
| **Duyurular** | `announcements`, `announcement_recipients` | Capitol'de 11, Canpark'ta 2 ve tüm mağazalara 1 duyuru. Bazıları sabitlenmiş, onay isteyen, yalnızca yöneticilere, süresi dolmuş ya da düzenlenmiş. Alıcılar okunma ve onay saatleriyle kayıtlı; son duyurularda okumayanlar var, onay bekleyenlere hatırlatma gitmiş. |
| Bildirimler | `notifications` | Yukarıdakilerin tümü için uygulamanın kendi metinleriyle; okunmuş ve okunmamış karışık |
| Audit log | `audit_logs` | Elle girişler, mesai düzeltme ve izin kararları |

Dokunulmayan tablolar: `employees`, `roles`, `shift_templates`, `store_locations`, `stores`, `store_monthly_norms`, `public_holidays`, `qr_tokens`, `rate_limits`.

### Bugünkü (30 Ekim) kontrol senaryoları

Saatler `seed.sql` §2a'da; `-N` "çalıştırma anından N dk önce" demektir (süren molalar). Seed 30 Ekim 11:20'de çalıştırıldı. Arda Altuğ ve Şilan Özcan gerçek planda bugün haftalık tatilde olduğu için senaryo almadı.

| Çalışan | Mağaza | Vardiya | Durum | Molalar |
|---|---|---|---|---|
| Sibel Can | Capitol | 06:00–14:00 | Moladan döndü | 3 mola (15 + 30 + 15) |
| Ömer Kutlay | Capitol | 06:00–11:00 | Çıkış yaptı (11:04) | 2 mola |
| Kader Alemdar | Capitol | 07:00–15:00 | **2. mola sürüyor** | 1 biten + 1 süren |
| Tülay Temirtoy | Capitol | 08:00–17:00 | Moladan döndü | 2 mola |
| Zehra Özen | Capitol | 09:00–17:00 | İzinli | — |
| Ömer F Kutlay | Capitol | 10:00–22:00 | **2. mola sürüyor** | 1 biten + 1 süren |
| Beyzanur Meşe | Capitol | 10:00–18:00 | **1. mola sürüyor** (uzun) | 1 süren |
| Ecrin Zehra Çiçek | Capitol | 10:00–18:00 | Moladan döndü | 1 mola |
| Seyfullah Demir, Methiye Yılmaz | Capitol | 10:00–22:00 / 10:00–18:00 | Çalışıyor | molasız |
| Mert Can | Capitol | 10:00–18:00 | Çalışıyor; 10:24'te okuttu, **10:30 işlendi** | molasız |
| Şeyma Yorulmaz | Capitol | 10:00–18:00 | **Gelmedi** | — |
| Şevval Elik; Esra Kışnar, Batuhan, Eminenur Akgün | Capitol | 11:00 / 14:00 | Başlamadı (saati gelince Gecikiyor → Gelmedi) | — |
| Çalışan2 | Canpark | 07:00–11:00 | Çıkış yaptı; 10:40'ta okuttu, **10:30 işlendi** (erken) | 1 mola |
| Çalışan bir | Canpark | 08:00–16:00 | Moladan döndü | 1 mola |
| Çalışan üç | Canpark | 09:00–17:00 | **Molada**; 09:21'de okuttu, 09:30 işlendi | 1 süren |

Kayıtlar sabittir: zaman ilerledikçe "molada" görünenler molada kalır, başlamamış vardiyalar "Gelmedi"ye döner.

### Gerçek plandaki aşımlar (dummy değil)

Elle girilmiş planda yasal sınırı aşan haftalar. Dummy devam kayıtları bu planı izlediği için raporlarda fazla çalışma olarak görünürler:

- Kader Alemdar ve Seyfullah Demir, 12–18 Ekim: planlı net 48 saat
- Batuhan, 19–25 Ekim: 7 gün çalışma (haftalık tatil yok)

## Temizlik notları

- `cleanup.sql`, dummy kayıtlara uygulama üzerinden sonradan eklenenleri de siler:
  - dummy vardiyaya okutulan devam kayıtları ve dummy vardiyalarla açılan takaslar,
  - `related_id`'si dummy olan bildirimler ve `entity_id`'si dummy olan audit kayıtları,
  - dummy kontrol listesi şablonlarının seed'den sonra uygulamanın oluşturduğu günlük uygulamaları ve bunların bildirimleri.
- **Kontrol listesi şablonları aktiftir.** Uygulama her gün yeni uygulama oluşturur; son saatten 15 dk sonra işaretlenmemişse yöneticilere gerçek "Kontrol listesi gecikti" bildirimi (push dahil) gider. İstemiyorsan Kontrol listeleri › Şablonlar'dan pasifleştir ya da temizlik yap.
- **Gerçek vardiyalar silinmez.** Üzerlerine yazılan dummy devam kayıtları silinir; vardiya devam kaydı olmadan kalır. Dummy veri yüklüyken gerçek bir vardiyada QR okutulursa uygulama dummy kaydı günceller ve temizlikte o kayıt da silinir.
- `audit_logs` silmeye kapalıdır. Temizlik `trg_audit_logs_immutable` tetikleyicisini yalnızca işlem süresince kapatıp geri açar.
- Toplu silme güvenlik ağı (`app.allow_bulk_delete`) temizlik süresince açılır; silinen her satır `private.deleted_rows`'a arşivlenir.
- **Yakalanamayan durum:** test sırasında uygulamadan *yeni* vardiya, izin, şablon veya duyuru oluşturulursa bunlar `_dummy_seed`'de yoktur ve silinmez. Gerekirse `created_at > <seed zamanı>` ile ayrıca kontrol et.
- Seed zamanı: `SELECT min(created_at) FROM public._dummy_seed;`

## Durum

- [x] 1. yükleme: 2026-10-16 (aralık 08-03 → 11-15). Temizlendi: 2026-10-30 10:55. Eski dummy vardiyaya okutulmuş 1 gerçek test kaydı da silindi (Ömer F Kutlay, 19.10, 15:49–15:51; `private.deleted_rows`'ta arşivli).
- [x] 2. yükleme: 2026-10-30 10:55 (aralık 09-01 → 10-31). Gerçek planın tatil günlerine dummy vardiya eklediği için haftada 7 gün / 60 saat çalışan görünüyordu. Temizlendi: 2026-10-30 11:20.
- [x] 3. yükleme: 2026-10-30 11:20 (TR), gerçeklik kurallarıyla + kontrol listeleri + duyurular. Önce temizlik ve seed birlikte denendi ve geri alındı; gerçek vardiya sayısı (362) değişmedi.
  - shift_assignments 605 · attendance_records 900 · leave_requests 128 · manual_time_correction_requests 11 · open_shifts 15 · shift_swap_requests 7 (onaylı yok) · employee_availability 19 · checklist_templates 6 · checklist_runs 264 (230 zamanında, 18 geç, 16 yarım) · announcements 13 · notifications 710 · audit_logs 28
  - Dummy haftalar: tam zamanlı ortalama 41,5 sa net, en fazla 43,4 sa; gerçek planla karışan hafta yok
  - Yükleme sonrası düzeltme: Ömer F Kutlay'ın bugünkü 1. molası 10:35–10:50'ye alındı (2. molayla arka arkaya görünüyordu)
- [ ] 3. yükleme temizlendi: —
