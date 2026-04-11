#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<USAGE
Uso:
  ./${SCRIPT_NAME} tail
  ./${SCRIPT_NAME} parse
  ./${SCRIPT_NAME} stage <transport|initialize|list_tools|call_tool|jwt|scope_guard|drift>
  ./${SCRIPT_NAME} request <request_id>
  ./${SCRIPT_NAME} session <mcp_session_id>
  ./${SCRIPT_NAME} tool <tool_name>
  ./${SCRIPT_NAME} failures
  ./${SCRIPT_NAME} summary

Descripción:
  - tail: sigue logs del servicio mcp (docker compose)
  - parse: lee stdin mixto (JSON/no-JSON) y deja solo eventos estructurados MCP
  - stage/request/session/tool/failures: filtros sobre stdin
  - summary: agregados por event_name/status_code/failure_classification/tool_name

Ejemplos:
  ./${SCRIPT_NAME} tail | ./${SCRIPT_NAME} parse
  ./${SCRIPT_NAME} tail | ./${SCRIPT_NAME} stage call_tool
  ./${SCRIPT_NAME} tail | ./${SCRIPT_NAME} request req-123
USAGE
}

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: '${SCRIPT_NAME}' requiere 'jq'. Instálalo y reintenta." >&2
    exit 1
  fi
}

parse_stream() {
  # Mantiene solo eventos JSON estructurados con event_name; ignora ruido/no-JSON.
  jq -Rrc '
    def parse_line:
      (try fromjson catch null)
      // (try (capture(".*(?<json>\\{.*\\})").json | fromjson) catch null);

    parse_line
    | select(type == "object" and (.event_name? != null))
  '
}

filter_by_stage() {
  local stage="${1:?stage requerido}"

  case "$stage" in
    transport)
      parse_stream | jq -c '
        select(
          .event_name == "mcp_request_started"
          or .event_name == "mcp_request_completed"
          or .event_name == "mcp_request_failed"
          or .event_name == "mcp_auth_missing"
          or .event_name == "mcp_auth_invalid"
          or .event_name == "mcp_auth_scope_denied"
        )
      '
      ;;
    initialize)
      parse_stream | jq -c '
        select(
          (.event_name | startswith("mcp_handshake_initialize_"))
          or (.rpc_method? == "initialize")
        )
      '
      ;;
    list_tools)
      parse_stream | jq -c '
        select(
          (.event_name | startswith("mcp_list_tools_"))
          or (.event_name == "mcp_contract_drift_detected" and (.reason? == "tool_scope_drift"))
        )
      '
      ;;
    call_tool)
      parse_stream | jq -c '
        select(.event_name | startswith("mcp_call_tool_"))
      '
      ;;
    jwt)
      parse_stream | jq -c '
        select(.auth_stage? == "jwt_verifier")
      '
      ;;
    scope_guard)
      parse_stream | jq -c '
        select(
          .event_name == "mcp_scope_guard_evaluated"
          or (.event_name == "mcp_auth_scope_denied" and .auth_stage? == "tool_runtime")
          or (.event_name == "mcp_auth_missing" and .auth_stage? == "tool_runtime")
        )
      '
      ;;
    drift)
      parse_stream | jq -c '
        select(.event_name == "mcp_contract_drift_detected")
      '
      ;;
    *)
      echo "ERROR: stage inválido '$stage'. Usa: transport|initialize|list_tools|call_tool|jwt|scope_guard|drift" >&2
      exit 1
      ;;
  esac
}

filter_by_request() {
  local request_id="${1:?request_id requerido}"
  parse_stream | jq -c --arg request_id "$request_id" 'select((.request_id? // "") == $request_id)'
}

filter_by_session() {
  local session_id="${1:?mcp_session_id requerido}"
  parse_stream | jq -c --arg session_id "$session_id" 'select((.mcp_session_id? // "") == $session_id)'
}

filter_by_tool() {
  local tool_name="${1:?tool_name requerido}"
  parse_stream | jq -c --arg tool_name "$tool_name" 'select((.tool_name? // "") == $tool_name)'
}

filter_failures() {
  parse_stream | jq -c '
    select(
      .event_name == "mcp_request_failed"
      or .event_name == "mcp_call_tool_failed"
      or .event_name == "mcp_list_tools_failed"
      or .event_name == "mcp_handshake_initialize_failed"
      or .event_name == "mcp_auth_invalid"
      or .event_name == "mcp_auth_scope_denied"
      or .event_name == "mcp_contract_drift_detected"
    )
  '
}

summary() {
  jq -Rn '
    def key_of($v):
      if $v == null or ($v|tostring) == "" then "null" else ($v|tostring) end;

    reduce (
      inputs
      | (try fromjson catch null)
      | select(type == "object" and (.event_name? != null))
    ) as $event (
      {
        total_events: 0,
        by_event: {},
        by_status_code: {},
        by_failure_classification: {},
        by_tool_name: {}
      };
      .total_events += 1
      | .by_event[key_of($event.event_name)] += 1
      | .by_status_code[key_of($event.status_code)] += 1
      | .by_failure_classification[key_of($event.failure_classification)] += 1
      | .by_tool_name[key_of($event.tool_name)] += 1
    )
  '
}

main() {
  if [[ $# -lt 1 ]]; then
    usage
    exit 1
  fi

  local subcommand="$1"
  shift || true

  if [[ "$subcommand" != "help" && "$subcommand" != "-h" && "$subcommand" != "--help" ]]; then
    require_jq
  fi

  case "$subcommand" in
    help|-h|--help)
      usage
      ;;
    tail)
      if [[ $# -ne 0 ]]; then
        echo "ERROR: 'tail' no recibe argumentos." >&2
        exit 1
      fi
      docker compose logs --no-log-prefix -f mcp
      ;;
    parse)
      if [[ $# -ne 0 ]]; then
        echo "ERROR: 'parse' no recibe argumentos." >&2
        exit 1
      fi
      parse_stream
      ;;
    stage)
      if [[ $# -ne 1 ]]; then
        echo "ERROR: uso: ./${SCRIPT_NAME} stage <transport|initialize|list_tools|call_tool|jwt|scope_guard|drift>" >&2
        exit 1
      fi
      filter_by_stage "$1"
      ;;
    request)
      if [[ $# -ne 1 ]]; then
        echo "ERROR: uso: ./${SCRIPT_NAME} request <request_id>" >&2
        exit 1
      fi
      filter_by_request "$1"
      ;;
    session)
      if [[ $# -ne 1 ]]; then
        echo "ERROR: uso: ./${SCRIPT_NAME} session <mcp_session_id>" >&2
        exit 1
      fi
      filter_by_session "$1"
      ;;
    tool)
      if [[ $# -ne 1 ]]; then
        echo "ERROR: uso: ./${SCRIPT_NAME} tool <tool_name>" >&2
        exit 1
      fi
      filter_by_tool "$1"
      ;;
    failures)
      if [[ $# -ne 0 ]]; then
        echo "ERROR: 'failures' no recibe argumentos." >&2
        exit 1
      fi
      filter_failures
      ;;
    summary)
      if [[ $# -ne 0 ]]; then
        echo "ERROR: 'summary' no recibe argumentos." >&2
        exit 1
      fi
      summary
      ;;
    *)
      echo "ERROR: subcomando desconocido '$subcommand'." >&2
      usage
      exit 1
      ;;
  esac
}

main "$@"
