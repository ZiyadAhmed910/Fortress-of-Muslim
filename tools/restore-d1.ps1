param(
  [Parameter(Mandatory)]
  [ValidateSet('identity', 'content')]
  [string]$Database,
  [Parameter(Mandatory)]
  [ValidateSet('test', 'production')]
  [string]$Environment,
  [string]$Bookmark,
  [string]$Timestamp,
  [string]$ProductionApproval,
  [string]$OutputDirectory = '.fortress-backups'
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Bookmark) -eq [string]::IsNullOrWhiteSpace($Timestamp)) {
  throw 'Provide exactly one of -Bookmark or -Timestamp.'
}
if ($Environment -eq 'production' -and $ProductionApproval -ne 'RESTORE-PRODUCTION') {
  throw 'Production restore requires -ProductionApproval RESTORE-PRODUCTION.'
}

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$target = Join-Path $root $OutputDirectory
New-Item -ItemType Directory -Force -Path $target | Out-Null
$npxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $npxCommand) { $npxCommand = Get-Command npx -ErrorAction Stop }
$name = if ($Database -eq 'identity') { "fortress-identity-$Environment" } else { "fortress-platform-$Environment" }
$config = if ($Database -eq 'identity') { 'apps/auth/wrangler.jsonc' } else { 'apps/api/wrangler.jsonc' }

$currentJson = & $npxCommand.Source wrangler d1 time-travel info $name --env $Environment --config $config --json
if ($LASTEXITCODE -ne 0) { throw "Could not capture the pre-restore bookmark for $name." }
$current = $currentJson | ConvertFrom-Json
$preRestorePath = Join-Path $target "pre-restore-$name-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
@{
  database = $name
  environment = $Environment
  capturedAt = (Get-Date).ToUniversalTime().ToString('o')
  bookmark = $current.bookmark
  gitCommit = (git rev-parse HEAD)
} | ConvertTo-Json | Set-Content -LiteralPath $preRestorePath -Encoding utf8

$arguments = @('wrangler', 'd1', 'time-travel', 'restore', $name, '--env', $Environment, '--config', $config)
if ($Bookmark) { $arguments += @('--bookmark', $Bookmark) }
if ($Timestamp) { $arguments += @('--timestamp', $Timestamp) }
Write-Host "Restoring $name with D1 Time Travel. Pre-restore bookmark: $preRestorePath"
& $npxCommand.Source @arguments
if ($LASTEXITCODE -ne 0) { throw "Time Travel restore failed for $name." }
Write-Host 'Restore completed. Run the environment soak and inspect Admin Operations before reopening traffic.'
