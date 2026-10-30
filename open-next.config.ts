import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Sayfalar statik kabuk (veri istemcide API'lerden gelir); ISR / revalidate kullanılmıyor.
// Build'de üretilen HTML/RSC Workers static assets'ten (salt okunur, ücretsiz) okunur ve
// cache interception ile Next render'ına hiç girmeden sunulur (middleware yine önce çalışır):
// - her sayfa isteğinde render CPU'su harcanmaz (ücretsiz planda 10 ms → 1102),
// - Next 16.4 ResponseCache aynı sayfanın bekleyen render'ını istekler arasında paylaşır;
//   Workers'ta kesilen bir isteğin render'ı bitmez ve sonraki istekler sonsuza dek bekler.
// Önbellek `cf:build` içindeki `populateCache local` ile assets'e kopyalanır.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
