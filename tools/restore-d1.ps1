param(
  [Parameter(Mandatory)]
  [ValidateSet('identity', 'content')]
  [string]$Database,
  [Parameter(Mandatory)]
  [ValidateSet('test', 'production')]
  [string]$Environment,
  [Parameter(Mandatory)]
  [string]$BackupFile,
  [string]$ExpectedSha256,
  [string]$ProductionApproval
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$resolvedBackup = Resolve-Path -LiteralPath $BackupFile
if ($Environment -eq 'production' -and $ProductionApproval -ne 'RESTORE-PRODUCTION') {
  throw 'Production restore requires -ProductionApproval RESTORE-PRODUCTION.'
}
if ($ExpectedSha256) {
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedBackup).Hash.ToLowerInvariant()
  if ($actual -ne $ExpectedSha256.ToLowerInvariant()) { throw 'Backup checksum does not match.' }
}

& (Join-Path $PSScriptRoot 'backup-d1.ps1') -Environment $Environment
if ($LASTEXITCODE -ne 0) { throw 'The mandatory pre-restore backup failed.' }

$name = if ($Database -eq 'identity') { "fortress-identity-$Environment" } else { "fortress-platform-$Environment" }
$config = if ($Database -eq 'identity') { 'apps/auth/wrangler.jsonc' } else { 'apps/api/wrangler.jsonc' }
Write-Host "Restoring $name from $resolvedBackup"
& npx wrangler d1 execute $name --remote --env $Environment --config $config --file $resolvedBackup
if ($LASTEXITCODE -ne 0) { throw "Restore failed for $name." }
Write-Host 'Restore completed. Run the environment soak and review Admin Operations before reopening traffic.'
