import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy — yalnızca kendi origin'i + Supabase.
 * MUI (emotion) satır içi <style>, Next.js satır içi hydration script'i ürettiği için
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

const nextConfig: NextConfig = {
  // Keep-alive: sayfalar arası geçişte son ziyaret edilen rotalar unmount edilmek yerine
  // React <Activity mode="hidden"> ile saklanır; geri dönüldüğünde state (yüklenmiş veri,
  // filtreler, scroll) korunur. Effect'ler yeniden çalıştığı için veri arka planda tazelenir.
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // API route'larındaki try/catch'lerin yakalayıp logladığı prerender bail-out gürültüsünü gizler
    hideLogsAfterAbort: true,
  },
  // Cloudflare quick tunnel üzerinden dev sunucusuna erişim (HMR + client JS)
  allowedDevOrigins: ["*.trycloudflare.com"],
  // FAZ 8: Güvenlik başlıkları + FAZ 11: PWA headers
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
