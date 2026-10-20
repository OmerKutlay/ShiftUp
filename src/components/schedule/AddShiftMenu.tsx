'use client'

/**
 * AddShiftMenu — "Vardiya ekle" menüsü: gün seçilir (hafta görünümünde alt menü), ardından çalışan.
 * O gün boşta olanlar önce, vardiyası / izni olanlar altta ve açıklamalı listelenir.
 */
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { EmployeeWithRole } from '@/types/employee'
import type { WeeklyScheduleEntry } from '@/types/schedule'
import { PersonAvatar } from '@/components/common'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { fmtRange } from './scheduleHelpers'

interface Props {
  entries: WeeklyScheduleEntry[]
  weekDays: string[]
  /** Tek gün modu: yalnızca bu günün listesi */
  day?: string
  restDayMap: Set<string>
  approvedLeaveMap: Set<string>
  onPick: (emp: EmployeeWithRole, day: string) => void
  children: React.ReactElement
  side?: 'top' | 'bottom'
}

const dayText = (d: string, pattern: string) => format(new Date(`${d}T00:00:00`), pattern, { locale: tr })

function candidates(entries: WeeklyScheduleEntry[], day: string, rest: Set<string>, leave: Set<string>) {
  const list = entries.map((e) => {
    const key = `${e.employee.id}:${day}`
    const a = e.dayAssignments[day]
    const busy = rest.has(key) ? 'Hafta tatili'
      : leave.has(key) || a?.is_on_leave ? 'İzinli'
      : a ? `Vardiyası var · ${fmtRange(a.start_time, a.end_time)}`
      : null
    return { emp: e.employee, busy }
  })
  return [...list.filter((c) => !c.busy), ...list.filter((c) => c.busy)]
}

export function AddShiftMenu({ entries, weekDays, day, restDayMap, approvedLeaveMap, onPick, children, side = 'bottom' }: Props) {
  const list = (d: string) => candidates(entries, d, restDayMap, approvedLeaveMap).map(({ emp, busy }) => (
    <DropdownMenuItem key={emp.id} onSelect={() => onPick(emp, d)} className="gap-2.5">
      <PersonAvatar name={emp.full_name} size={24} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{emp.full_name}</span>
        <span className="truncate text-xs text-muted-foreground">{busy ?? emp.roles?.name ?? 'Boşta'}</span>
      </span>
    </DropdownMenuItem>
  ))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      {day ? (
        <DropdownMenuContent side={side} align="end" className="max-h-[60dvh] w-64 overflow-y-auto">
          <DropdownMenuLabel className="first-letter:uppercase">{dayText(day, 'd MMMM EEEE')} · çalışan seçin</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {list(day)}
        </DropdownMenuContent>
      ) : (
        <DropdownMenuContent side={side} align="end" className="w-56">
          <DropdownMenuLabel>Gün seçin</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {weekDays.map((d) => {
            const free = candidates(entries, d, restDayMap, approvedLeaveMap).filter((c) => !c.busy).length
            return (
              <DropdownMenuSub key={d}>
                <DropdownMenuSubTrigger className="gap-2">
                  <span className="flex-1 first-letter:uppercase">{dayText(d, 'd MMMM EEEE')}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{free} boşta</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-[60dvh] w-64 overflow-y-auto">
                  {list(d)}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )
          })}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}
