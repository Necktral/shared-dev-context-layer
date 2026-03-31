#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  validate_oauth_token_claims.sh --token "<JWT>" [options]

Options:
  --expected-iss "<issuer>"
  --expected-aud "<audience>"
  --require-scopes "scope1,scope2"   (comma or space separated)
  --print-payload                     (prints decoded payload JSON)

Examples:
  ./scripts/validate_oauth_token_claims.sh \
    --token "$ACCESS_TOKEN" \
    --expected-iss "https://tenant.auth0.com/" \
    --expected-aud "https://wis-context-sync-api" \
    --require-scopes "openid,profile,email,mcp.read"
EOF
}

TOKEN=""
EXPECTED_ISS=""
EXPECTED_AUD=""
REQUIRE_SCOPES=""
PRINT_PAYLOAD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)
      TOKEN="${2:-}"
      shift 2
      ;;
    --expected-iss)
      EXPECTED_ISS="${2:-}"
      shift 2
      ;;
    --expected-aud)
      EXPECTED_AUD="${2:-}"
      shift 2
      ;;
    --require-scopes)
      REQUIRE_SCOPES="${2:-}"
      shift 2
      ;;
    --print-payload)
      PRINT_PAYLOAD="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: --token is required." >&2
  usage
  exit 1
fi

python3 - "$TOKEN" "$EXPECTED_ISS" "$EXPECTED_AUD" "$REQUIRE_SCOPES" "$PRINT_PAYLOAD" <<'PY'
import base64
import json
import sys
import time

token = sys.argv[1]
expected_iss = sys.argv[2].strip()
expected_aud = sys.argv[3].strip()
require_scopes_raw = sys.argv[4].strip()
print_payload = sys.argv[5].strip().lower() == "true"

parts = token.split(".")
if len(parts) < 2:
    raise SystemExit("ERROR: token is not a JWT-like value (expected at least header.payload).")

payload_segment = parts[1]
padding = "=" * (-len(payload_segment) % 4)
try:
    payload_bytes = base64.urlsafe_b64decode(payload_segment + padding)
    payload = json.loads(payload_bytes.decode("utf-8"))
except Exception as exc:
    raise SystemExit(f"ERROR: failed to decode JWT payload: {exc}")

required_claims = ["iss", "aud", "exp"]
missing = [claim for claim in required_claims if claim not in payload]
if missing:
    raise SystemExit(f"ERROR: missing required claims: {', '.join(missing)}")

if "scope" not in payload and "scp" not in payload:
    raise SystemExit("ERROR: missing scope/scp claim.")

now = int(time.time())
exp = payload.get("exp")
if not isinstance(exp, (int, float)):
    raise SystemExit("ERROR: exp claim must be numeric.")
if int(exp) <= now:
    raise SystemExit(f"ERROR: token expired (exp={int(exp)}, now={now}).")

if expected_iss and payload.get("iss") != expected_iss:
    raise SystemExit(f"ERROR: issuer mismatch. expected={expected_iss} actual={payload.get('iss')}")

if expected_aud:
    aud = payload.get("aud")
    if isinstance(aud, str):
        ok = aud == expected_aud
    elif isinstance(aud, list):
        ok = expected_aud in aud
    else:
        ok = False
    if not ok:
        raise SystemExit(f"ERROR: audience mismatch. expected={expected_aud} actual={aud}")

def normalize_scopes(raw: str) -> set[str]:
    if not raw:
        return set()
    candidates = raw.replace(",", " ").split()
    return {item.strip() for item in candidates if item.strip()}

def token_scopes(payload: dict) -> set[str]:
    raw_scope = payload.get("scope")
    if isinstance(raw_scope, str):
        return normalize_scopes(raw_scope)
    raw_scp = payload.get("scp")
    if isinstance(raw_scp, str):
        return normalize_scopes(raw_scp)
    if isinstance(raw_scp, list):
        return {str(item).strip() for item in raw_scp if str(item).strip()}
    return set()

required_scopes = normalize_scopes(require_scopes_raw)
present_scopes = token_scopes(payload)

if required_scopes:
    missing_scopes = sorted(scope for scope in required_scopes if scope not in present_scopes)
    if missing_scopes:
        raise SystemExit(f"ERROR: missing required scopes: {', '.join(missing_scopes)}")

print("JWT claims validation PASSED")
print(f"iss={payload.get('iss')}")
print(f"aud={payload.get('aud')}")
print(f"exp={int(exp)}")
print(f"scopes={sorted(present_scopes)}")
if print_payload:
    print(json.dumps(payload, indent=2, ensure_ascii=False))
PY
