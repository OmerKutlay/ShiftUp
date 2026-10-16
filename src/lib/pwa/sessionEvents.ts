/**
 * sessionEvents — Oturum kapanmadan önce çalışacak istemci tarafı temizlik kancaları.
 *
 * PWA modülleri (push aboneliği, çevrimdışı önbellek vb.) AuthContext'e doğrudan bağımlı
 * olmadan çıkış anında temizlik yapabilsin diye kullanılır. Kancalar logout isteğinden ÖNCE
 * çalışır (oturum hâlâ geçerliyken API çağrısı yapılabilir); hata veren kanca çıkışı engellemez.
 */
type BeforeSignOutHook = () => void | Promise<void>

const hooks = new Set<BeforeSignOutHook>()

/** Çıkıştan önce çalışacak kancayı kaydeder; kaydı silen fonksiyonu döner. */
export function onBeforeSignOut(hook: BeforeSignOutHook): () => void {
  hooks.add(hook)
  return () => {
    hooks.delete(hook)
  }
}

/** Kayıtlı tüm kancaları paralel çalıştırır; en fazla `timeoutMs` bekler. */
export async function runBeforeSignOut(timeoutMs = 3000): Promise<void> {
  if (hooks.size === 0) return
  const all = Promise.allSettled([...hooks].map((hook) => Promise.resolve().then(hook)))
  await Promise.race([all, new Promise((resolve) => setTimeout(resolve, timeoutMs))])
}
