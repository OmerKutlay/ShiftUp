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
