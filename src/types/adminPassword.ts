/** GET /api/admin-passwords satırı — aktif admin ve admin giriş şifresi durumu */
export interface AdminPasswordRow {
  id: string
  full_name: string
  email: string | null
  has_password: boolean
  password_updated_at: string | null
  is_self: boolean
}
