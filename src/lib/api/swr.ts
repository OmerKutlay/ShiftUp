/**
 * SWR yapılandırması — client bileşenlerinin ortak veri çekme katmanı.
 *
 * - Anahtar bazlı önbellek: aynı veri birden çok bileşende tek istekle paylaşılır,
 *   hızlı gezinmede (ör. hafta değiştirme) eski isteğin yanıtı yenisinin üstüne yazamaz.
 * - Sekmeye geri dönülünce tazeleme; gizli sekmede periyodik yenileme durur.
 */
import type { SWRConfiguration } from 'swr'
import { apiFetch } from './http'

/** Anahtar URL ise doğrudan GET eder */
export const apiFetcher = <T,>(url: string) => apiFetch<T>(url)

export const swrConfig: SWRConfiguration = {
  fetcher: apiFetcher,
  revalidateOnFocus: true,
  // Odak tazelemesi en fazla dakikada bir: mobilde uygulamalar arası her geçiş ekrandaki tüm
  // anahtarları aynı anda yeniden çekiyordu (her biri ayrı Worker isteği → CPU sınırı, 1102)
  focusThrottleInterval: 60_000,
  refreshWhenHidden: false,
  dedupingInterval: 2000,
  errorRetryCount: 2,
  keepPreviousData: true,
}
