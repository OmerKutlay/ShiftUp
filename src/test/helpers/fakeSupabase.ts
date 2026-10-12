/**
 * fakeSupabase — testler için bellek içi, tablo bazlı Supabase query builder.
 *
 * Çağrı sırasına bağlı mock zincirleri yerine gerçek filtre semantiği uygular;
 * böylece route'un iç sorgu sırası değişse de testler kırılmaz.
 *
 * Desteklenen: select/insert/update/upsert/delete, eq/neq/in/gt/gte/lt/lte/is/not.is,
 * order/limit/range, single/maybeSingle, count+head, rpc (opsiyonel handler).
 * Join'ler (nested select) uygulanmaz — gerekiyorsa satıra nested alan önceden konur.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>
type Filter = (r: Row) => boolean

export interface FakeDbOptions {
  /** tablo → benzersiz olması gereken kolon grupları (ihlalde 23505) */
  unique?: Record<string, string[][]>
  /** tablo/operasyon için zorla hata döndür: { 'employees:select': { message } } */
  failOn?: Record<string, { message: string; code?: string }>
  /** rpc handler'ları */
  rpc?: Record<string, (args: any, db: FakeDb) => { data?: any; error?: any } | Promise<{ data?: any; error?: any }>>
}

let idSeq = 0
function newId() {
  idSeq++
  return `00000000-0000-4000-8000-${String(idSeq).padStart(12, '0')}`
}

