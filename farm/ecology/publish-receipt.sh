#!/usr/bin/env bash
set -euo pipefail

receipt="${1:?receipt path required}"
branch="${GITHUB_REF_NAME:?GITHUB_REF_NAME required}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"

put_file() {
  local path="$1" message="$2" source="$3"
  local body_b64 sha err attempt
  body_b64="$(base64 -w0 "$source")"
  err="$(mktemp)"
  trap 'rm -f "$err"' RETURN

  for attempt in 1 2 3 4 5; do
    sha="$(gh api -H 'Accept: application/vnd.github+json' \
      "repos/${repo}/contents/${path}?ref=${branch}" --jq '.sha' 2>/dev/null || true)"
    args=(--method PUT -H 'Accept: application/vnd.github+json' \
      "repos/${repo}/contents/${path}" \
      -f message="$message" \
      -f content="$body_b64" \
      -f branch="$branch")
    if [[ -n "$sha" ]]; then args+=(-f sha="$sha"); fi

    : >"$err"
    if gh api "${args[@]}" >/dev/null 2>"$err"; then return 0; fi
    if grep -qE 'HTTP 409|is at .* but expected' "$err"; then sleep "$attempt"; continue; fi
    cat "$err" >&2
    return 1
  done

  echo "ecology_receipt_publish_conflict_exhausted:${path}" >&2
  cat "$err" >&2 || true
  return 1
}

history="farm/ecology/receipts/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.json"
put_file "$history" "farm(ecology): record run ${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}" "$receipt"
put_file "farm/ecology/latest-receipt.json" "farm(ecology): advance latest receipt" "$receipt"
