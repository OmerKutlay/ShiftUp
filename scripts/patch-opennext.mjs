/**
 * patch-opennext — @opennextjs/cloudflare 1.20.x ile Next.js 16.4 uyumsuzluğunu giderir.
 *
 * Next 16.4 her istekte `.next/server/preview-props.json` okur; adaptör yalnızca
 * `*-manifest.json` vb. dosyaları Worker'a gömdüğü için tüm dinamik route'lar
 * "Unexpected loadManifest(/.next/server/preview-props.json) call!" ile 500 döner.
 * Upstream düzeltme: opennextjs/opennextjs-cloudflare#1356 / #1428 (henüz yayınlanmadı).
 *
 * Adaptör güncellenip düzeltme geldiğinde aranan metin bulunmaz ve betik hiçbir şey yapmaz;
 * o zaman bu dosya ve package.json'daki çağrısı kaldırılabilir.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const file = fileURLToPath(
  new URL('../node_modules/@opennextjs/cloudflare/dist/cli/build/patches/plugins/load-manifest.js', import.meta.url)
)
const before = '{*-manifest,required-server-files,prefetch-hints}.json'
const after = '{*-manifest,required-server-files,prefetch-hints,preview-props}.json'

const src = readFileSync(file, 'utf8')
if (src.includes(after)) {
  console.log('[patch-opennext] zaten uygulanmış')
} else if (src.includes(before)) {
  writeFileSync(file, src.replace(before, after))
  console.log('[patch-opennext] preview-props.json loadManifest glob\'una eklendi')
} else {
  console.log('[patch-opennext] hedef bulunamadı (adaptör güncellenmiş olabilir) — atlandı')
}
