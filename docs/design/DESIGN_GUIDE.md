# ShiftUp Tasarım Rehberi

Bu rehber ShiftUp arayüzünün **tek tasarım kaynağıdır**. Yeni bir sayfa yazarken ya da mevcut
bir sayfayı değiştirirken önce buraya bakın; burada olmayan bir desen gerekiyorsa önce rehbere
ekleyin, sonra kodlayın.

Temel ilke: **shadcn/ui'ı olduğu gibi kullan, üstüne az şey ekle.** Bileşenler
`src/components/ui/` altında resmi shadcn v4 (new-york) kaynaklarıdır; görünümleri tema
token'larıyla yönetilir, sayfa içinde sınıf ezilerek yeniden boyanmaz. Uygulamaya özgü
kalıplar (sayfa başlığı, KPI kartı, veri tablosu, durum rozeti…) `src/components/common/`
altındadır ve yalnızca shadcn parçalarını bir araya getirir.

---

## 1. Görsel dil

| Konu | Karar |
|---|---|
| Taban | shadcn **stone** (sıcak nötr): beyaz içerik yüzeyi, açık gri kenar çubuğu, ince kenarlıklar |
| Marka | Kiremit `oklch(0.579 0.152 38.7)` (#C2532D) — **yalnızca** birincil eylem, aktif gezinme, odak halkası ve grafiklerin ilk serisi |
| Yazı tipi | **Geist** (latin-ext). Sayılar her yerde `tabular-nums` |
| Köşe | `--radius: 0.625rem` (shadcn varsayılanı). Kart `rounded-xl`, alan/düğme `rounded-md` |
| Gölge | Yalnızca `shadow-xs` (kart, girdi). Büyük gölge yalnızca açılır katmanlarda |
| Yoğunluk | Masaüstü: düğme/alan `h-9`, tablo satırı `h-12`. Mobil: dokunma hedefi ≥ 44px |
| İkon | lucide, varsayılan `size-4`; gezinmede `size-4`, mobil alt barda `size-5` |

**Yapılmayacaklar:** pastel dolgulu büyük kutular, sayfa içinde elle `style={{ color }}` ile
renk, krem (`canvas`) zemin, `rounded-[14px]` gibi keyfi değerler, `text-[0.72rem]` gibi
keyfi yazı boyutları (Tailwind ölçeği: `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-2xl`).

## 2. Token'lar (`src/app/globals.css`)

shadcn semantik token'ları: `background, foreground, card, popover, primary, secondary, muted,
accent, destructive, border, input, ring, sidebar-*, chart-1..5`.

ShiftUp ekleri (durum renkleri) — **her biri tek renk**, zemin/kenar opaklıkla türetilir:

| Token | Anlam | Kullanım |
|---|---|---|
| `success` | Çalışıyor, onaylandı, tamamlandı | `text-success`, `bg-success/10`, `border-success/30` |
| `warning` | Molada, bekliyor, dikkat | aynı |
| `info` | İzinli, bilgi | aynı |
| `destructive` | Gelmedi, reddedildi, hata | aynı |
| `plum` | Çıkış yaptı, yarı zamanlı | aynı |

Vardiya türleri (planda ve raporlarda): **Açılış** `shift-open` (amber), **Ortacı**
`shift-mid` (gök mavisi), **Kapanış** `shift-close` (mor). Bunlar `SHIFT_KIND_TONES` üzerinden
yalnızca vardiya rozetlerinde kullanılır.

Grafik serileri: `chart-1` marka, `chart-2` yeşil-mavi, `chart-3` mavi, `chart-4` amber,
`chart-5` mor.

## 3. Uygulama kabuğu

### Masaüstü (≥ md)
- shadcn **Sidebar** (`variant="inset"`, `collapsible="icon"`): üstte marka + mağaza adı,
  ortada gruplanmış gezinme (`SidebarGroup` başlıkları: Operasyon, Planlama, Devam ve izin,
  Yönetim), altta kullanıcı menüsü (`NavUser`: ad, rol, Bildirimler, Çıkış).
- İçerik `SidebarInset` içinde: beyaz, yuvarlak köşeli, gölgeli panel.
- **SiteHeader** (h-12, alt kenarlık): `SidebarTrigger` · dikey ayraç · `Breadcrumb`
  (Grup › Sayfa) · sağda bildirim zili.
- Kenar çubuğu durumu çerezde saklanır; `Ctrl/⌘ + B` ile açılır/kapanır.

### Mobil (< md)
- **Üst bar**: `sticky top-0`, **opak** `bg-background` (blur/şeffaflık yok), alt kenarlık,
  `padding-top: env(safe-area-inset-top)`. İçerik: sayfa başlığı (sol), bildirim zili (sağ).
- **Alt bar**: `fixed bottom-0`, opak `bg-background`, üst kenarlık, 5 eşit sütunlu `grid`.
  Her sekme: ikon (`size-5`) + etiket (`text-[11px]` → istisna, tek yer), yükseklik 56px +
  `env(safe-area-inset-bottom)`. Aktif sekme: `text-primary` + ikonun üstünde 2px'lik gösterge.
  Etiketler tek satır, ortalı; ikonlar aynı taban çizgisinde.
- İçerik alt boşluğu = alt bar yüksekliği + safe-area.
- Alt bardaki sekmeler role göre `navItems.getBottomTabs`'tan gelir; diğer sayfalar
  "Daha fazla" sayfasında `Item` listesi olarak gruplanır.

## 4. Sayfa iskeleti

Her sayfa aynı iskeleti kullanır:

```tsx
<Page>                                   // common/Page: @container/main, p-4 md:p-6, gap-4 md:gap-6
  <PageHeader title description actions />
  {/* isteğe bağlı */}
  <Tabs> … </Tabs>                       // alt görünümler
  <StatCards> … </StatCards>             // KPI'lar
  <Card> / <DataTable> / <Item> listesi  // içerik
</Page>
```

- **PageHeader**: `h1` `text-2xl font-semibold tracking-tight`, altında `text-sm
  text-muted-foreground` açıklama; sağda eylemler (birincil eylem `Button` varsayılan, diğerleri
  `outline`). Mobilde eylemler başlığın altına iner, birincil eylem tam genişlik olabilir.
- Okuma/form sayfaları `max-w-3xl`, veri sayfaları tam genişlik.
- Alt görünümler shadcn **Tabs** ile; sekme etiketlerinde sayaç varsa `Badge variant="secondary"`.
  Mobilde `TabsList` yatay kayar.

## 5. Bileşen kuralları

### KPI kartları (`StatCards` / `StatCard`)
shadcn dashboard-01 "SectionCards" kalıbı: `Card` + `CardHeader` (`CardDescription` etiket,
`CardTitle` değer `text-2xl font-semibold tabular-nums @[250px]/card:text-3xl`, isteğe bağlı
`CardAction` içinde trend/durum rozeti) + `CardFooter` (kısa açıklama). Izgara:
`grid-cols-2 @xl/main:grid-cols-2 @5xl/main:grid-cols-4`. Kartlar `bg-gradient-to-t
from-primary/5 to-card shadow-xs`.

### Bölüm kartı
`Card` → `CardHeader` (`CardTitle`, `CardDescription`, `CardAction`) → `CardContent`.
Liste içeren kartlarda içerik `px-0`, satırlar `Item` ve `ItemSeparator` ile.

### Listeler (`Item`)
Kişi/kayıt satırları shadcn **Item**: `ItemMedia` (avatar veya ikon), `ItemContent`
(`ItemTitle` + `ItemDescription`), `ItemActions` (rozet, değer, menü). Tıklanabilir satır
`asChild` ile `Link`.

### Tablolar (`DataTable`)
- Üstte araç çubuğu: arama (`InputGroup` + `Search` ikonu), filtreler (`Select` veya
  `DropdownMenu` checkbox), sağda dışa aktar / görünüm.
- Tablo `rounded-lg border` içinde, başlık `bg-muted` ve yapışkan, satır `hover:bg-muted/50`.
- Sayısal sütunlar sağa yaslı, `tabular-nums`.
- Satır eylemleri sağ uçta `DropdownMenu` (`MoreHorizontal` ikonlu `ghost icon-sm` düğme).
- Altta sayfalama: "N kayıttan 1–20" + önceki/sonraki.
- **Mobilde** tablo yerine aynı veriyi `Item` kartları olarak göster (yatay kaydırmalı tablo
  yalnızca puantaj gibi doğası gereği matris olan ekranlarda).

### Durum rozeti (`StatusBadge`)
`Badge variant="outline"` + solda renkli nokta (`size-1.5 rounded-full bg-{ton}`), metin
`text-muted-foreground`'dan değil `text-foreground`'dan. Tonlar: success, warning, info,
destructive, plum, neutral. Sayaç rozetleri `variant="secondary"`.

### Uyarılar (`Alert`)
shadcn `Alert`: kenarlıklı kart, ikon tonlu. `variant="destructive"` hata; bilgi/uyarı için
`tone` (`info`, `warning`, `success`) yalnızca ikon ve başlık rengini değiştirir. Zemin dolgusu yok.

### Boş durum (`Empty`)
shadcn **Empty**: `EmptyMedia variant="icon"`, `EmptyTitle`, `EmptyDescription`, gerekirse
`EmptyContent` içinde birincil eylem. Kart içindeyse kenarlıksız.

### Formlar
shadcn **Field**: `FieldGroup` > `Field` > `FieldLabel` + kontrol + `FieldDescription` /
`FieldError`. İki sütunlu formlar `grid gap-4 sm:grid-cols-2`. Oluştur/düzenle **Dialog**
içinde (`sm:max-w-lg`, uzun formlar `sm:max-w-2xl`); altta `DialogFooter` (iptal `outline`,
kaydet varsayılan + `Spinner`).

### Geri bildirim
- İşlem sonucu: **Sonner** toast (`toast.success`, `toast.error`).
- Sayfa düzeyinde kalıcı durum: `Alert`.
- Yıkıcı onay: `AlertDialog` (`useConfirm`).
- Yükleniyor: düzeni taklit eden `Skeleton`; düğmede `Spinner`.

### Tarih ve dönem
Tarih seçimi `DateField` (Popover + takvim); hafta/ay gezinmesi `PeriodStepper`
(`ButtonGroup`: ‹ · etiket · ›, yanında "Bugün").

### Grafikler
shadcn **Chart** (`ChartContainer`, `ChartTooltip`) + recharts. Alan/çubuk grafikleri kart
içinde `aspect-auto h-[250px]`. Renkler yalnızca `--chart-*`.

## 6. Metin ve dil

- Türkçe, cümle düzeni büyük harf: "Yeni çalışan", "Haftalık plan" (Başlık Düzeni Değil).
- Saat `09:00–17:00` (en tire, boşluksuz), süre `7s 30d`, tarih `20 Eki Pzt`.
- Boş değer `—`.
- Düğme metni fiil: "Kaydet", "Onayla", "Dışa aktar".

## 7. Erişilebilirlik

- Her ikon-düğmede `aria-label` (veya `sr-only` metin).
- Odak halkası shadcn varsayılanı (`ring-[3px] ring-ring/50`), kaldırılmaz.
- Renk tek başına anlam taşımaz: durum rozetlerinde metin her zaman var.
- Mobil dokunma hedefleri ≥ 44px.

## 8. Yeni sayfa kontrol listesi

- [ ] `Page` + `PageHeader` ile başlıyor, başlık ve açıklama var
- [ ] KPI → `StatCards`, liste → `Item`, tablo → `DataTable`, boş → `Empty`
- [ ] Renk yalnızca token'larla; `style={{}}` yok (grafik ve vardiya rozeti hariç)
- [ ] Yükleniyor / boş / hata durumları tasarlandı
- [ ] 390px genişlikte yatay taşma yok, alt bar içeriği örtmüyor
- [ ] UI stüdyosu ile masaüstü + mobil ekran görüntüsü kontrol edildi
  (`npx playwright test -c scripts/ui-studio/playwright.config.ts`)
