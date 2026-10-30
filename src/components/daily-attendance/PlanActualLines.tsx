'use client'

/**
 * PlanActualLines — mobil kartlarda planlanan ve gerçekleşen saatler, etiketli iki satır:
 * "Plan 08:00–16:00" / "Giriş 07:51 · Çıkış —". Veri eksik olsa da yapı değişmez ("—" ile dolar).
 */
import { clock } from './attendanceTime'
import { ShiftTime } from './ShiftTime'

const LABEL = 'w-9 shrink-0 text-xs text-muted-foreground'

export function PlanActualLines({ start, end, clockIn, clockOut }: {
  start: string
  end: string
  clockIn?: string | null
  clockOut?: string | null
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-center gap-2">
        <span className={LABEL}>Plan</span>
        <ShiftTime start={start} end={end} />
      </div>
      <div className="flex items-center gap-2">
        <span className={LABEL}>Fiili</span>
        <span className="tabular-nums">
          Giriş {clockIn ? clock(clockIn) : '—'} · Çıkış {clockOut ? clock(clockOut) : '—'}
        </span>
      </div>
    </div>
  )
}
