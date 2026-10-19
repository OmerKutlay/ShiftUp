#!/usr/bin/env bash
# ShiftUp — Web Push kurulumu (tek komut, tekrar çalıştırılabilir)
#
# Yaptıkları:
#   1. VAPID anahtarları + webhook secret üretir (ilk çalıştırmada; .push-keys.local'da saklanır)
#   2. Supabase Edge Function secret'larını ayarlar
#   3. send-push Edge Function'ını deploy eder
#   4. Cloudflare Worker'a VAPID_PUBLIC_KEY ekler
#   5. Push migration'larını + Vault secret'larını veritabanına uygular ve migration geçmişine kaydeder
#      (README'deki geçmiş uyarısı nedeniyle `db push` KULLANILMAZ)
#
# Önkoşullar (bir kez):
#   npx supabase login            # veya SUPABASE_ACCESS_TOKEN
#   npx wrangler login            # veya CLOUDFLARE_API_TOKEN
#   export SUPABASE_DB_URL='postgresql://postgres.<ref>:<şifre>@<host>:5432/postgres'
#     (Supabase panel › Connect › "Session pooler" bağlantı dizesi; psql gerekir)
#   SUPABASE_DB_URL yoksa 5. adım için SQL dosyası üretilir — SQL Editor'e yapıştırın.
#
# Kullanım:  bash scripts/setup-push.sh
# Seçenekler (ortam değişkeni):
#   SUPABASE_PROJECT_REF   (varsayılan: wrangler.jsonc'deki URL'den)
#   WORKER_NAME            (varsayılan: shiftup)
#   PUSH_CONTACT_EMAIL     (VAPID iletişim adresi; varsayılan: git config user.email)
#   ROTATE_KEYS=1          (yeni anahtar üret — mevcut tüm abonelikler geçersiz olur)
set -euo pipefail

cd "$(dirname "$0")/.."

