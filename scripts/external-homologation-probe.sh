#!/usr/bin/env bash
set -euo pipefail

PAGES_BASE_URL="${PAGES_BASE_URL:-https://brunoferreirasalustiano.github.io/lead-finder-demos}"
RENDER_BASE_URL="${RENDER_BASE_URL:-https://lead-finder-api-hml.onrender.com}"
OUTPUT_FILE="${OUTPUT_FILE:-external-homologation-probe.json}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

fetch_required() {
  local name="$1"
  local url="$2"
  local output="$3"
  echo "[probe] fetching ${name}: ${url}"
  curl --fail --silent --show-error --location \
    --retry 4 --retry-all-errors --retry-delay 3 \
    --connect-timeout 20 --max-time 120 \
    --user-agent 'LeadFinderBrasil-HomologationProbe/1.0' \
    "$url" -o "$output"
}

assert_contains() {
  local file="$1"
  local expected="$2"
  local label="$3"
  if ! grep -Fq "$expected" "$file"; then
    echo "[probe] missing expected content: ${label}" >&2
    return 1
  fi
}

assert_absent_regex() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if grep -Eiq "$pattern" "$file"; then
    echo "[probe] forbidden content found: ${label}" >&2
    return 1
  fi
}

HOME_HTML="$WORK_DIR/home.html"
PRIVACY_HTML="$WORK_DIR/privacy.html"
BARBER_HTML="$WORK_DIR/barber.html"

fetch_required "home" "$PAGES_BASE_URL/" "$HOME_HTML"
fetch_required "privacy notice" "$PAGES_BASE_URL/privacidade/" "$PRIVACY_HTML"
fetch_required "barber demo" "$PAGES_BASE_URL/barbearia/" "$BARBER_HTML"

assert_contains "$HOME_HTML" "Lead Finder Brasil" "brand on home"
assert_contains "$PRIVACY_HTML" "Transparência sobre o site e os contatos comerciais." "privacy heading"
assert_contains "$PRIVACY_HTML" "leadfinderbrasil@gmail.com" "privacy contact"
assert_contains "$PRIVACY_HTML" "um número apenas publicado na internet não é considerado autorização" "WhatsApp opt-in rule"
assert_contains "$PRIVACY_HTML" "nenhum link, imagem, PDF, proposta ou preço no primeiro contato sem autorização" "first-contact safeguard"
assert_contains "$PRIVACY_HTML" "O opt-out não exige justificativa" "opt-out rule"
assert_contains "$BARBER_HTML" "Lead Finder Brasil" "brand on barber demo"

for file in "$HOME_HTML" "$PRIVACY_HTML" "$BARBER_HTML"; do
  assert_absent_regex "$file" '<form([[:space:]>])' "HTML form"
  assert_absent_regex "$file" 'google-analytics|googletagmanager|gtag\(|fbq\(|hotjar|clarity\.ms' "tracking script"
done

pages_status="SERVED"
render_live_http="000"
render_ready_http="000"
render_status="UNREACHABLE"
render_live_body="$WORK_DIR/render-live.txt"
render_ready_body="$WORK_DIR/render-ready.txt"

set +e
render_live_http="$(curl --silent --show-error --location \
  --retry 2 --retry-all-errors --retry-delay 3 \
  --connect-timeout 20 --max-time 150 \
  --user-agent 'LeadFinderBrasil-HomologationProbe/1.0' \
  -o "$render_live_body" -w '%{http_code}' "$RENDER_BASE_URL/health/live")"
live_curl_exit=$?
render_ready_http="$(curl --silent --show-error --location \
  --retry 2 --retry-all-errors --retry-delay 3 \
  --connect-timeout 20 --max-time 150 \
  --user-agent 'LeadFinderBrasil-HomologationProbe/1.0' \
  -o "$render_ready_body" -w '%{http_code}' "$RENDER_BASE_URL/health/ready")"
ready_curl_exit=$?
set -e

if [[ "$live_curl_exit" -eq 0 && "$render_live_http" == "200" ]]; then
  if [[ "$ready_curl_exit" -eq 0 && "$render_ready_http" == "200" ]]; then
    render_status="OPERABLE"
  else
    render_status="LIVE_NOT_READY"
  fi
fi

cat > "$OUTPUT_FILE" <<JSON
{
  "pages": {
    "baseUrl": "$PAGES_BASE_URL",
    "status": "$pages_status",
    "privacyNotice": "VERIFIED",
    "tracking": "ABSENT",
    "formCollection": "ABSENT"
  },
  "render": {
    "baseUrl": "$RENDER_BASE_URL",
    "status": "$render_status",
    "liveHttp": "$render_live_http",
    "readyHttp": "$render_ready_http"
  },
  "externalEffects": {
    "providers": false,
    "messages": false,
    "webhooks": false,
    "writes": false
  }
}
JSON

cat "$OUTPUT_FILE"

echo "PAGES_STATUS=$pages_status"
echo "RENDER_STATUS=$render_status"
echo "RENDER_LIVE_HTTP=$render_live_http"
echo "RENDER_READY_HTTP=$render_ready_http"
