import { renderAppIcon } from '@/lib/pwa/appIcon'

export function GET() {
  return renderAppIcon(512, { maskable: true })
}
