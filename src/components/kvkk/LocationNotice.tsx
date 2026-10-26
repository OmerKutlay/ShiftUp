import Link from 'next/link'
import { MapPin } from 'lucide-react'
import { PRIVACY_PATH } from '@/lib/kvkk'

/**
 * QR okutma ekranında ilk konum isteğinden önce gösterilen kısa açıklama (KVKK m.10 aydınlatma).
 * Taramayı engellemez; yalnızca neden konum istendiğini söyler ve tam metne bağlar.
 */
export function LocationNotice({ className }: { className?: string }) {
  return (
    <p className={className ?? 'flex items-start justify-center gap-1.5 pt-1 text-center text-xs text-muted-foreground'}>
      <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        Konumunuz yalnızca QR okuttuğunuz anda, mağazada olduğunuzu doğrulamak için istenir; sürekli takip edilmez ve
        koordinatlar saklanmaz.{' '}
        <Link href={PRIVACY_PATH} prefetch={false} className="underline underline-offset-2 hover:text-foreground">
          Aydınlatma metni
        </Link>
      </span>
    </p>
  )
}
