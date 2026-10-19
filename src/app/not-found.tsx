import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'Sayfa Bulunamadı',
}

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center p-4 text-center">
      <p className="text-5xl font-extrabold tracking-tight text-primary">404</p>
      <h1 className="mt-2 text-xl font-bold text-ink">Sayfa bulunamadı</h1>
      <p className="mt-2 mb-6 max-w-[360px] text-sm text-ink-secondary">
        Aradığınız sayfa taşınmış, silinmiş ya da hiç var olmamış olabilir.
      </p>
      <Button asChild>
        <Link href="/my-schedule">Ana Sayfaya Dön</Link>
      </Button>
    </div>
  )
}
