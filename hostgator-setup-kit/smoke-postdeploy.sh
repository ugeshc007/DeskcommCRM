#!/usr/bin/env bash
# Smoke leve depois do deploy. Nao imprime token, credencial nem resposta com dados.
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
source "$KIT_DIR/_common.sh"
enter_project

BASE_URL="${SMOKE_BASE_URL:-${NEXT_PUBLIC_APP_URL:-}}"
[ -n "$BASE_URL" ] || die "Defina NEXT_PUBLIC_APP_URL no .env ou SMOKE_BASE_URL no ambiente."
BASE_URL="${BASE_URL%/}"

probe_status() { curl -sS -o "$2" -w '%{http_code}' --max-time 20 "$1"; }
expect_page() {
  local label="$1" url="$2" out code
  out="$(mktemp)"; code="$(probe_status "$url" "$out")" || { rm -f "$out"; die "$label nao respondeu."; }
  rm -f "$out"
  case "$code" in 200|302|303|307|308) ;; *) die "$label respondeu HTTP $code." ;; esac
  c_grn "✓ $label respondeu HTTP $code"
}

step "Smoke pos-deploy"
expect_page "Entrada/login do CRM" "$BASE_URL/"

health="$(mktemp)"
code="$(probe_status "$BASE_URL/api/v1/health" "$health")" || { rm -f "$health"; die "Health publico nao respondeu."; }
case "$code" in 200|503) ;; *) rm -f "$health"; die "Health respondeu HTTP $code." ;; esac
grep -Eq '"supabase"[[:space:]]*:[[:space:]]*\{[[:space:]]*"status"[[:space:]]*:[[:space:]]*"ok"' "$health" || { rm -f "$health"; die "Supabase nao esta ok no health."; }
grep -Eq '"waha"[[:space:]]*:[[:space:]]*\{[[:space:]]*"status"[[:space:]]*:[[:space:]]*"ok"' "$health" || { rm -f "$health"; die "WhatsApp/WAHA nao esta ok no health."; }
rm -f "$health"
c_grn "✓ health do CRM e WhatsApp respondem"

# Sem token, a prova e de borda: a API deve recusar, nunca cair em 5xx. Com um
# token de dispositivo de staging, prova tambem a leitura autenticada sem
# colocar o segredo em argumento, URL, log ou arquivo.
mobile_out="$(mktemp)"
if [ -n "${FIELD_SALES_DEVICE_TOKEN:-}" ]; then
  today="$(date -u +%F)"
  mobile_code="$(curl -sS -o "$mobile_out" -w '%{http_code}' --max-time 20 \
    -H "Authorization: Bearer ${FIELD_SALES_DEVICE_TOKEN}" \
    "$BASE_URL/api/v1/field-sales/mobile?from=$today&through=$today")" || mobile_code=000
  [ "$mobile_code" = 200 ] || { rm -f "$mobile_out"; die "Field Sales autenticado respondeu HTTP $mobile_code."; }
  c_grn "✓ Field Sales mobile autenticado responde"
else
  mobile_code="$(curl -sS -o "$mobile_out" -w '%{http_code}' --max-time 20 "$BASE_URL/api/v1/field-sales/mobile")" || mobile_code=000
  [ "$mobile_code" = 401 ] || { rm -f "$mobile_out"; die "Borda Field Sales esperava 401 e recebeu HTTP $mobile_code."; }
  c_grn "✓ Field Sales mobile recusa acesso sem chave"
fi
rm -f "$mobile_out"

expect_page "Live View / Field Sales" "$BASE_URL/app/field-sales"
c_grn "✓ smoke pos-deploy concluido"
