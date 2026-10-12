import '@testing-library/jest-dom'
import { afterEach } from 'vitest'
import { mutate } from 'swr'

// SWR'nin genel önbelleği testler arasında taşınmasın (bir testin verisi diğerine sızmasın)
afterEach(async () => {
  await mutate(() => true, undefined, { revalidate: false })
})
