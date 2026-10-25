import type { NextConfig } from "next";
import { execSync } from "node:child_process";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy — yalnızca kendi origin'i + Supabase.
 * Bileşenlerdeki satır içi style değerleri ve Next.js satır içi hydration script'i yüzünden
 * 'unsafe-inline' gerekir; harici script / bağlantı kaynakları yine de engellenir.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co${isDev ? " ws: http://localhost:*" : ""}`,
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/**
 * Build kimliği — Service Worker sürümü (src/app/sw.js/route.ts) buradan gelir; her deploy'da
 * değişir ki tarayıcı yeni SW'yi kursun ve eski cache'leri temizlesin. Cloudflare Workers Builds
 * WORKERS_CI_COMMIT_SHA verir; yerelde git SHA, git de yoksa yalnızca zaman damgası kullanılır.
 * Zaman damgası eklenir: aynı commit'in yeniden deploy'u da (ör. bağımlılık güncellemesi) yeni sürümdür.
 */
function resolveBuildId(): string {
  let sha = process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "";
  if (!sha) {
    try {
      sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      sha = "";
    }
  }
  const stamp = Date.now().toString(36);
  return sha ? `${sha.slice(0, 12)}-${stamp}` : stamp;
}

const nextConfig: NextConfig = {
  // Build anında koda gömülür (process.env.APP_BUILD_ID) — izlenen dosya değiştirilmez
  env: {
    APP_BUILD_ID: resolveBuildId(),
  },
  // Cache Components (ve ona bağlı keep-alive / partialPrefetching) kapalı: Cloudflare Workers'ta
  // (OpenNext) staged render workerd üzerinde askıda kalıyor ve sayfalar 500 dönüyor.
  // Bkz. vercel/next.js#94880, opennextjs/opennextjs-cloudflare#1318 — düzeltme yayınlanınca tekrar açılabilir.
  // Kapalıyken sayfalar arası geçişte filtre/scroll state'i korunmaz; veri SWR önbelleğinden gelir.
  cacheComponents: false,
  partialPrefetching: false,
  experimental: {
    // İstemci router önbelleği: ziyaret edilen / önceden yüklenen sayfa 30 dk sunucuya gitmeden açılır
    // (dynamic varsayılanı 0 — her geçişte Worker + oturum kontrolü ve "Yükleniyor…" ekranı).
    // Sayfalar client bileşeni; veri SWR'dan gelir ve geri dönüşte arka planda tazelenir.
    // Çıkış / oturum düşmesi tam sayfa yüklemesi yaptığından önbellek kullanıcılar arasında taşınmaz.
    staleTimes: { dynamic: 1800, static: 1800 },
    // API route'larındaki try/catch'lerin yakalayıp logladığı prerender bail-out gürültüsünü gizler
    hideLogsAfterAbort: true,
  },
  // Cloudflare quick tunnel üzerinden dev sunucusuna erişim (HMR + client JS)
  allowedDevOrigins: ["*.trycloudflare.com"],
  // FAZ 8: Güvenlik başlıkları + FAZ 11: PWA headers
  //
  // DİKKAT (Cloudflare / OpenNext): wrangler.jsonc'de `assets.run_worker_first` yok → public/
  // altındaki dosyalar (manifest.json, sw-push.js, ikonlar) Workers static assets tarafından Worker
  // ÇALIŞMADAN sunulur; bu headers() ve middleware onlara UYGULANMAZ (bkz. @opennextjs/cloudflare
  // dist/api/overrides/asset-resolver: "When run_worker_first is false, the assets are served
  // directly bypassing Next routing"). Bu dosyaların başlıkları public/_headers'ta tanımlıdır;
  // aşağıdaki public dosya girdileri yalnızca `next dev` / `next start` içindir.
  // /sw.js route handler olduğundan Worker'dan geçer; buradaki başlıklar ona uygulanır.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Clickjacking koruması
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // MIME type sniffing koruması
          { key: "X-Content-Type-Options", value: "nosniff" },
          // İçerik kaynak politikası
          { key: "Content-Security-Policy", value: csp },
          // HTTPS zorunluluğu (yalnızca HTTPS yanıtlarında tarayıcı tarafından dikkate alınır)
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // Referrer bilgisi kısıtla
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Kamera + konum izinleri yalnızca kendi origin için
          {
            key: "Permissions-Policy",
            value: "camera=(self), geolocation=(self), microphone=()",
          },
        ],
      },
      {
        // API rotaları için ek güvenlik — CORS sadece same-origin
        source: "/api/(.*)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
      {
        // Service Worker — no-cache (her deploy'da güncel SW)
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Content-Type", value: "application/javascript" },
        ],
      },
      {
        // Push handler'ları — ana SW importScripts ile yükler; değişiklik hemen görünsün
        source: "/sw-push.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Content-Type", value: "application/javascript" },
        ],
      },
      {
        // Web App Manifest
        source: "/manifest.json",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
    ];
  },
};

export default nextConfig;
