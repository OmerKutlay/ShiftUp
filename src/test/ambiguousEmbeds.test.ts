// @vitest-environment node
/**
 * Regresyon: employees tablosuna birden fazla FK'si olan tablolardan yapılan
 * `employees(...)` gömmeleri hangi ilişkinin kullanılacağını belirtmelidir
 * (`employees!employee_id(...)`). Aksi halde PostgREST PGRST201 ("more than one
 * relationship") döner ve route 500 verir. Fake Supabase bu kuralı modellemediği için
 * kaynak kod üzerinden statik olarak denetlenir.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/** employees'a birden fazla FK'si olan tablolar (bkz. migrations) */
const MULTI_FK_TABLES = ['leave_requests', 'shift_swap_requests', 'manual_time_correction_requests']

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []
  )
}

describe('PostgREST gömmeleri', () => {
  it('çok FK’li tablolardan employees gömmesi ilişkiyi açıkça belirtir', () => {
    const offenders: string[] = []
    const root = path.resolve(__dirname, '..')
    for (const file of walk(root).filter((f) => !f.includes(`${path.sep}test${path.sep}`))) {
      const src = fs.readFileSync(file, 'utf8')
      for (const table of MULTI_FK_TABLES) {
        const re = new RegExp(`\\.from\\('${table}'\\)\\s*\\.select\\(\\s*([\`'])([\\s\\S]*?)\\1`, 'g')
        let m: RegExpExecArray | null
        while ((m = re.exec(src))) {
          // "employees (" veya "alias:employees (" — "!" ile ilişki belirtilmemiş
          if (/(^|[\s,:])employees\s*\(/.test(m[2])) {
            offenders.push(`${path.relative(root, file)} → ${table}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
