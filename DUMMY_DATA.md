# Dummy (sahte) test verisi

Canlı Supabase projesine (`kdafwwshxowyrnwegmhv`) sitenin tüm alanlarını test etmek için gerçekçi sahte veri yüklenir. **Çalışan listesine (`employees`) dokunulmaz**: mevcut çalışanlar yalnızca okunur ve verilerin sahibi olarak kullanılır.

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

`seed.sql` ikinci kez çalışmaz (`_dummy_seed` doluysa hata verir); yeniden yüklemek için önce `cleanup`.

## Ne yüklenir

Aralık **2026-08-03 → 2026-11-15**. Çalışan havuzu: aktif çalışanlar, *Kiosk* ve *Yönetici* rolleri hariç. Onaylayan kişi: ilk *Mağaza Müdürü* (yoksa Yönetici).

| Alan | Tablo | İçerik |
|---|---|---|
| Vardiya planı | `shift_assignments` | Herkese haftada 6 gün (yarı zamanlı: 4 gün × 5 saat). Aktif 6–10 saatlik şablonlardan en fazla 3'ü haftalık döner. Çalışanın o gün zaten bir vardiyası varsa atlanır. |
| Haftalık tatil | `leave_requests` (`weekly_rest`) | Her çalışana haftada 1 sabit gün, onaylı |
| İzin talepleri | `leave_requests` | 25 talep: yıllık, hastalık, mazeret, ücretsiz ve diğer türler; onaylı, reddedilmiş ve bekleyen. Onaylı izin günlerine vardiya yazılmaz. |
| Devam / QR | `attendance_records` | Bugünden önceki her vardiya için giriş, mola ve çıkış. Yaklaşık %9 geç giriş, %12 fazla çalışma (45–180 dk), %3 erken çıkış, %3 gelmeme, %1,5 çıkış okutmayı unutma, %2 elle giriş (`manual_override`). Bugün başlamış vardiyalar şu anki durumuyla yazılır (çalışıyor, molada…). |
| Fazla çalışma / puantaj | (devam verisinden hesaplanır) | Ağustos, Eylül ve Ekim aylarının puantajı dolu; resmi tatil (30 Ağustos) çalışmaları dahil |
| Mesai düzeltme | `manual_time_correction_requests` | Gelmeyen ve çıkış okutmayan vardiyalar için bekleyen, onaylı, reddedilmiş ve `direct` talepler. Onaylananların devam kaydı da oluşturulur. |
| Açık vardiyalar | `open_shifts` | 6 açık, 3 iptal, 6 doldurulmuş (mevcut bir dummy vardiyaya bağlı) |
| Takas talepleri | `shift_swap_requests` | 9 talep: bekleyen, karşı tarafın kabul ettiği, onaylı (vardiyalar gerçekten el değiştirir), reddedilmiş, iptal ve devretme |
| Müsaitlik | `employee_availability` | Çalışanların yaklaşık 2/3'üne kısıt (ders, kreş vb.) |
| Bildirimler | `notifications` | Yukarıdakilerin tümü için uygulamanın kendi metinleriyle; okunmuş ve okunmamış karışık |
| Audit log | `audit_logs` | Elle girişler, mesai düzeltme ve izin kararları |

Dokunulmayan tablolar: `employees`, `roles`, `shift_templates`, `store_locations`, `public_holidays`, `qr_tokens`, `rate_limits`.

## Temizlik notları

- `cleanup.sql`, dummy kayıtlara uygulama üzerinden sonradan eklenenleri de siler: dummy vardiyaya okutulan devam kayıtları, dummy vardiyalarla açılan takaslar, `related_id`'si dummy olan bildirimler ve `entity_id`'si dummy olan audit kayıtları.
- `audit_logs` silmeye kapalıdır. Temizlik `trg_audit_logs_immutable` tetikleyicisini yalnızca işlem süresince kapatıp geri açar.
- **Yakalanamayan durum:** test sırasında uygulamadan *yeni* vardiya veya izin oluşturulursa (ör. dummy bir mesai düzeltmesini onaylayınca açılan yeni vardiya) bunlar `_dummy_seed`'de yoktur ve silinmez. Gerekirse `created_at > <seed zamanı>` ile ayrıca kontrol edin.
- Seed zamanı: `SELECT min(created_at) FROM public._dummy_seed;`

## Durum

- [x] Yüklendi: 2026-10-16 09:58 (TR). Önce dry-run ve seed+cleanup gidiş-dönüş testi yapıldı (tablo sayıları eşit, `employees` değişmedi).
  - shift_assignments 1020 · attendance_records 681 · leave_requests 218 (195'i haftalık tatil) · manual_time_correction_requests 23 · open_shifts 15 · shift_swap_requests 9 · employee_availability 14 · notifications 439 · audit_logs 35
- [ ] Temizlendi: —

> Not: 16 Ekim'den sonraki dummy vardiyaların devam kaydı yok. Günler geçtikçe bu vardiyalar uygulamada "giriş yapılmadı" olarak görünecek; alarm taraması (`/api/attendance/alerts/scan`) bunlar için bildirim üretebilir. Temizlik bu bildirimleri de siler (`related_id`).