class Query implements PromiseLike<{ data: any; error: any; count?: number | null }> {
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  private filters: Filter[] = []
  private payload: any
  private onConflict?: string
  private ignoreDuplicates = false
  private mode: 'many' | 'single' | 'maybe' = 'many'
  private returning = false
  private countMode = false
  private head = false
  private orderBy: { col: string; asc: boolean }[] = []
  private limitN?: number
  private rangeFrom?: number

  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op !== 'select') this.returning = true
    if (opts?.count) this.countMode = true
    if (opts?.head) this.head = true
    return this
  }
  insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this }
  upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = 'upsert'; this.payload = Array.isArray(rows) ? rows : [rows]
    this.onConflict = opts?.onConflict; this.ignoreDuplicates = !!opts?.ignoreDuplicates
    return this
  }
  update(patch: Row) { this.op = 'update'; this.payload = patch; return this }
  delete() { this.op = 'delete'; return this }

  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this }
  in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(r[c])); return this }
  gt(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] > v); return this }
  gte(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] >= v); return this }
  lt(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] < v); return this }
  lte(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] <= v); return this }
  is(c: string, v: any) { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this }
  not(c: string, op: string, v: any) {
    if (op === 'is') this.filters.push((r) => (v === null ? r[c] != null : r[c] !== v))
    else if (op === 'in') {
      const list = String(v).replace(/[()]/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''))
      this.filters.push((r) => !list.includes(String(r[c])))
    } else this.filters.push((r) => r[c] !== v)
    return this
  }
  or(_expr: string) { return this }
  order(col: string, opts?: { ascending?: boolean }) { this.orderBy.push({ col, asc: opts?.ascending !== false }); return this }
  limit(n: number) { this.limitN = n; return this }
  range(from: number, to: number) { this.rangeFrom = from; this.limitN = to - from + 1; return this }
  single() { this.mode = 'single'; return this }
  maybeSingle() { this.mode = 'maybe'; return this }
  abortSignal() { return this }

  then<T1 = any, T2 = never>(
    onfulfilled?: ((value: { data: any; error: any; count?: number | null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return Promise.resolve().then(() => this.exec()).then(onfulfilled, onrejected)
  }

  private match(r: Row) { return this.filters.every((f) => f(r)) }

  private finish(rows: Row[]) {
    let out = rows.map((r) => ({ ...r }))
    for (const { col, asc } of [...this.orderBy].reverse()) {
      out.sort((a, b) => (a[col] === b[col] ? 0 : (a[col] > b[col] ? 1 : -1) * (asc ? 1 : -1)))
    }
    if (this.rangeFrom) out = out.slice(this.rangeFrom)
    if (this.limitN !== undefined) out = out.slice(0, this.limitN)
    const count = this.countMode ? out.length : null
    if (this.head) return { data: null, error: null, count }
    if (this.mode === 'single') {
      if (out.length !== 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, count }
      return { data: out[0], error: null, count }
    }
    if (this.mode === 'maybe') {
      if (out.length > 1) return { data: null, error: { message: 'multiple rows', code: 'PGRST116' }, count }
      return { data: out[0] ?? null, error: null, count }
    }
    return { data: out, error: null, count }
  }

  private violatesUnique(row: Row, ignoreRow?: Row): boolean {
    const groups = this.db.options.unique?.[this.table] ?? []
    const rows = this.db.tables[this.table] ?? []
    return groups.some((cols) =>
      rows.some((r) => r !== ignoreRow && cols.every((c) => r[c] != null && r[c] === row[c]))
    )
  }

  private exec() {
    const fail = this.db.options.failOn?.[`${this.table}:${this.op}`]
    if (fail) return { data: null, error: fail, count: null }
    const rows = (this.db.tables[this.table] ??= [])
    const now = new Date().toISOString()

    switch (this.op) {
      case 'select':
        return this.finish(rows.filter((r) => this.match(r)))
      case 'insert': {
        const created: Row[] = []
        for (const p of this.payload as Row[]) {
          const row = { id: newId(), created_at: now, updated_at: now, ...p }
          if (this.violatesUnique(row)) {
            return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' }, count: null }
          }
          rows.push(row)
          created.push(row)
        }
        return this.returning ? this.finishRows(created) : { data: null, error: null, count: null }
      }
      case 'upsert': {
        const keys = this.onConflict?.split(',').map((s) => s.trim()) ?? ['id']
        const out: Row[] = []
        for (const p of this.payload as Row[]) {
          const existing = rows.find((r) => keys.every((k) => r[k] === p[k]))
          if (existing) {
            if (!this.ignoreDuplicates) { Object.assign(existing, p, { updated_at: now }); out.push(existing) }
          } else {
            const row = { id: newId(), created_at: now, updated_at: now, ...p }
            rows.push(row); out.push(row)
          }
        }
        return this.returning ? this.finishRows(out) : { data: null, error: null, count: null }
      }
      case 'update': {
        const targets = rows.filter((r) => this.match(r))
        for (const t of targets) {
          const next = { ...t, ...this.payload }
          if (this.violatesUnique(next, t)) {
            return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' }, count: null }
          }
        }
        targets.forEach((t) => Object.assign(t, this.payload, { updated_at: now }))
        return this.returning ? this.finishRows(targets) : { data: null, error: null, count: null }
      }
      case 'delete': {
        const targets = rows.filter((r) => this.match(r))
        this.db.tables[this.table] = rows.filter((r) => !targets.includes(r))
        return this.returning ? this.finishRows(targets) : { data: null, error: null, count: null }
      }
    }
  }

  private finishRows(rows: Row[]) {
    // insert/update/delete + select: filtreler zaten uygulandı, sadece mod/sıralama
    const saved = this.filters
    this.filters = []
    const res = this.finish(rows)
    this.filters = saved
    return res
  }
}

export class FakeDb {
  tables: Record<string, Row[]>
  options: FakeDbOptions
  auth = {
    admin: {
      updateUserById: async () => ({ data: {}, error: null }),
      deleteUser: async () => ({ data: {}, error: null }),
      signOut: async () => ({ data: {}, error: null }),
      getUserById: async () => ({ data: { user: null }, error: null }),
      createUser: async () => ({ data: { user: { id: newId() } }, error: null }),
      listUsers: async () => ({ data: { users: [] }, error: null }),
    },
  }

  constructor(tables: Record<string, Row[]> = {}, options: FakeDbOptions = {}) {
    this.tables = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]))
    this.options = options
  }

  from(table: string) {
    return new Query(this, table)
  }

  async rpc(name: string, args: any) {
    const h = this.options.rpc?.[name]
    if (!h) return { data: null, error: { message: `rpc ${name} not mocked` } }
    const r = await h(args, this)
    return { data: r.data ?? null, error: r.error ?? null }
  }
}

export function createFakeDb(tables: Record<string, Row[]> = {}, options: FakeDbOptions = {}) {
  return new FakeDb(tables, options)
}
