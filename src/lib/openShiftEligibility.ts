/**
 * Açık vardiyayı kimin üstlenebileceği — sunucu (üstlenme, bildirim) ve arayüz aynı kuralı kullanır.
 *
 * Gerekli rol boşsa herkes; doluysa yalnızca sistem rolü adı eşleşen çalışan (büyük/küçük harf ve
 * baş/son boşluk duyarsız, Türkçe harf kurallarıyla).
 */
const norm = (s: string) => s.toLocaleLowerCase('tr-TR').trim()

export function matchesRoleNeeded(roleNeeded: string | null | undefined, roleName: string | null | undefined): boolean {
  if (!roleNeeded || !norm(roleNeeded)) return true
  return !!roleName && norm(roleNeeded) === norm(roleName)
}
