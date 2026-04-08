#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

state_of() {
  local value="$1"
  if [[ -n "$value" ]]; then
    printf 'present'
  else
    printf 'missing'
  fi
}

missing=()
misconfigured=()

read_token="${MCP_AUTH_TOKEN_READ:-${MCP_AUTH_TOKEN:-}}"
write_token="${MCP_AUTH_TOKEN_WRITE:-${MCP_AUTH_TOKEN:-}}"
oauth_token="${MCP_OAUTH_CLAIMS_TOKEN:-$read_token}"
base_url="${CF_MCP_PUBLIC_BASE_URL:-}"
expected_mcp_endpoint="<unavailable>"

if [[ -z "${CF_NAMED_TUNNEL_TOKEN:-}" ]]; then
  missing+=("CF_NAMED_TUNNEL_TOKEN")
fi

if [[ -z "$base_url" ]]; then
  missing+=("CF_MCP_PUBLIC_BASE_URL")
else
  if [[ ! "$base_url" =~ ^https://[^[:space:]]+$ ]]; then
    misconfigured+=("CF_MCP_PUBLIC_BASE_URL must start with https:// and include host")
  fi
  if [[ "$base_url" =~ /mcp/?$ ]]; then
    misconfigured+=("CF_MCP_PUBLIC_BASE_URL must be a base URL without /mcp suffix")
  fi
  if [[ "$base_url" == *"?"* || "$base_url" == *"#"* ]]; then
    misconfigured+=("CF_MCP_PUBLIC_BASE_URL must not include query or fragment")
  fi
  expected_mcp_endpoint="${base_url%/}/mcp"
fi

if [[ -z "$read_token" ]]; then
  missing+=("READ_TOKEN_EFFECTIVE (MCP_AUTH_TOKEN_READ|MCP_AUTH_TOKEN)")
fi

if [[ -z "$write_token" ]]; then
  missing+=("WRITE_TOKEN_EFFECTIVE (MCP_AUTH_TOKEN_WRITE|MCP_AUTH_TOKEN)")
fi

if [[ -z "$oauth_token" ]]; then
  missing+=("OAUTH_TOKEN_EFFECTIVE (MCP_OAUTH_CLAIMS_TOKEN|READ_TOKEN_EFFECTIVE)")
fi

if [[ -z "${AUTH0_EXPECTED_ISS:-}" ]]; then
  missing+=("AUTH0_EXPECTED_ISS")
elif [[ ! "${AUTH0_EXPECTED_ISS}" =~ ^https://[^[:space:]]+/?$ ]]; then
  misconfigured+=("AUTH0_EXPECTED_ISS must start with https://")
fi

if [[ -z "${AUTH0_EXPECTED_AUD:-}" ]]; then
  missing+=("AUTH0_EXPECTED_AUD")
fi

if [[ -z "${AUTH0_REQUIRED_SCOPES_READ:-}" ]]; then
  missing+=("AUTH0_REQUIRED_SCOPES_READ")
fi

if [[ -z "${AUTH0_REQUIRED_SCOPES_WRITE:-}" ]]; then
  missing+=("AUTH0_REQUIRED_SCOPES_WRITE")
fi

if [[ ! -f .env ]]; then
  misconfigured+=(".env file is required locally for POSTGRES_USER/POSTGRES_DB")
else
  if ! rg -q '^[[:space:]]*POSTGRES_USER=' .env; then
    misconfigured+=(".env missing POSTGRES_USER (required by remote validators)")
  fi
  if ! rg -q '^[[:space:]]*POSTGRES_DB=' .env; then
    misconfigured+=(".env missing POSTGRES_DB (required by remote validators)")
  fi
fi

status="READY_FOR_REMOTE_EXECUTION"
exit_code=0
if (( ${#missing[@]} > 0 )); then
  status="BLOCKED_MISSING_SECRETS"
  exit_code=2
elif (( ${#misconfigured[@]} > 0 )); then
  status="BLOCKED_MISCONFIGURED_ENV"
  exit_code=3
fi

echo "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "check=remote_readiness"
echo "var_status.CF_NAMED_TUNNEL_TOKEN=$(state_of "${CF_NAMED_TUNNEL_TOKEN:-}")"
echo "var_status.CF_MCP_PUBLIC_BASE_URL=$(state_of "$base_url")"
echo "var_status.MCP_AUTH_TOKEN=$(state_of "${MCP_AUTH_TOKEN:-}")"
echo "var_status.MCP_AUTH_TOKEN_READ=$(state_of "${MCP_AUTH_TOKEN_READ:-}")"
echo "var_status.MCP_AUTH_TOKEN_WRITE=$(state_of "${MCP_AUTH_TOKEN_WRITE:-}")"
echo "var_status.MCP_OAUTH_CLAIMS_TOKEN=$(state_of "${MCP_OAUTH_CLAIMS_TOKEN:-}")"
echo "var_status.AUTH0_EXPECTED_ISS=$(state_of "${AUTH0_EXPECTED_ISS:-}")"
echo "var_status.AUTH0_EXPECTED_AUD=$(state_of "${AUTH0_EXPECTED_AUD:-}")"
echo "var_status.AUTH0_REQUIRED_SCOPES_READ=$(state_of "${AUTH0_REQUIRED_SCOPES_READ:-}")"
echo "var_status.AUTH0_REQUIRED_SCOPES_WRITE=$(state_of "${AUTH0_REQUIRED_SCOPES_WRITE:-}")"
echo "effective.READ_TOKEN=$(state_of "$read_token")"
echo "effective.WRITE_TOKEN=$(state_of "$write_token")"
echo "effective.OAUTH_CLAIMS_TOKEN=$(state_of "$oauth_token")"
echo "derived.expected_mcp_endpoint=$expected_mcp_endpoint"

if (( ${#missing[@]} > 0 )); then
  echo "missing_count=${#missing[@]}"
  printf 'missing=%s\n' "${missing[*]}"
fi

if (( ${#misconfigured[@]} > 0 )); then
  echo "misconfigured_count=${#misconfigured[@]}"
  for msg in "${misconfigured[@]}"; do
    echo "misconfigured=$msg"
  done
fi

echo "status=$status"
echo "exit_code=$exit_code"
exit "$exit_code"
