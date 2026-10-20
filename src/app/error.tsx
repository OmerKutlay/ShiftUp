'use client'

/**
 * Segment hata sınırı — bir sayfa render sırasında hata verirse gösterilir.
 * Uygulama kabuğu (menü) çalışmaya devam eder; kullanıcı sayfayı yeniden deneyebilir.
 */
import { useEffect } from 'react'
import Link from 'next/link'
import { CircleAlert, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

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
    <div role="alert" className="flex min-h-[60dvh] items-center justify-center p-4">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive">
            <CircleAlert aria-hidden />
          </EmptyMedia>
          <EmptyTitle>
            <h1>Bir şeyler ters gitti</h1>
          </EmptyTitle>
          <EmptyDescription>
            Sayfa yüklenirken beklenmeyen bir hata oluştu. Tekrar deneyebilir veya ana sayfaya dönebilirsiniz.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => retry()}>
              <RotateCw />
              Tekrar dene
            </Button>
            <Button variant="outline" asChild>
              <Link href="/my-schedule">Ana sayfa</Link>
            </Button>
          </div>
          {error.digest && (
            <p className="font-mono text-xs text-muted-foreground">Hata kodu: {error.digest}</p>
          )}
        </EmptyContent>
      </Empty>
    </div>
  )
}
