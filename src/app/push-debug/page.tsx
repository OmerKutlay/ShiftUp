import { PushDebugPage } from '@/components/pwa/PushDebugPage'

// GEÇİCİ teşhis sayfası — bildirim sorunu çözülünce kaldırılacak
export const metadata = {
  title: 'Bildirim teşhisi',
}

export default function Page() {
  return <PushDebugPage />
}