KEYS_FILE=".push-keys.local"
MIGRATIONS=(20261016100000_push_subscriptions 20261017100000_push_diagnostics)
WORKER_NAME="${WORKER_NAME:-shiftup}"

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok() { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v node >/dev/null || fail "node bulunamadı"
command -v npx >/dev/null || fail "npx bulunamadı"

# ── Proje bilgisi ──────────────────────────────────────────────
if [[ -z "${SUPABASE_PROJECT_REF:-}" ]]; then
  SUPABASE_PROJECT_REF="$(grep -oE 'https://[a-z0-9]+\.supabase\.co' wrangler.jsonc | head -1 | sed -E 's#https://([a-z0-9]+)\.supabase\.co#\1#')"
fi
[[ -n "$SUPABASE_PROJECT_REF" ]] || fail "SUPABASE_PROJECT_REF belirlenemedi"
FUNCTION_URL="https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/send-push"
CONTACT="${PUSH_CONTACT_EMAIL:-$(git config user.email 2>/dev/null || true)}"
[[ -n "$CONTACT" ]] || fail "PUSH_CONTACT_EMAIL verin (ör. PUSH_CONTACT_EMAIL=destek@firma.com)"
ok "Supabase projesi: $SUPABASE_PROJECT_REF · Worker: $WORKER_NAME · iletişim: $CONTACT"

# ── 1. Anahtarlar ──────────────────────────────────────────────
step "1/5 VAPID anahtarları"
if [[ -f "$KEYS_FILE" && "${ROTATE_KEYS:-0}" != "1" ]]; then
  # shellcheck disable=SC1090
  source "$KEYS_FILE"
  ok "Mevcut anahtarlar kullanılıyor ($KEYS_FILE)"
else
  json="$(npx -y web-push@3.6.7 generate-vapid-keys --json)"
  VAPID_PUBLIC_KEY="$(node -e 'console.log(JSON.parse(process.argv[1]).publicKey)' "$json")"
  VAPID_PRIVATE_KEY="$(node -e 'console.log(JSON.parse(process.argv[1]).privateKey)' "$json")"
  PUSH_WEBHOOK_SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  umask 077
  cat > "$KEYS_FILE" <<EOF
# ShiftUp push anahtarları — GİZLİ, repoya eklemeyin (.gitignore'da)
VAPID_PUBLIC_KEY='$VAPID_PUBLIC_KEY'
VAPID_PRIVATE_KEY='$VAPID_PRIVATE_KEY'
PUSH_WEBHOOK_SECRET='$PUSH_WEBHOOK_SECRET'
EOF
  ok "Yeni anahtarlar üretildi ve $KEYS_FILE dosyasına kaydedildi"
fi

# ── 2. Edge Function secret'ları ───────────────────────────────
step "2/5 Supabase Edge Function secret'ları"
npx -y supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" \
  "VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY" \
  "VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY" \
  "VAPID_SUBJECT=mailto:$CONTACT" \
  "PUSH_WEBHOOK_SECRET=$PUSH_WEBHOOK_SECRET"
ok "Secret'lar ayarlandı"

# ── 3. Edge Function deploy ────────────────────────────────────
step "3/5 send-push Edge Function deploy"
npx -y supabase functions deploy send-push --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt
ok "send-push deploy edildi → $FUNCTION_URL"

# ── 4. Cloudflare ──────────────────────────────────────────────
step "4/5 Cloudflare Worker: VAPID_PUBLIC_KEY"
printf '%s' "$VAPID_PUBLIC_KEY" | npx -y wrangler secret put VAPID_PUBLIC_KEY --name "$WORKER_NAME"
ok "VAPID_PUBLIC_KEY Worker'a eklendi"

# ── 5. Veritabanı ──────────────────────────────────────────────
step "5/5 Veritabanı: migration'lar + Vault"
SQL_FILE="$(mktemp -t shiftup-push-XXXXXX.sql)"
{
  for m in "${MIGRATIONS[@]}"; do
    f="supabase/migrations/$m.sql"
    [[ -f "$f" ]] || fail "$f bulunamadı — repoyu güncelleyin (git pull)"
    echo "-- ── $m ──"
    cat "$f"
    echo
  done
  # Vault: varsa güncelle, yoksa oluştur (değerler SQL dosyasında; dosya sonunda silinir)
  cat <<EOF
-- ── Vault secret'ları ──
DO \$\$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'push_function_url';
  IF v_id IS NULL THEN PERFORM vault.create_secret('$FUNCTION_URL', 'push_function_url');
  ELSE PERFORM vault.update_secret(v_id, '$FUNCTION_URL'); END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = 'push_webhook_secret';
  IF v_id IS NULL THEN PERFORM vault.create_secret('$PUSH_WEBHOOK_SECRET', 'push_webhook_secret');
  ELSE PERFORM vault.update_secret(v_id, '$PUSH_WEBHOOK_SECRET'); END IF;
END
\$\$;
SELECT public.push_diagnostics() AS push_diagnostics;
EOF
} > "$SQL_FILE"

versions=()
for m in "${MIGRATIONS[@]}"; do versions+=("${m%%_*}"); done

if [[ -n "${SUPABASE_DB_URL:-}" ]] && command -v psql >/dev/null; then
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$SQL_FILE"
  rm -f "$SQL_FILE"
  ok "Migration'lar ve Vault secret'ları uygulandı"
  npx -y supabase migration repair --status applied "${versions[@]}" --db-url "$SUPABASE_DB_URL" \
    && ok "Migration geçmişine kaydedildi" \
    || warn "Geçmiş kaydı başarısız — elle: npx supabase migration repair --status applied ${versions[*]}"
else
  OUT="push-setup.local.sql"
  mv "$SQL_FILE" "$OUT"
  chmod 600 "$OUT"
  warn "SUPABASE_DB_URL veya psql yok — SQL dosyası üretildi: $OUT"
  warn "Supabase panel › SQL Editor'e yapıştırıp çalıştırın, ardından dosyayı silin (secret içerir)."
  warn "Sonra: npx supabase migration repair --status applied ${versions[*]} --linked"
fi

cat <<EOF

$(ok "Kurulum tamamlandı")
Sonraki adımlar:
  1. Telefonda uygulamayı ANA EKRANDAN açın (iPhone'da şart) › Daha fazla › Bildirimler: Aç
  2. Bir çalışan izin talebi oluştursun; uygulamayı arka plana alıp bildirimi bekleyin
  3. Sorun olursa: Daha fazla › Bildirim tanılama (Mağaza Müdürü+) hangi adımın eksik olduğunu gösterir

$KEYS_FILE dosyasını güvenli bir yerde yedekleyin; kaybolursa ROTATE_KEYS=1 ile yeniden
üretilir ama tüm cihazların bildirimleri yeniden açması gerekir.
EOF
