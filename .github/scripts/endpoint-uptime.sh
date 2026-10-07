#!/usr/bin/env bash
# Run the GET probes, then open/dedupe or close the endpoint-down issue.
set -euo pipefail

probe_log="$(mktemp)"
probe_status=0
bash .github/scripts/check-endpoints.sh | tee "$probe_log" || probe_status=$?

label_ready() {
  gh label create endpoint-down \
    --repo "$REPO" \
    --description "Production endpoint failed the uptime check" \
    --color "b60205" \
    --force
}

open_issue_numbers() {
  gh issue list \
    --repo "$REPO" \
    --state open \
    --label endpoint-down \
    --limit 20 \
    --json number \
    --jq '.[].number'
}

if [[ "$probe_status" -ne 0 ]]; then
  label_ready
  existing="$(open_issue_numbers)"
  if [[ -z "${existing//[$'\n\t ']/}" ]]; then
    body="$(cat "$probe_log")"$'\n\n'"Workflow run: ${RUN_URL}"$'\n\n'"Probes are GET-only. Voice, messaging, and scheduled functions are not called."
    gh issue create \
      --repo "$REPO" \
      --title "Production endpoint down" \
      --label endpoint-down \
      --body "$body"
  else
    echo "Open endpoint-down issue already exists (${existing//$'\n'/, }). Not opening another."
  fi
  rm -f "$probe_log"
  exit "$probe_status"
fi

existing="$(open_issue_numbers)"
if [[ -n "${existing//[$'\n\t ']/}" ]]; then
  while IFS= read -r number; do
    [[ -z "$number" ]] && continue
    gh issue close "$number" \
      --repo "$REPO" \
      --reason completed \
      --comment "$(printf 'Production endpoints recovered.\n\nWorkflow run: %s\n' "$RUN_URL")"
  done <<< "$existing"
fi

rm -f "$probe_log"
exit 0
