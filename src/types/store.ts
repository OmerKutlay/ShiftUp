// Mağaza domain tipleri — çoklu mağaza

export interface Store {
  id: string
  name: string
  active: boolean
  created_at: string
  updated_at: string
}

/** Liste görünümü: aktif çalışan sayısıyla */
export interface StoreWithStats extends Store {
  employee_count: number
}

/** /api/auth/me ile dönen mağaza bağlamı */
export interface StoreContextInfo {
  /** Şu an çalışılan (kapsam) mağaza — admin değiştirebilir, diğerleri için ana mağaza */
  active: Pick<Store, 'id' | 'name'>
  /** Çalışanın kayıtlı olduğu mağaza */
  home_store_id: string
  /** Admin: mağaza değiştirebilir (şirket geneli) */
  can_switch: boolean
}
