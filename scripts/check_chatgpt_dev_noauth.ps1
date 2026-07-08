param(
    [string]$McpUrl = "http://127.0.0.1:8002/mcp",
    [string]$TunnelProfile = "wis-local-mcp",
    [switch]$RunHostedDoctor
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

function Write-Ok([string]$Message) {
    Write-Host "[ok]   $Message"
}

function Write-Info([string]$Message) {
    Write-Host "[info] $Message"
}

function Fail([string]$Message) {
    Write-Error "[FAIL] $Message"
    exit 1
}

function Get-TunnelClientPath {
    $cmd = Get-Command tunnel-client -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    $defaultPath = Join-Path $env:LOCALAPPDATA "Programs\OpenAI\tunnel-client\tunnel-client.exe"
    if (Test-Path $defaultPath) {
        return $defaultPath
    }

    return $null
}

function Invoke-StatusRequest([string]$Uri) {
    try {
        $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 10
        return [int]$response.StatusCode
    } catch {
        $statusCode = $_.Exception.Response.StatusCode
        if ($statusCode) {
            return [int]$statusCode
        }
        throw
    }
}

Write-Info "checking docker compose services"
$compose = docker compose ps --format json 2>$null
if (-not $compose) {
    Fail "docker compose ps returned no services. Start stack with: docker compose up --build -d postgres backend mcp"
}
Write-Ok "docker compose is reachable"

$envProbe = docker compose exec -T mcp python -c "import json, os; names=['MCP_AUTH_ENABLED','MCP_AUTH_BYPASS_LOCAL','MCP_PUBLIC_BASE_URL','MCP_ALLOWED_ORIGINS']; print(json.dumps({n: os.environ.get(n, '') for n in names}, sort_keys=True))"
$runtimeEnv = $envProbe | ConvertFrom-Json

if ($runtimeEnv.MCP_AUTH_ENABLED -ne "false") {
    Fail "expected MCP_AUTH_ENABLED=false in mcp container, got '$($runtimeEnv.MCP_AUTH_ENABLED)'"
}
if ($runtimeEnv.MCP_AUTH_BYPASS_LOCAL -ne "true") {
    Fail "expected MCP_AUTH_BYPASS_LOCAL=true in mcp container, got '$($runtimeEnv.MCP_AUTH_BYPASS_LOCAL)'"
}
if ($runtimeEnv.MCP_PUBLIC_BASE_URL) {
    Fail "expected MCP_PUBLIC_BASE_URL empty in no-auth dev mode"
}
if ($runtimeEnv.MCP_ALLOWED_ORIGINS) {
    Fail "expected MCP_ALLOWED_ORIGINS empty in no-auth dev mode"
}
Write-Ok "mcp container is in no-auth dev posture"

$resourceStatus = Invoke-StatusRequest "http://127.0.0.1:8002/.well-known/oauth-protected-resource"
if ($resourceStatus -ne 404) {
    Fail "expected /.well-known/oauth-protected-resource to be 404 in no-auth mode, got HTTP $resourceStatus"
}
Write-Ok "oauth protected-resource metadata is not published in no-auth mode"

$clientProbe = @'
import anyio
import json
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

URL = "http://127.0.0.1:8002/mcp"

async def main():
    async with streamablehttp_client(URL) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = (await session.list_tools()).tools
            schemes = sorted({
                json.dumps(tool.meta.get("securitySchemes"), sort_keys=True)
                for tool in tools
                if isinstance(tool.meta, dict)
            })
            active = (await session.call_tool("get_active_task", {})).structuredContent
            print(json.dumps({
                "tools": len(tools),
                "security_schemes": schemes,
                "get_active_task_status": active.get("status") if isinstance(active, dict) else None,
            }, sort_keys=True))

anyio.run(main)
'@ | docker compose exec -T mcp python -

$clientResult = $clientProbe | ConvertFrom-Json
if ($clientResult.tools -ne 21) {
    Fail "expected 21 MCP tools, got $($clientResult.tools)"
}
if ($clientResult.security_schemes.Count -ne 1 -or $clientResult.security_schemes[0] -ne '[{"type": "noauth"}]') {
    Fail "expected every tool to advertise noauth, got: $($clientResult.security_schemes -join ', ')"
}
if (-not $clientResult.get_active_task_status) {
    Fail "get_active_task did not return a status"
}
Write-Ok "mcp initialize/list_tools/call_tool works with noauth tools=$($clientResult.tools)"

$tunnelClient = Get-TunnelClientPath
if (-not $tunnelClient) {
    Fail "tunnel-client not found. Install it from https://github.com/openai/tunnel-client/releases/latest"
}
$version = & $tunnelClient --version
Write-Ok "tunnel-client found: $version"

Write-Info "running local tunnel-client dev proxy smoke"
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$proxyLines = & $tunnelClient dev proxy --mcp-server-url "url=$McpUrl,channel=main" --print-json --duration 5s 2>&1
$proxyExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
$proxyOutput = $proxyLines | Out-String
if ($proxyExitCode -ne 0) {
    Fail "tunnel-client dev proxy failed with exit code $proxyExitCode"
}
if ($proxyOutput -notmatch '"mcp_url"' -or $proxyOutput -notmatch 'mcp session initialized') {
    Fail "tunnel-client dev proxy did not initialize the MCP session"
}
Write-Ok "tunnel-client dev proxy can reach the local MCP"

$hasRuntimeKey = [bool](Get-Item -Path "Env:CONTROL_PLANE_API_KEY" -ErrorAction SilentlyContinue)
$hasTunnelId = [bool](Get-Item -Path "Env:CONTROL_PLANE_TUNNEL_ID" -ErrorAction SilentlyContinue)
Write-Info "CONTROL_PLANE_API_KEY present: $hasRuntimeKey"
Write-Info "CONTROL_PLANE_TUNNEL_ID present: $hasTunnelId"

if ($RunHostedDoctor) {
    if (-not ($hasRuntimeKey -and $hasTunnelId)) {
        Fail "RunHostedDoctor requires CONTROL_PLANE_API_KEY and CONTROL_PLANE_TUNNEL_ID in the environment"
    }

    & $tunnelClient init --profile $TunnelProfile --tunnel-id $env:CONTROL_PLANE_TUNNEL_ID --mcp-server-url $McpUrl --force
    if ($LASTEXITCODE -ne 0) {
        Fail "tunnel-client init failed"
    }
    & $tunnelClient doctor --profile $TunnelProfile --explain
    if ($LASTEXITCODE -ne 0) {
        Fail "tunnel-client doctor failed"
    }
    Write-Ok "hosted OpenAI tunnel profile passed doctor"
} else {
    Write-Info "skipping hosted doctor. Add -RunHostedDoctor after setting CONTROL_PLANE_API_KEY and CONTROL_PLANE_TUNNEL_ID."
}

Write-Host ""
Write-Host "CHATGPT_DEV_NOAUTH_PREFLIGHT: PASS"
