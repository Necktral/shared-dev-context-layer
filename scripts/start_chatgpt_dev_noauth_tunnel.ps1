param(
    [string]$McpUrl = "http://127.0.0.1:8002/mcp",
    [string]$TunnelProfile = "wis-local-mcp",
    [switch]$SkipPreflight,
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
    Write-Host "[FAIL] $Message" -ForegroundColor Red
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

$tunnelClient = Get-TunnelClientPath
if (-not $tunnelClient) {
    Fail "tunnel-client not found. Install it from https://github.com/openai/tunnel-client/releases/latest"
}

if (-not $SkipPreflight) {
    if ($RunHostedDoctor) {
        Write-Info "running no-auth ChatGPT MCP preflight with optional hosted tunnel doctor"
        Write-Info "hosted doctor is diagnostic for this no-auth path and may expect OAuth/DCR metadata"
    } else {
        Write-Info "running local no-auth ChatGPT MCP preflight"
        Write-Info "hosted tunnel doctor is skipped by default for Tunnel + No auth"
    }

    $preflight = Join-Path $scriptDir "check_chatgpt_dev_noauth.ps1"
    $preflightArgs = @("-ExecutionPolicy", "Bypass", "-File", $preflight, "-McpUrl", $McpUrl, "-TunnelProfile", $TunnelProfile)
    if ($RunHostedDoctor) {
        $preflightArgs += "-RunHostedDoctor"
    }

    & powershell @preflightArgs
    if ($LASTEXITCODE -ne 0) {
        Fail "preflight failed"
    }
} else {
    Write-Info "preflight skipped by operator request"
    if ($RunHostedDoctor) {
        Write-Info "RunHostedDoctor ignored because preflight was skipped"
    }
}

$hasRuntimeKey = [bool](Get-Item -Path "Env:CONTROL_PLANE_API_KEY" -ErrorAction SilentlyContinue)
$hasTunnelId = [bool](Get-Item -Path "Env:CONTROL_PLANE_TUNNEL_ID" -ErrorAction SilentlyContinue)
if (-not $hasRuntimeKey) {
    Fail "CONTROL_PLANE_API_KEY is required. Set it in this PowerShell session; do not write it to git."
}
if (-not $hasTunnelId) {
    Fail "CONTROL_PLANE_TUNNEL_ID is required. Set it in this PowerShell session."
}

Write-Info "initializing OpenAI tunnel profile '$TunnelProfile' for MCP URL $McpUrl"
& $tunnelClient init --profile $TunnelProfile --tunnel-id $env:CONTROL_PLANE_TUNNEL_ID --mcp-server-url $McpUrl --force
if ($LASTEXITCODE -ne 0) {
    Fail "tunnel-client init failed"
}

Write-Host ""
Write-Ok "OpenAI tunnel profile is ready: $TunnelProfile"
Write-Info "Keep this process running while ChatGPT discovers tools and calls MCP."
Write-Info "In ChatGPT connector settings: Connection=Tunnel, Auth=No auth, select tunnel id from CONTROL_PLANE_TUNNEL_ID."
Write-Host ""

& $tunnelClient run --profile $TunnelProfile
exit $LASTEXITCODE
