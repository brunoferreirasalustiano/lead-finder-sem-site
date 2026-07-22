#!/usr/bin/env bash
set -uo pipefail

PAGES_BASE_URL="${PAGES_BASE_URL:-https://brunoferreirasalustiano.github.io/lead-finder-demos}"
RENDER_BASE_URL="${RENDER_BASE_URL:-https://lead-finder-api-hml.onrender.com}"
OUTPUT_FILE="${OUTPUT_FILE:-external-homologation-probe.json}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

errors=()

fetch_page() {
  local name="$1"
  local url="$2"
  local output="$3"
  local http_code
  local exit_code

  echo "[probe] fetching ${name}: ${url}"
  http_code="$(curl --silent --show-error --location \
    --retry 4 --retry-all-errors --retry-delay 3 \
    --connect-timeout 20 --max-time 120 \
    --user-agent 'LeadFinderBrasil-HomologationProbe/1.0' \
    -o "$output" -w '%{http_code}' "$url")"
  exit_code=$?

  if [[ "$exit_code" -ne 0 || "$http_code" != "200" ]]; then
    errors+=("${name}:HTTP_${http_code}:CURL_${exit_code}")
  fi
  printf '%s' "$http_code"
}

require_text() {
  local file="$1"
  local expected="$2"
  local label="$3"
  if [[ ! -f "$file" ]] || ! grep -Fq "$expected" "$file"; then
    errors+=("CONTENT_MISSING:${label}")
  fi
}

forbid_regex() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if [[ -f "$file" ]] && grep -Eiq "$pattern" "$file"; then
    errors+=("FORBIDDEN_CONTENT:${label}")
  fi
}

HOME_HTML="$WORK_DIR/home.html"
PRIVACY_HTML="$WORK_DIR/privacy.html"
BARBER_HTML="$WORK_DIR/barber.html"

home_http="$(fetch_page "home" "$PAGES_BASE_URL/" "$HOME_HTML")"
privacy_http="$(fetch_page "privacy" "$PAGES_BASE_URL/privacidade/" "$PRIVACY_HTML")"
barber_http="$(fetch_page "barber" "$PAGES_BASE_URL/barbearia/" "$BARBER_HTML")"

require_text "$HOME_HTML" "Lead Finder Brasil" "HOME_BRAND"
require_text "$PRIVACY_HTML" "Transparência sobre o site e os contatos comerciais." "PRIVACY_HEADING"
require_text "$PRIVACY_HTML" "leadfinderbrasil@gmail.com" "PRIVACY_CONTACT"
require_text "$PRIVACY_HTML" "um número apenas publicado na internet não é considerado autorização" "WHATSAPP_OPT_IN_RULE"
require_text "$PRIVACY_HTML" "nenhum link, imagem, PDF, proposta ou preço no primeiro contato sem autorização" "FIRST_CONTACT_SAFEGUARD"
require_text "$PRIVACY_HTML" "O opt-out não exige justificativa" "OPT_OUT_RULE"
require_text "$BARBER_HTML" "Lead Finder Brasil" "BARBER_BRAND"

for file in "$HOME_HTML" "$PRIVACY_HTML" "$BARBER_HTML"; do
  forbid_regex "$file" '<form([[:space:]>])' "HTML_FORM"
  forbid_regex "$file" 'google-analytics|googletagmanager|gtag\(|fbq\(|hotjar|clarity\.ms' "TRACKING_SCRIPT"
done

pages_status="SERVED"
if [[ "$home_http" != "200" || "$privacy_http" != "200" || "$barber_http" != "200" ]]; then
  pages_status="UNREACHABLE"
elif ((${#errors[@]} > 0)); then
  pages_status="CONTENT_MISMATCH"
fi

render_live_body="$WORK_DIR/render-live.txt"
render_ready_body="$WORK_DIR/render-ready.txt"
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

render_status="UNREACHABLE"
if [[ "$live_curl_exit" -eq 0 && "$render_live_http" == "200" ]]; then
  if [[ "$ready_curl_exit" -eq 0 && "$render_ready_http" == "200" ]]; then
    render_status="OPERABLE"
  else
    render_status="LIVE_NOT_READY"
  fi
fi

errors_json="[]"
if ((${#errors[@]} > 0)); then
  errors_json="$(printf '%s\n' "${errors[@]}" | node -e '
    let input="";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => console.log(JSON.stringify(input.trim().split(/\n+/).filter(Boolean))));
  ')"
fi

cat > "$OUTPUT_FILE" <<JSON
{
  "pages": {
    "baseUrl": "$PAGES_BASE_URL",
    "status": "$pages_status",
    "homeHttp": "$home_http",
    "privacyHttp": "$privacy_http",
    "barberHttp": "$barber_http",
    "privacyNotice": "$([[ "$pages_status" == "SERVED" ]] && echo VERIFIED || echo UNVERIFIED)",
    "tracking": "$([[ "$pages_status" == "SERVED" ]] && echo ABSENT || echo UNVERIFIED)",
    "formCollection": "$([[ "$pages_status" == "SERVED" ]] && echo ABSENT || echo UNVERIFIED)",
    "errors": $errors_json
  },
  "render": {
    "baseUrl": "$RENDER_BASE_URL",
    "status": "$render_status",
    "liveHttp": "$render_live_http",
    "readyHttp": "$render_ready_http",
    "liveCurlExit": $live_curl_exit,
    "readyCurlExit": $ready_curl_exit
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

if [[ "$pages_status" != "SERVED" ]]; then
  exit 1
fi
