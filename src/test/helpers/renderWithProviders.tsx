/**
 * Bileşen testleri için ortak render: onay diyaloğu + her test için izole SWR önbelleği
 * (dedupe kapalı) — bir testin verisi/isteği diğerine sızmaz.
 */
import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { ConfirmProvider } from '@/components/common/ConfirmDialog'

export function renderWithProviders(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </SWRConfig>
  )
}
