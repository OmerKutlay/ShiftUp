/**
 * clientErrors — tarayıcı hatasını sunucu günlüğüne (app_errors) bildirir.
 * Sessizdir (asla fırlatmaz); aynı mesaj sayfa ömründe bir kez, toplamda en çok 5 kez gönderilir.
 */
const sent = new Set<string>()

export function reportClientError(source: string, error: unknown): void {
  try {
    if (typeof window === 'undefined' || sent.size >= 5) return
    const e = error as { message?: unknown; stack?: unknown } | null
    const message = typeof e?.message === 'string' && e.message ? e.message : String(error)
    if (sent.has(message)) return
    sent.add(message)
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify({
        source,
        message: message.slice(0, 500),
        stack: typeof e?.stack === 'string' ? e.stack.slice(0, 4000) : undefined,
        url: window.location.pathname,
      }),
    }).catch(() => {})
  } catch {
    // bildirim hatası kullanıcıyı etkilememeli
  }
}
