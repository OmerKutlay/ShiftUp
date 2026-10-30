/**
 * download — tarayıcıda üretilen ya da sunucudan blob olarak alınan dosyayı indirir.
 * a[href] ile gezinmek hata durumunda ham JSON'a götürür (standalone PWA'da geri dönüş yok); bu yüzden
 * dosyalar her zaman blob + geçici bağlantıyla indirilir.
 */
import { ApiError } from '@/lib/api/http'

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Hemen iptal edilirse bazı tarayıcılar (Safari) indirmeyi başlatamaz
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function saveCsv(csv: string, filename: string): void {
  saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename)
}

/** İndirme hatasının kullanıcıya gösterilecek metni */
export function downloadErrorMessage(err: unknown): string {
  const status = err instanceof ApiError ? err.status : undefined
  if (status === 429) return 'Çok fazla indirme isteği. Lütfen birkaç dakika sonra tekrar deneyin.'
  if (status && status >= 500) return 'Dosya şu an hazırlanamadı. Lütfen tekrar deneyin.'
  return err instanceof Error && err.message ? err.message : 'İndirme başarısız oldu.'
}
