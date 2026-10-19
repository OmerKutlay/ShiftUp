/**
 * BrandMark — kiremit kare logo (beyaz güneş). public/icon-*.png ile aynı çizim.
 */
import { Sun } from 'lucide-react'

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center bg-primary text-white"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
    >
      <Sun style={{ width: size * 0.62, height: size * 0.62 }} strokeWidth={2} />
    </span>
  )
}
