'use client'

/**
 * Kök hata sınırı — root layout / provider'lar çökerse gösterilir.
 * Kendi <html>/<body> etiketini tanımlar; root layout (globals.css / Tailwind) yüklenmeyebileceği
 * için yalnızca satır içi stil kullanır (renkler src/lib/palette.ts ile aynı).
 */
import { RotateCw, Sun } from 'lucide-react'

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
          background: '#F5EFE6',
          color: '#2B211B',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          padding: 16,
        }}
      >
        <title>Hata — ShiftUp</title>
        <main
          role="alert"
          style={{
            width: '100%',
            maxWidth: 384,
            boxSizing: 'border-box',
            background: '#FFFDFA',
            border: '1px solid #ECE4D8',
            borderRadius: 16,
            padding: '32px 24px',
            textAlign: 'center',
          }}
        >
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
              background: '#C2532D',
              color: '#FFFFFF',
              marginBottom: 16,
            }}
          >
            <Sun size={25} strokeWidth={2} />
          </span>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Uygulama yüklenemedi</h1>
          <p style={{ color: '#605853', fontSize: 14, lineHeight: 1.5, margin: '0 0 24px' }}>
            Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin; sorun sürerse yöneticinize bildirin.
            {error.digest && (
              <span style={{ display: 'block', marginTop: 8, fontFamily: 'monospace', fontSize: 12, color: '#8C827A' }}>
                Hata kodu: {error.digest}
              </span>
            )}
          </p>
          <button
            onClick={() => retry()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              width: '100%',
              height: 44,
              background: '#C2532D',
              color: '#FFFFFF',
              border: 0,
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            <RotateCw size={16} aria-hidden />
            Tekrar Dene
          </button>
        </main>
      </body>
    </html>
  )
}
