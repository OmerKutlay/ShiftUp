'use client'

import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

/**
 * İstemcide hidrasyon tamamlandı mı? Sunucuda ve ilk istemci render'ında false.
 * Statik olarak önceden render edilen sayfalarda "şu an"a bağlı metinler (selamlama, bugünün
 * tarihi) build anında sabitlenmesin ve hidrasyon uyuşmazlığı olmasın diye yalnızca true iken gösterilir.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false)
}
