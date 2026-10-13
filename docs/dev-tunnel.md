# Gerçek Telefonla QR Testi (Cloudflare Tunnel)

> Yalnızca geliştirme içindir. `AUTH_MODE=development` tünel üzerinden gerçek kullanıcılara açılmamalıdır.

Localde çalışan uygulamayı telefonda test etmek için Cloudflare Tunnel kullanın.
**Bu sadece geliştirme amaçlıdır — production deployment değildir.**

### Adım 1 — cloudflared binary'yi indirin (tek seferlik)

Proje klasöründe bir kez çalıştırın:

```powershell
Invoke-WebRequest `
  -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
  -OutFile "cloudflared.exe"
```

İndirme tamamlandığında şunu görmelisiniz:

```
cloudflared.exe   ~53 MB
```

Doğrulamak için:

```powershell
.\cloudflared.exe --version
# cloudflared version 2026.x.x ...
```

---

### Adım 2 — Geliştirme sunucusunu başlatın

**Yeni bir terminal açın** ve çalıştırın:

```powershell
npm run dev
```

Çıktıdan portu not edin:

```
▲ Next.js 16.x.x
- Local: http://localhost:3004   ← bu port numarasını not edin
```

> Port 3000 meşgulse Next.js otomatik başka bir port seçer (3001, 3002 ... 3004 gibi).

---

### Adım 3 — Tunnel'ı açın ve URL'yi alın

**İkinci bir terminal açın** ve aşağıdaki komutu çalıştırın.
`3004` yazan yeri bir önceki adımda not ettiğiniz port numarasıyla değiştirin:

```powershell
.\cloudflared.exe tunnel --protocol http2 --url http://localhost:3004
```

Birkaç saniye sonra terminalde şu kutuyu görürsünüz:

```
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
|  https://xxxx-xxxx-xxxx-xxxx.trycloudflare.com                                             |
+--------------------------------------------------------------------------------------------+
```

**`https://xxxx-xxxx-xxxx-xxxx.trycloudflare.com`** satırındaki URL sizin tunnel adresinizdir.
Bu URL'yi kopyalayın — telefonda bu adresi kullanacaksınız.

> ⚠️ Her tunnel başlatmada URL değişir. `cloudflared.exe` kapatılınca eski URL geçersiz olur.

---

### Adım 4 — QR Test Senaryosu

#### PC tarafı (admin/kiosk):

1. Tarayıcıdan şu adrese gidin (tunnel URL'nizi kullanın):
   ```
   https://xxxx-xxxx-xxxx-xxxx.trycloudflare.com/qr-kiosk
   ```
2. Kiosk rolündeki hesapla (veya Müdür Yardımcısı+) giriş yapın — QR tek kullanımlıktır, okutulunca yenisi Realtime Broadcast ile gelir
3. QR kodu ekranda görünür (her 10 sn ve her okutmadan sonra yenilenir)

#### Telefon tarafı (çalışan):

4. Telefon tarayıcısında şu adrese gidin:
   ```
   https://xxxx-xxxx-xxxx-xxxx.trycloudflare.com/attendance/scan
   ```
   > **Safari:** İlk açılışta Cloudflare "güvenlik uyarısı" çıkabilir. Sayfanın altındaki
   > küçük linke tıklayarak devam edin.

5. Çalışan hesabıyla giriş yapın, işlemi seçin → **kameraya izin verin**

6. PC ekranındaki QR kodu telefon kamerasıyla okutun

7. QR okunduktan sonra ekranda **"GPS Konumu Alınıyor"** loading ekranı çıkar — telefonu indirip bekleyin, kamerayı tutmaya devam etmenize gerek yok

8. Konum izni penceresi açılırsa **"İzin Ver"** seçin

9. ✅ `Giriş başarılı — HH:MM` mesajı görünür

---

### Safari / iOS Konum İzni

Safari'de konum "İzin Ver" seçmiş olsanız bile hata alıyorsanız:

**Yöntem 1 — Adres çubuğundan:**
1. Adres çubuğundaki **AA** harflerine dokunun
2. **Site Ayarları** → **Konum** → **İzin Ver**
3. Sayfayı yenileyin (`Yenile` tuşuna basın)

**Yöntem 2 — Sistem Ayarlarından:**
1. iPhone **Ayarlar** → **Gizlilik ve Güvenlik** → **Konum Servisleri**
2. **Safari** → **Uygulamayı Kullanırken**

**Yöntem 3 — Safari Ayarlarından:**
1. iPhone **Ayarlar** → **Uygulamalar** → **Safari** → **Konum** → **Sor**

---

### Önemli Notlar

| Konu | Durum |
|------|-------|
| HTTPS | ✅ Cloudflare otomatik sağlar — mixed-content sorunu yok |
| CORS | ✅ Same-origin (tunnel frontend + API aynı domain) |
| Konum (GPS) | ✅ HTTPS zorunluluğu Cloudflare ile karşılanıyor |
| QR içeriği | Relative path değil — QR payload içinde URL yok, sadece token |
| Tunnel süresi | Geçici — process kapatılınca tunnel sona erer, URL değişir |
| Rate limit | Kiosk QR okuma: 60/saat (yalnızca açılış ve yeniden bağlanma), okutma: 30 işlem/dakika (çalışan başına) |

