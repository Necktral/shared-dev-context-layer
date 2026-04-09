#!/usr/bin/env bash
set -euo pipefail

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

status="READY_FOR_TUNNEL_BASIC_VALIDATION"
exit_code=0

if (( ${#missing[@]} > 0 )); then
  status="BLOCKED_MISSING_SECRETS"
  exit_code=2
elif (( ${#misconfigured[@]} > 0 )); then
  status="BLOCKED_MISCONFIGURED_ENV"
  exit_code=3
fi

echo "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "check=tunnel_hostname_readiness"
echo "var_status.CF_NAMED_TUNNEL_TOKEN=$(state_of "${CF_NAMED_TUNNEL_TOKEN:-}")"
echo "var_status.CF_MCP_PUBLIC_BASE_URL=$(state_of "$base_url")"
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
