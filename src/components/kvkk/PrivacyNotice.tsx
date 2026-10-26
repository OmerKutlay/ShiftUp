/**
 * PrivacyNotice — "Çalışan Kişisel Verilerinin İşlenmesine İlişkin Aydınlatma Metni" (KVKK m.10).
 *
 * Saf bileşen (sunucuda da istemcide de render edilir). Veri sorumlusu bilgisi Ayarlar › KVKK'dan gelir;
 * girilmemiş alanlar köşeli parantezli yer tutucuyla görünür. Metin, uygulamanın gerçek veri akışını
 * anlatır (bkz. README "Güvenlik modeli"); hukuki yeterlilik şirketin hukuk müşavirince gözden
 * geçirilmelidir.
 *
 * Önemli olgular: biyometrik veri işlenmez; konum yalnızca QR okutulduğu anda alınır, sürekli izleme
 * yoktur ve ham koordinat saklanmaz (yalnızca mağazaya uzaklık / doğruluk değeri).
 */
import { KVKK_NOTICE_VERSION, resolveCompany, type CompanySettings } from '@/lib/kvkk'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

const ul = 'list-disc space-y-1 pl-5'

export function PrivacyNotice({ company }: { company?: Partial<CompanySettings> | null }) {
  const c = resolveCompany(company)
  return (
    <article className="flex flex-col gap-6 text-sm leading-relaxed" data-testid="privacy-notice">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Çalışan Kişisel Verilerinin İşlenmesine İlişkin Aydınlatma Metni
        </h1>
        <p className="text-muted-foreground">
          6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) m.10 kapsamında hazırlanmıştır. Sürüm: {KVKK_NOTICE_VERSION}
        </p>
        <p className="text-muted-foreground">
          Bu metin bir bilgilendirmedir; açık rıza metni değildir ve onayınız aranmaz.
        </p>
      </header>

      <Section title="1. Veri sorumlusu">
        <p>
          Kişisel verileriniz, veri sorumlusu sıfatıyla <strong>{c.legal_name}</strong> ({c.address}) tarafından, ShiftUp
          vardiya ve devam takip uygulaması aracılığıyla aşağıda açıklanan çerçevede işlenir.
        </p>
      </Section>

      <Section title="2. İşlenen kişisel veriler">
        <ul className={ul}>
          <li><strong>Kimlik:</strong> ad soyad, doğum tarihi.</li>
          <li><strong>İletişim:</strong> e-posta adresi (giriş kodu bu adrese gönderilir).</li>
          <li>
            <strong>Çalışma bilgileri:</strong> görev/rol, mağaza, çalışma tipi (tam/yarı zamanlı), işe giriş tarihi,
            vardiya planı, izin, vardiya takası ve mesai düzeltme talepleri, fazla çalışma onay tarihi.
          </li>
          <li>
            <strong>Devam kayıtları:</strong> giriş, mola ve çıkış zamanları ve bu işlemin nasıl doğrulandığı (QR / QR + konum).
          </li>
          <li>
            <strong>Konum (yalnızca QR okutulduğu anda):</strong> telefonunuzun o an bildirdiği konum, mağazada
            bulunduğunuzu doğrulamak için sunucuda mağaza konumuyla karşılaştırılır. Veritabanında enlem/boylam
            (ham koordinat) <em>saklanmaz</em>; yalnızca mağazaya uzaklık (metre) ve konum doğruluğu (metre) değerleri
            devam kaydıyla birlikte tutulur. Konumunuz sürekli veya arka planda takip edilmez.
          </li>
          <li>
            <strong>Cihaz / bildirim bilgileri:</strong> anlık bildirimi açarsanız tarayıcı bildirim adresi ve
            anahtarları ile cihazın tarayıcı bilgisi (user-agent).
          </li>
          <li>
            <strong>İşlem güvenliği:</strong> giriş kodu istemlerinde istek sınırlama için IP adresi ve e-posta adresi
            (kısa süreli sayaç olarak), hassas işlemlerde kim/ne zaman/ne yaptığını gösteren denetim kaydı.
          </li>
        </ul>
        <p>
          <strong>Biyometrik veri (yüz, parmak izi vb.) işlenmez.</strong> Uygulama özel nitelikli kişisel veri
          toplamak üzere tasarlanmamıştır.
        </p>
      </Section>

      <Section title="3. Kişisel verilerin toplanma yöntemi">
        <p>Kişisel verileriniz şu yollarla toplanır:</p>
        <ul className={ul}>
          <li>Kimlik, iletişim ve çalışma bilgileriniz mağaza yöneticileri tarafından uygulamaya girilir.</li>
          <li>Vardiya, izin, takas, mesai düzeltme talebi ve devam kayıtları, uygulamadaki kendi işlemlerinizle oluşur.</li>
          <li>
            Cihazınızdan veya isteğinizden otomatik olarak toplanır: konum (yalnızca QR okuttuğunuz anda), güvenlik için IP
            adresi, bildirim açtıysanız bildirim adresi ve anahtarları.
          </li>
        </ul>
      </Section>

      <Section title="4. İşleme amaçları">
        <ul className={ul}>
          <li>Vardiya planlaması, çalışma sürelerinin ve fazla mesainin takibi, puantaj ve ücret hesabına esas kayıtların tutulması.</li>
          <li>Giriş/çıkış kaydının gerçekten mağazada yapıldığının doğrulanması ve başkası adına okutmanın önlenmesi.</li>
          <li>İzin, vardiya takası ve mesai düzeltme süreçlerinin yürütülmesi; vardiya ve onay bildirimlerinin iletilmesi.</li>
          <li>Uygulama güvenliğinin sağlanması, kötüye kullanımın ve yetkisiz erişimin önlenmesi, denetim izinin tutulması.</li>
          <li>İş mevzuatından doğan yükümlülüklerin yerine getirilmesi ve olası uyuşmazlıklarda hakların korunması.</li>
        </ul>
      </Section>

      <Section title="5. Hukuki sebepler">
        <p>Verileriniz açık rızaya dayanılmadan, KVKK m.5/2 kapsamında şu sebeplerle işlenir:</p>
        <ul className={ul}>
          <li>
            <strong>m.5/2-c:</strong> iş sözleşmesinin kurulması ve ifası için gerekli olması (vardiya, izin, devam takibi
            ve giriş/çıkış zamanlarının doğru kaydı).
          </li>
          <li>
            <strong>m.5/2-f:</strong> çalışanın temel hak ve özgürlüklerine zarar vermemek kaydıyla veri sorumlusunun meşru
            menfaati (giriş/çıkış zamanlarının doğruluğu, mağazada bulunma doğrulaması, güvenlik, denetim izi).
          </li>
          <li>
            <strong>m.5/2-ç:</strong> veri sorumlusunun hukuki yükümlülüğü — 4857 sayılı İş Kanunu m.41 ve Fazla Çalışma
            Yönetmeliği uyarınca çalışma süreleri ile fazla çalışma kayıtlarının tutulması.
          </li>
        </ul>
        <p>
          İş ilişkisinde taraflar arasındaki güç dengesizliği nedeniyle konum ve devam verisi için rızanız istenmez ve
          bu verilerin işlenmesi rızanıza bağlı değildir.
        </p>
      </Section>

      <Section title="6. Verilerin aktarıldığı taraflar">
        <p>
          Verileriniz, yetkileri ölçüsünde mağaza yöneticileri ve şirket yönetimi ile paylaşılır; yasal talep halinde yetkili
          kamu kurumlarına aktarılabilir. Uygulamanın barındırılması için şu hizmet sağlayıcılar (veri işleyen) kullanılır:
        </p>
        <ul className={ul}>
          <li><strong>Supabase</strong> — veritabanı, kimlik doğrulama ve e-posta ile giriş kodu altyapısı.</li>
          <li><strong>Cloudflare</strong> — uygulamanın barındırılması ve ağ güvenliği (Workers).</li>
          <li>Tarayıcı/işletim sistemi bildirim servisleri — yalnızca bildirimi açtıysanız.</li>
        </ul>
        <p>
          Bu hizmet sağlayıcıların sunucuları yurt dışında bulunabilir. Altyapı sağlayıcılarına aktarım, 7499 sayılı Kanunla
          değiştirilen (1 Haziran 2024 tarihinde yürürlüğe giren) KVKK m.9&apos;daki mekanizmalara dayanılarak yapılır:
          yeterlilik kararı, standart sözleşme gibi uygun güvenceler veya arızi aktarım istisnaları.
        </p>
      </Section>

      <Section title="7. Saklama süreleri">
        <ul className={ul}>
          <li>Devam, vardiya ve izin kayıtları: iş ilişkisi süresince ve ilgili mevzuattaki zamanaşımı/saklama süreleri boyunca (şirket belirler).</li>
          <li>Konum: ham koordinat saklanmaz; uzaklık/doğruluk değeri ait olduğu devam kaydıyla aynı süre saklanır.</li>
          <li>İstek sınırlama sayaçları (IP/e-posta): yalnızca kısa pencere boyunca (dakikalar) tutulur.</li>
          <li>Bildirim abonelikleri: bildirimi kapatana veya cihaz geçersiz olana kadar.</li>
          <li>Denetim kayıtları: güvenlik ve hukuki hak tesisi amacıyla, değiştirilemez biçimde (şirket politikasındaki süre kadar).</li>
          <li>Süre sonunda veriler silinir, yok edilir veya anonim hale getirilir.</li>
        </ul>
      </Section>

      <Section title="8. Haklarınız (KVKK m.11)">
        <ul className={ul}>
          <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme ve işlenmişse buna ilişkin bilgi talep etme,</li>
          <li>İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,</li>
          <li>Yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme,</li>
          <li>Eksik veya yanlış işlenmişse düzeltilmesini isteme,</li>
          <li>Eksik veya yanlış işlenmiş verilerin düzeltilmesinin, ayrıca KVKK m.7 çerçevesinde silinmesini veya yok edilmesini isteme ve bu işlemlerin verilerin aktarıldığı üçüncü kişilere bildirilmesini isteme,</li>
          <li>İşlenen verilerin otomatik sistemlerle analiz edilmesi sonucu aleyhinize bir sonuç çıkmasına itiraz etme,</li>
          <li>Kanuna aykırı işleme nedeniyle zarara uğramanız halinde zararın giderilmesini talep etme.</li>
        </ul>
      </Section>

      <Section title="9. Başvuru yöntemi">
        <p>
          Haklarınıza ilişkin taleplerinizi yazılı olarak <strong>{c.address}</strong> adresine veya{' '}
          <strong>{c.kvkk_email}</strong> e-posta adresine iletebilirsiniz. Başvurunuz en geç 30 gün içinde ücretsiz
          sonuçlandırılır; işlemin ayrıca maliyet gerektirmesi halinde Kurul tarifesindeki ücret alınabilir. Başvurunuzun
          yanıtından memnun kalmamanız halinde Kişisel Verileri Koruma Kurumu&apos;na şikâyet hakkınız saklıdır.
        </p>
      </Section>
    </article>
  )
}
