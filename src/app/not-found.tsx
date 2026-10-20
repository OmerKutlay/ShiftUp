import type { Metadata } from 'next'
import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

export const metadata: Metadata = {
  title: 'Sayfa bulunamadı',
}

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center p-4">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileQuestion aria-hidden />
          </EmptyMedia>
          <p className="text-sm font-medium text-muted-foreground tabular-nums">404</p>
          <EmptyTitle>
            <h1>Sayfa bulunamadı</h1>
          </EmptyTitle>
          <EmptyDescription>
            Aradığınız sayfa taşınmış, silinmiş ya da hiç var olmamış olabilir. Adresi kontrol edin veya ana sayfaya dönün.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link href="/my-schedule">Ana sayfaya dön</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
