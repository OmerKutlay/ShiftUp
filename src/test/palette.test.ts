// @vitest-environment node
/**
 * palette.ts yalnızca globals.css'teki CSS değişkenlerine başvurur; başvurulan her değişken
 * globals.css'te tanımlı olmalı (renkler tek kaynakta).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { AVATAR_TONES, C, SHIFT_KIND_TONES } from '@/lib/palette'

const css = fs.readFileSync(path.resolve(__dirname, '../app/globals.css'), 'utf8')
const all = JSON.stringify([C, SHIFT_KIND_TONES, AVATAR_TONES])
const vars = [...new Set([...all.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]))]

describe('palette ↔ globals.css', () => {
  it.each(vars)('--%s tanımlı', (name) => {
    expect(css).toMatch(new RegExp(`--${name}:`))
  })
})
