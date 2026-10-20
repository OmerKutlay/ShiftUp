import { LOADING_LABEL } from '@/components/common'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'

// Route geçişlerinde (AppShell korunurken) içerik alanında gösterilir. Hedef sayfanın düzeni
// bilinmediği için sayfa iskeleti taklit edilmez; sayfalar kendi Skeleton'larını gösterir.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label={LOADING_LABEL} className="flex min-h-[60dvh] items-center justify-center p-4">
      <Empty className="animate-in fade-in-0 duration-300">
        <EmptyHeader>
          <EmptyMedia>
            <Spinner className="size-6 text-muted-foreground" aria-hidden />
          </EmptyMedia>
          <EmptyDescription>Yükleniyor…</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
