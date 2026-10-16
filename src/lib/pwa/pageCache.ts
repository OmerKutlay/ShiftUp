/**
 * pageCache — Service worker'ın önbelleğe aldığı HTML sayfalarını temizler.
 *
 * SW sayfa gezinmelerini network-first ile önbelleğe alır (çevrimdışı yedek için). Ortak
 * kullanılan cihazda çıkıştan sonra önceki kullanıcının sayfa kabukları (ör. yönetici sayfaları)
 * çevrimdışıyken açılabilmesin diye çıkışta silinir. Veri API'den gelir ve hiç önbelleğe
 * alınmaz; bu bir sıkılaştırmadır. /offline yedek sayfası korunur.
 */
const OFFLINE_PATH = '/offline'

export async function clearCachedPages(): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const names = (await caches.keys()).filter(
      (name) => name.startsWith('shiftup-') && !name.startsWith('shiftup-static-'),
    )
    await Promise.all(
      names.map(async (name) => {
        const cache = await caches.open(name)
        const requests = await cache.keys()
        await Promise.all(
          requests.map(async (request) => {
            if (new URL(request.url).pathname === OFFLINE_PATH) return
            const response = await cache.match(request)
            if (response?.headers.get('content-type')?.includes('text/html')) {
              await cache.delete(request)
            }
          }),
        )
      }),
    )
  } catch {
    /* önbellek erişilemezse çıkış yine de devam etsin */
  }
}
