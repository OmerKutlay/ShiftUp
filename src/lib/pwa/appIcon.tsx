/**
 * appIcon — PWA / ana ekran ikonlarının PNG üretimi (next/og ImageResponse).
 * public/icon-*.svg tasarımının aynısı; iOS ve bazı Android kurulumları SVG kabul etmez.
 *
 * maskable: Android uyarlanabilir ikon maskesi kenarları kırpar → içerik güvenli
 * bölgede (merkezdeki %80) kalacak şekilde tam taşan arka planla çizilir.
 */
import { ImageResponse } from 'next/og'

export function renderAppIcon(size: number, { maskable = false } = {}) {
  const radius = maskable ? 0 : Math.round(size * 0.17)
  const inset = Math.round(size * (maskable ? 0.18 : 0.083))
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          borderRadius: radius,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: inset,
            left: inset,
            right: inset,
            bottom: inset,
            borderRadius: Math.round(size * 0.125),
            background: 'rgba(20,184,166,0.15)',
          }}
        />
        <div
          style={{
            fontSize: Math.round(size * (maskable ? 0.34 : 0.42)),
            fontWeight: 700,
            color: '#14b8a6',
            lineHeight: 1,
          }}
        >
          S
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: { 'Cache-Control': 'public, max-age=604800, immutable' },
    }
  )
}
