'use client'

/**
 * Kök hata sınırı — root layout / provider'lar çökerse gösterilir.
 * Kendi <html>/<body> etiketini tanımlar; MUI teması yüklenmeyebileceği için
 * yalnızca satır içi stil kullanır (uygulamanın koyu temasıyla uyumlu renkler).
 */
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
          background: '#0f172a',
          color: '#e2e8f0',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          padding: 16,
        }}
      >
        <title>Hata — ShiftUp</title>
        <main role="alert" style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Uygulama yüklenemedi</h1>
          <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.5, margin: '0 0 24px' }}>
            Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin; sorun sürerse yöneticinize bildirin.
            {error.digest && (
              <span style={{ display: 'block', marginTop: 8, fontFamily: 'monospace', fontSize: 12 }}>
                Hata kodu: {error.digest}
              </span>
            )}
          </p>
          <button
            onClick={() => retry()}
            style={{
              background: '#14b8a6',
              color: '#042f2e',
              border: 0,
              borderRadius: 8,
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Tekrar Dene
          </button>
        </main>
      </body>
    </html>
  )
}
