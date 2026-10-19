// @vitest-environment node
/**
 * MUI → shadcn geçişi boyunca renkler iki yerde: src/lib/palette.ts (MUI / sx) ve
 * src/app/globals.css (Tailwind). İkisi birbirinden kaymasın.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { C } from '@/lib/palette'

const css = fs.readFileSync(path.resolve(__dirname, '../app/globals.css'), 'utf8')
const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
// palette.ts adı → globals.css değişkeni (yalnızca adı farklı olanlar)
const RENAMED: Record<string, string> = { border: 'line' }

describe('palette ↔ globals.css', () => {
  for (const [key, hex] of Object.entries(C)) {
    if (key === 'white') continue
    const name = RENAMED[key] ?? kebab(key)
    it(`--${name} = ${hex}`, () => {
      const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)
      expect(m?.[1].toLowerCase()).toBe(hex.toLowerCase())
    })
  }
})
