#!/usr/bin/env node
/**
 * Dummy veri çalıştırıcı — canlı Supabase'e Management API ile SQL gönderir.
 *
 *   node scripts/dummy-data/run.mjs seed-dry      # seed'i dener, geri alır, sayıları gösterir
 *   node scripts/dummy-data/run.mjs seed          # seed'i uygular
 *   node scripts/dummy-data/run.mjs seed-yonetici-dry / seed-yonetici
 *                                                 # yalnızca dummy verisi olmayan Yönetici hesaplarına ekler
 *   node scripts/dummy-data/run.mjs status       # _dummy_seed'deki satır sayıları
 *   node scripts/dummy-data/run.mjs cleanup-dry   # temizliği dener, geri alır
 *   node scripts/dummy-data/run.mjs cleanup       # dummy verileri siler
 *
 * Token: mcp.json → mcpServers['supabase-shift-up'].env.SUPABASE_ACCESS_TOKEN
 * (veya SUPABASE_ACCESS_TOKEN ortam değişkeni)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_REF = 'kdafwwshxowyrnwegmhv'
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'mcp.json'), 'utf8'))
  return cfg.mcpServers['supabase-shift-up'].env.SUPABASE_ACCESS_TOKEN
}

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  return { status: res.status, text }
}

const read = (f) => fs.readFileSync(path.join(here, f), 'utf8')

// Dry-run: işlemi sonuna kadar çalıştırıp sayıları hata mesajıyla döndürür → hiçbir şey kalıcı olmaz
const DRY_TAIL = `
DO $$ BEGIN
  RAISE EXCEPTION 'DRY-RUN OK (geri alındı): %',
    (SELECT COALESCE(jsonb_object_agg(tbl, c), '{}'::jsonb) FROM (SELECT tbl, count(*) c FROM public._dummy_seed GROUP BY tbl) x);
END $$;`

const CLEAN_DRY_TAIL = `
DO $$ BEGIN
  RAISE EXCEPTION 'DRY-RUN OK (geri alındı): _dummy_seed kaldırıldı=%', to_regclass('public._dummy_seed') IS NULL;
END $$;`

const mode = process.argv[2]
let sql
switch (mode) {
  case 'seed-dry':    sql = 'BEGIN;\n' + read('seed.sql') + DRY_TAIL; break
  case 'seed':        sql = 'BEGIN;\n' + read('seed.sql') + '\nCOMMIT;'; break
  case 'seed-yonetici-dry': sql = "BEGIN;\nSET LOCAL dummy.mode = 'yonetici';\n" + read('seed.sql') + DRY_TAIL; break
  case 'seed-yonetici':     sql = "BEGIN;\nSET LOCAL dummy.mode = 'yonetici';\n" + read('seed.sql') + '\nCOMMIT;'; break
  case 'status':      sql = "SELECT tbl, count(*) FROM public._dummy_seed GROUP BY tbl ORDER BY tbl"; break
  // replace'e fonksiyon verilir: metin olarak verilen "$$" tek "$"a dönüşürdü
  case 'cleanup-dry': sql = read('cleanup.sql').replace(/COMMIT;\s*$/, () => CLEAN_DRY_TAIL); break
  case 'cleanup':     sql = read('cleanup.sql'); break
  default:
    console.error('Kullanım: node scripts/dummy-data/run.mjs <seed-dry|seed|seed-yonetici-dry|seed-yonetici|status|cleanup-dry|cleanup>')
    process.exit(1)
}

const { status, text } = await query(sql)
console.log(status, text)
if (status >= 400 && !text.includes('DRY-RUN OK')) process.exit(1)
