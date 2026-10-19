'use client'

/**
 * Segment hata sınırı — bir sayfa render sırasında hata verirse gösterilir.
 * Uygulama kabuğu (menü) çalışmaya devam eder; kullanıcı sayfayı yeniden deneyebilir.
 */
import { useEffect } from 'react'
import Link from 'next/link'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error('[app/error]', error)
  }, [error])

  return (
    <div className="flex min-h-[60dvh] items-center justify-center p-4">
      <div role="alert" className="w-full max-w-[440px] rounded-2xl border bg-card p-6 text-center md:p-8">
        <span className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-danger-soft text-danger">
          <CircleAlert className="size-7" aria-hidden />
        </span>
        <h1 className="mb-2 text-xl font-bold text-ink">Bir şeyler ters gitti</h1>
        <p className="mb-6 text-sm text-ink-secondary">
          Sayfa yüklenirken beklenmeyen bir hata oluştu. Tekrar deneyebilir veya ana sayfaya dönebilirsiniz.
          {error.digest && (
            <span className="mt-2 block font-mono text-xs">Hata kodu: {error.digest}</span>
          )}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => retry()}>Tekrar Dene</Button>
          <Button variant="outline" asChild>
            <Link href="/my-schedule">Ana Sayfa</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
