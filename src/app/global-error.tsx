'use client'

/**
 * Kök hata sınırı — root layout / provider'lar çökerse gösterilir.
 * Kendi <html>/<body> etiketini tanımlar; root layout (globals.css / Tailwind) yüklenmeyebileceği
 * için yalnızca satır içi stil kullanır. Görünüm shadcn Empty kalıbının aynısı; renkler
 * globals.css'teki stone tema token'larının hex karşılıkları.
 */
import { RotateCw, Sun } from 'lucide-react'

const C = {
  background: '#FFFFFF',
  foreground: '#0C0A09',
  muted: '#F5F5F4',
  mutedForeground: '#78716C',
  border: '#E7E5E4',
  primary: '#C2532D',
  primaryForeground: '#FFFFFF',
}

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: C.background,
          color: C.foreground,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          padding: 24,
          boxSizing: 'border-box',
        }}
      >
        <title>Hata — ShiftUp</title>
        <main
          role="alert"
          style={{
            width: '100%',
            maxWidth: 384,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 24,
            textAlign: 'center',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            {/* BrandMark ile aynı çizim (Tailwind burada yüklü olmayabilir) */}
            <span
              aria-hidden
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 40,
                borderRadius: 11,
                background: C.primary,
                color: C.primaryForeground,
                marginBottom: 8,
              }}
            >
              <Sun size={25} strokeWidth={2} />
            </span>
            <h1 style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em', margin: 0 }}>Uygulama yüklenemedi</h1>
            <p style={{ color: C.mutedForeground, fontSize: 14, lineHeight: 1.6, margin: 0 }}>
              Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin; sorun sürerse yöneticinize bildirin.
            </p>
          </div>
          <button
            onClick={() => retry()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              height: 36,
              padding: '0 16px',
              background: C.primary,
              color: C.primaryForeground,
              border: 0,
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            <RotateCw size={16} aria-hidden />
            Tekrar dene
          </button>
          {error.digest && (
            <p
              style={{
                margin: 0,
                padding: '4px 8px',
                borderRadius: 6,
                border: `1px solid ${C.border}`,
                background: C.muted,
                fontFamily: 'ui-monospace, monospace',
                fontSize: 12,
                color: C.mutedForeground,
              }}
            >
              Hata kodu: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  )
}
