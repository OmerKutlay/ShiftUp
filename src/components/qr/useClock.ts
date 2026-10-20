'use client'

/**
 * useClock — İstanbul saatiyle canlı saat ("14:32") ve uzun tarih ("20 Ekim Salı").
 * Sunucuda ve hydration sırasında boş döner (saat yalnızca istemcide okunur); saniyede bir
 * kontrol edilir ama yalnızca dakika değişince yeniden render olur (snapshot string karşılaştırılır).
 */
import { useSyncExternalStore } from 'react'

const TZ = 'Europe/Istanbul'
const timeFmt = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
const dateFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', timeZone: TZ })

function subscribe(callback: () => void) {
  const id = window.setInterval(callback, 1000)
  return () => window.clearInterval(id)
}

function getSnapshot(): string {
  const now = new Date()
  return `${timeFmt.format(now)}|${dateFmt.format(now)}`
}

const getServerSnapshot = () => ''

export function useClock(): { time: string; date: string } | null {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  if (!snap) return null
  const [time, date] = snap.split('|')
  return { time, date }
}
