import '@testing-library/jest-dom'
import { afterEach } from 'vitest'
import { mutate } from 'swr'

// SWR'nin genel önbelleği testler arasında taşınmasın (bir testin verisi diğerine sızmasın)
afterEach(async () => {
  await mutate(() => true, undefined, { revalidate: false })
})

// jsdom'da olmayan, Radix Select'in kullandığı DOM API'leri
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
}

// Radix RadioGroup / Switch / Checkbox boyut ölçümü için (jsdom'da yok)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// jsdom'da matchMedia yok (tema: prefers-color-scheme); testler kendi sahtesini kurabilir
if (typeof window !== 'undefined') {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
