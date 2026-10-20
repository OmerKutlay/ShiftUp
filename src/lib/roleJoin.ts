/**
 * roleJoin — employees → roles join'inin ortak okuyucuları.
 * PostgREST to-one join'i obje ya da tek elemanlı dizi döndürebilir; ikisini de karşılar.
 */

type MaybeArray<T> = T | T[] | null | undefined

export function unwrapJoin<T>(v: MaybeArray<T>): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

/** Çalışanın sistem rolü adı (gösterim) — satırın `roles` join'inden */
export function roleNameOf(row: { roles?: MaybeArray<{ name?: string | null }> } | null | undefined): string | null {
  return unwrapJoin(row?.roles)?.name ?? null
}
