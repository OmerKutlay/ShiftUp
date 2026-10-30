#!/usr/bin/env node
/**
 * set-admin-password — bir adminin giriş şifresini komut satırından belirler.
 *
 * Admin girişi (/login/admin) e-posta kodundan önce admin şifresi ister; şifresi olmayan admin
 * giriş yapamaz. İlk şifre bu script ile belirlenir, sonrakiler Ayarlar › Admin girişi'nden.
 *
 * Kullanım (kendi terminalinizde — şifre ekrana yazılmaz):
 *   node scripts/set-admin-password.mjs ad.soyad@ornek.com
 *
 * .env.local'daki NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SECRET_KEY kullanılır (hangi veritabanını
 * gösteriyorsa o güncellenir). Şifre yalnızca bcrypt özeti olarak saklanır.
 */
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createClient } from '@supabase/supabase-js'

const MIN_LENGTH = 10
const MAX_BYTES = 72

function loadEnv(file) {
  const env = {}
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  } catch {
    /* dosya yok — ortam değişkenlerine bakılır */
  }
  return env
}

/** Girilen karakterleri göstermeden bir satır okur */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(question)
    }
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

function fail(message) {
  console.error(`Hata: ${message}`)
  process.exit(1)
}

const email = process.argv[2]?.trim().toLowerCase()
if (!email || !email.includes('@')) fail('Kullanım: node scripts/set-admin-password.mjs <admin e-postası>')

const env = { ...loadEnv('.env.local'), ...process.env }
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SECRET_KEY
if (!url || !key) fail('.env.local içinde NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SECRET_KEY olmalı.')

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const { data: employee, error } = await db
  .from('employees')
  .select('id, full_name, active, roles ( access_level )')
  .eq('email', email)
  .maybeSingle()
if (error) fail(error.message)
const role = Array.isArray(employee?.roles) ? employee.roles[0] : employee?.roles
if (!employee || !employee.active || role?.access_level !== 'admin') fail(`${email} aktif bir admin değil.`)

console.log(`${employee.full_name} (${email}) için admin şifresi belirleniyor — ${new URL(url).host}`)
const password = await askHidden('Yeni şifre: ')
if (password.length < MIN_LENGTH) fail(`Şifre en az ${MIN_LENGTH} karakter olmalı.`)
if (Buffer.byteLength(password, 'utf8') > MAX_BYTES) fail('Şifre çok uzun (en fazla 72 bayt).')
if (password.trim() !== password) fail('Şifre boşlukla başlayıp bitemez.')
if ((await askHidden('Yeni şifre (tekrar): ')) !== password) fail('Şifreler eşleşmiyor.')

const { error: rpcError } = await db.rpc('set_admin_password', {
  p_employee_id: employee.id,
  p_password: password,
  p_actor_id: null,
})
if (rpcError) fail(rpcError.message)
console.log('Admin şifresi kaydedildi. Giriş adresi: /login/admin')
