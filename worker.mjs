/**
 * Cloudflare Worker giriş noktası — OpenNext'in ürettiği .open-next/worker.js'i sarar.
 *
 * Neden: OpenNext Next sunucusunu (handler.mjs, ~7 MB) ilk isteğin İÇİNDE
 * `await import(...)` ile yükler. Soğuk başlangıçta bu modülün değerlendirilmesi o isteğin
 * CPU süresine yazılır ve ücretsiz planın 10 ms sınırını aşar → Error 1102. Aşım isolate'i
 * de sonlandırdığı için tekrar deneme yine soğuk başlar; az trafikte hata sürekli görülür.
 *
 * Buradaki statik import modülü Worker BAŞLANGICINDA değerlendirir (başlangıç CPU'su istek
 * CPU'suna sayılmaz, ayrı ve daha geniş bir sınırı vardır). worker.js'teki dinamik import aynı
 * paketteki modülü önbellekten anında döndürür.
 */
import "./.open-next/server-functions/default/handler.mjs";
import worker from "./.open-next/worker.js";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

export default worker;
