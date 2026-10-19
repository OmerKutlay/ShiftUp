/**
 * PWA / favicon ikonlarını üretir: kiremit zemin + beyaz güneş (yan menü logosuyla aynı).
 *   node scripts/generate-icons.mjs
 * SVG'ler doğrudan yazılır, PNG'ler Playwright Chromium ile SVG'den render edilir.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const BRAND = '#C2532D' // src/lib/palette.ts → C.brand
const OUT = path.resolve('public')

/** Güneş simgesi: merkez (cx, cy), ölçek s (24px'lik ızgaraya göre) */
function sun(cx, cy, s) {
  const r = 4.2 * s
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4
    const r1 = 7 * s
    const r2 = 9.6 * s
    return `<line x1="${cx + r1 * Math.cos(a)}" y1="${cy + r1 * Math.sin(a)}" x2="${cx + r2 * Math.cos(a)}" y2="${cy + r2 * Math.sin(a)}"/>`
  }).join('')
  return `<g fill="none" stroke="#fff" stroke-width="${1.8 * s}" stroke-linecap="round"><circle cx="${cx}" cy="${cy}" r="${r}"/>${rays}</g>`
}

/** rounded: köşe yuvarlatmalı (any), maskable: tam kare + güvenli alan içinde simge */
function svg(size, { maskable = false } = {}) {
  const rx = maskable ? 0 : Math.round(size * 0.22)
  const scale = (size * (maskable ? 0.5 : 0.56)) / 24
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" rx="${rx}" fill="${BRAND}"/>${sun(size / 2, size / 2, scale)}</svg>\n`
}

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  // iOS kendi köşesini yuvarlar: tam kare
  { file: 'apple-touch-icon.png', size: 180, maskable: true, iconScale: true },
]

fs.writeFileSync(path.join(OUT, 'icon-192.svg'), svg(192))
fs.writeFileSync(path.join(OUT, 'icon-512.svg'), svg(512))

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })
for (const t of targets) {
  const markup = t.iconScale ? svg(t.size).replace(/rx="\d+"/, 'rx="0"') : svg(t.size, { maskable: t.maskable })
  await page.setViewportSize({ width: t.size, height: t.size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup}</body></html>`)
  await page.locator('svg').screenshot({ path: path.join(OUT, t.file), omitBackground: true })
  console.log('✓', t.file)
}
await browser.close()
