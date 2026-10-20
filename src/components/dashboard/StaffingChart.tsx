'use client'

/**
 * StaffingChart — "Saatlik kadro": bugünün her saati için planlanan kişi sayısı (vardiya
 * saatlerinden) ve giriş okutmuş, o saatte içeride olan kişi sayısı (giriş/çıkış saatlerinden).
 * Gelecek saatlerde yalnızca plan çizilir.
 */
import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { turkeyDate } from '@/components/daily-attendance/attendanceTime'

export interface StaffingEntry {
  start_time: string
  end_time: string
  clock_in_at: string | null
  clock_out_at: string | null
}

const chartConfig = {
  planned: { label: 'Planlanan', color: 'var(--muted-foreground)' },
  actual: { label: 'İçeride', color: 'var(--chart-1)' },
} satisfies ChartConfig

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const pad = (h: number) => `${String(h % 24).padStart(2, '0')}:00`

export function StaffingChart({ roster, now }: { roster: StaffingEntry[]; now: number }) {
  const { data, nowLabel, plannedNow, actualNow } = useMemo(() => {
    const dayStart = new Date(`${turkeyDate(now)}T00:00:00+03:00`).getTime()
    const minOf = (iso: string | null) => (iso ? (new Date(iso).getTime() - dayStart) / 60_000 : null)
    const nowMin = (now - dayStart) / 60_000
    const shifts = roster.map((r) => {
      const start = toMin(r.start_time)
      let end = toMin(r.end_time)
      if (end <= start) end += 1440
      return { start, end, inAt: minOf(r.clock_in_at), outAt: minOf(r.clock_out_at) }
    })
    if (shifts.length === 0) return { data: [], nowLabel: null, plannedNow: 0, actualNow: 0 }
    const first = Math.floor(Math.min(...shifts.map((s) => s.start)) / 60)
    const last = Math.ceil(Math.max(...shifts.map((s) => s.end)) / 60)
    const rows: Array<{ hour: string; planned: number; actual: number | null }> = []
    for (let h = first; h < last; h++) {
      const from = h * 60
      const to = from + 60
      const planned = shifts.filter((s) => s.start < to && s.end > from).length
      let actual: number | null = null
      if (from <= nowMin) {
        const until = Math.min(to, nowMin)
        actual = shifts.filter((s) => s.inAt !== null && s.inAt < until && (s.outAt ?? nowMin) > from).length
      }
      rows.push({ hour: pad(h), planned, actual })
    }
    const nowHour = Math.floor(nowMin / 60)
    const current = rows.find((r) => r.hour === pad(nowHour))
    return {
      data: rows,
      nowLabel: current ? current.hour : null,
      plannedNow: shifts.filter((s) => s.start <= nowMin && s.end > nowMin).length,
      actualNow: shifts.filter((s) => s.inAt !== null && s.inAt <= nowMin && (s.outAt ?? Infinity) > nowMin).length,
    }
  }, [roster, now])

  return (
    <Card className="flex-1 gap-4 shadow-xs">
      <CardHeader>
        <CardTitle>Saatlik kadro</CardTitle>
        <CardDescription>Bugün her saat planlanan ve içeride olan kişi sayısı</CardDescription>
        {nowLabel && (
          <CardAction className="text-right">
            <div className="text-2xl font-semibold tabular-nums">
              {actualNow}<span className="text-base font-normal text-muted-foreground"> / {plannedNow}</span>
            </div>
            <div className="text-xs text-muted-foreground">şu an içeride</div>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col px-2 sm:px-6">
        {data.length === 0 ? (
          <p className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">Bugün için planlanmış vardiya yok.</p>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto min-h-[240px] w-full flex-1">
            <AreaChart data={data} margin={{ left: -16, right: 8, top: 12 }}>
              <defs>
                <linearGradient id="fillActual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-actual)" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="var(--color-actual)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Area
                dataKey="planned"
                type="step"
                stroke="var(--color-planned)"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                fill="var(--color-planned)"
                fillOpacity={0.08}
                isAnimationActive={false}
              />
              <Area
                dataKey="actual"
                type="step"
                stroke="var(--color-actual)"
                strokeWidth={2}
                fill="url(#fillActual)"
                connectNulls={false}
                isAnimationActive={false}
              />
              {nowLabel && (
                <ReferenceLine
                  x={nowLabel}
                  stroke="var(--primary)"
                  strokeOpacity={0.6}
                  label={{ value: 'Şimdi', position: 'top', fill: 'var(--muted-foreground)', fontSize: 12 }}
                />
              )}
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
