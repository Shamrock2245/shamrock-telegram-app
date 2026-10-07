#!/usr/bin/env bash
# GET-only probes. Safe targets, taken from this repo (not guessed):
#   https://shamrock-telegram.netlify.app
#     netlify.toml header and README "Live URL". Static hub.
#     county-detect and language-detect only add response headers.
#   https://shamrock-telegram.netlify.app/api/send-paperwork
#     Documented function URL. GET returns 405 before any other work.
#     The function never sends paperwork, even on POST.
#
# Not probed: voice webhooks, ElevenLabs init/post-call, paperwork proxy,
# gas-proxy, and scheduled functions. Those place calls, forward payloads,
# or send Slack/SMS when invoked.
set -u

failures=0

probe() {
  local name="$1"
  local url="$2"
  local expected="$3"
  local needle="$4"
  local body
  local meta
  local code
  local final
  body="$(mktemp)"
  meta="$(curl -sS -L --max-redirs 2 --max-time 20 \
    -A 'shamrock-telegram-uptime' \
    -H 'Accept: text/html,application/json' \
    -X GET \
    -o "$body" \
    -w '%{http_code} %{url_effective}' \
    -- "$url" 2>"$body.err")" || true
  code="${meta%% *}"
  final="${meta#* }"
  if [[ ! "$code" =~ ^[0-9]{3}$ ]]; then
    code="000"
    final="$url"
  fi

  local host
  host="$(printf '%s' "$final" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://([^/]+).*#\1#')"
  local reason=""
  if [[ "$code" != "$expected" ]]; then
    reason="expected HTTP ${expected}, got ${code}"
  elif [[ "$host" != "shamrock-telegram.netlify.app" ]]; then
    reason="redirected to ${final}"
  elif [[ -n "$needle" ]] && ! grep -F -q -- "$needle" "$body"; then
    reason="response body did not contain the expected marker"
  fi

  if [[ -n "$reason" ]]; then
    failures=$((failures + 1))
    local err=""
    if [[ -s "$body.err" ]]; then
      err=" ($(tr '\n' ' ' < "$body.err"))"
    fi
    echo "FAIL ${name} ${url} — ${reason}${err}"
  else
    echo "OK   ${name} ${url} — HTTP ${code}"
  fi
  rm -f "$body" "$body.err"
}

probe "homepage" "https://shamrock-telegram.netlify.app/" "200" "Shamrock Bail Bonds"
probe "send-paperwork-get" "https://shamrock-telegram.netlify.app/api/send-paperwork" "405" "Method not allowed"

if [[ "$failures" -ne 0 ]]; then
  echo "${failures} endpoint probe(s) failed"
  exit 1
fi

echo "All endpoint probes passed"
exit 0
