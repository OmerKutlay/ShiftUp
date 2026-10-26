/**
 * storeHeader — sekmenin bildiği aktif mağaza (istemci + sunucu, saf sabitler).
 *
 * Admin aktif mağazayı çerezle seçer; çerez tüm sekmelerde ortaktır. Bir sekmede mağaza
 * değişince diğer sekme hâlâ eski mağazayı gösteriyor olabilir. Yazma istekleri sekmenin
 * mağazasını STORE_HEADER ile gönderir; sunucu (requireAuth) oturumun aktif mağazasıyla
 * eşleşmezse 409 STORE_CHANGED döner ve istek uygulanmaz — kayıt yanlış mağazaya yazılmaz.
 */
export const STORE_HEADER = 'X-Store-Id'
export const STORE_CHANGED_CODE = 'STORE_CHANGED'
/** apiFetch 409 STORE_CHANGED aldığında window'a yayılır; AuthProvider bağlamı yeniler */
export const STORE_CHANGED_EVENT = 'shiftup:store-changed'
/** Sekmeler arası mağaza değişikliği yayını */
export const STORE_BROADCAST_CHANNEL = 'shiftup-store'
