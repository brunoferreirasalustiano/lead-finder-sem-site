#!/usr/bin/env bash
set -uo pipefail

PAGES_BASE_URL="${PAGES_BASE_URL:-https://brunoferreirasalustiano.github.io/lead-finder-demos}"
RENDER_BASE_URL="${RENDER_BASE_URL:-https://lead-finder-api-hml.onrender.com}"
OUTPUT_FILE="${OUTPUT_FILE:-external-homologation-probe.json}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

page_errors=()
render_errors=()

fetch_page() {
  local name="$1"
  local url="$2"
  local output="$3"
  local http_code
  local exit_code

  echo "[probe] fetching ${name}: ${url}" >&2
  http_code="$(curl --silent --show-error --location \
    --retry 4 --retry-all-errors --retry-delay 3 \
    --connect-timeout 20 --max-time 120 \
    --user-agent 'LeadFinderBrasil-HomologationProbe/1.0' \
    -o "$output" -w '%{http_code}' "$url")"
  exit_code=$?

  if [[ "$exit_code" -ne 0 || "$http_code" != "200" ]]; then
    page_errors+=("${name}:HTTP_${http_code}:CURL_${exit_code}")
  fi
  printf '%s' "$http_code"
}

require_text() {
  local file="$1"
  local expected="$2"
  local label="$3"
  if [[ ! -f "$file" ]] || ! grep -Fq "$expected" "$file"; then
    page_errors+=("CONTENT_MISSING:${label}")
  fi
}

forbid_form() {
  local file="$1"
  local label="$2"
  if [[ -f "$file" ]] && grep -Eiq '<form([[:space:]>])' "$file"; then
    page_errors+=("FORBIDDEN_FORM:${label}")
  fi
}

forbid_tracking_code() {
  local file="$1"
  local label="$2"
  if [[ ! -f "$file" ]]; then
    return
  fi

  if grep -Eiq '<script[^>]+src=["'"'][^"'"']*(googletagmanager|google-analytics|hotjar|clarity\.ms)' "$file"; then
    page_errors+=("FORBIDDEN_TRACKING_SRC:${label}")
  fi

  if perl -0777 -ne 'exit((/<script\b[^>]*>.*?\b(?:gtag|fbq)\s*\(/si) ? 0 : 1)' "$file"; then
    page_errors+=("FORBIDDEN_TRACKING_INLINE:${label}")
  fi
}

json_array() {
  if (($# == 0)); then
    printf '[]'
    return
  fi
  printf '%s\n' "$@" | node -e '
    let input="";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => console.log(JSON.stringify(input.trim().split(/\n+/).filter(Boolean))));
  '
}

json_status() {
  local file="$1"
  if [[ ! -s "$file" ]]; then
    printf 'INVALID_JSON'
    return
  fi
  node -e '
    const fs = require("fs");
    try {
      const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.stdout.write(typeof value.status === "string" ? value.status : "MISSING_STATUS");
    } catch {
      process.stdout.write("INVALID_JSON");
    }
  ' "$file"
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

forbid_form "$HOME_HTML" "HOME"
forbid_form "$PRIVACY_HTML" "PRIVACY"
forbid_form "$BARBER_HTML" "BARBER"
forbid_tracking_code "$HOME_HTML" "HOME"
forbid_tracking_code "$PRIVACY_HTML" "PRIVACY"
forbid_tracking_code "$BARBER_HTML" "BARBER"

pages_status="SERVED"
if [[ "$home_http" != "200" || "$privacy_http" != "200" || "$barber_http" != "200" ]]; then
  pages_status="UNREACHABLE"
elif ((${#page_errors[@]} > 0)); then
  pages_status="CONTENT_MISMATCH"
fi

render_live_body="$WORK_DIR/render-live.json"
render_ready_body="$WORK_DIR/render-ready.json"
render_snapshot_body="$WORK_DIR/render-snapshot.json"

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

render_snapshot_http="$(curl --silent --show-error --location \
  --connect-timeout 20 --max-time 60 \
  --user-agent 'LeadFinderBrasil-HomologationProbe/1.0' \
  -o "$render_snapshot_body" -w '%{http_code}' "$RENDER_BASE_URL/internal/operational-snapshot")"
snapshot_curl_exit=$?

live_body_status="$(json_status "$render_live_body")"
ready_body_status="$(json_status "$render_ready_body")"

render_status="UNREACHABLE"
if [[ "$live_curl_exit" -eq 0 && "$render_live_http" == "200" ]]; then
  if [[ "$live_body_status" != "ok" ]]; then
    render_errors+=("LIVE_BODY_STATUS:${live_body_status}")
  fi

  if [[ "$ready_curl_exit" -eq 0 && "$render_ready_http" == "200" ]]; then
    if [[ "$ready_body_status" == "ok" || "$ready_body_status" == "degraded" ]]; then
      render_status="OPERABLE"
    else
      render_status="RESPONSE_MISMATCH"
      render_errors+=("READY_BODY_STATUS:${ready_body_status}")
    fi
  else
    render_status="LIVE_NOT_READY"
  fi
fi

if [[ "$snapshot_curl_exit" -ne 0 ]]; then
  render_errors+=("SNAPSHOT_CURL_${snapshot_curl_exit}")
elif [[ "$render_snapshot_http" != "401" && "$render_snapshot_http" != "403" ]]; then
  render_errors+=("SNAPSHOT_UNEXPECTED_HTTP:${render_snapshot_http}")
  if [[ "$render_snapshot_http" == "200" ]]; then
    render_status="SECURITY_EXPOSURE"
  fi
fi

page_errors_json="$(json_array "${page_errors[@]}")"
render_errors_json="$(json_array "${render_errors[@]}")"

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
    "errors": $page_errors_json
  },
  "render": {
    "baseUrl": "$RENDER_BASE_URL",
    "status": "$render_status",
    "liveHttp": "$render_live_http",
    "liveBodyStatus": "$live_body_status",
    "readyHttp": "$render_ready_http",
    "readyBodyStatus": "$ready_body_status",
    "snapshotUnauthenticatedHttp": "$render_snapshot_http",
    "errors": $render_errors_json
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
echo "RENDER_SNAPSHOT_UNAUTH_HTTP=$render_snapshot_http"

if [[ "$pages_status" != "SERVED" || "$render_status" == "SECURITY_EXPOSURE" ]]; then
  exit 1
fi
