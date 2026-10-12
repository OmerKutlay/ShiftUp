import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
          // XSS filtresi (eski tarayıcılar)
          { key: "X-XSS-Protection", value: "1; mode=block" },
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
