param(
  [ValidateSet('test', 'production')]
  [string]$Environment = 'test',
  [string]$OutputDirectory = '.fortress-backups'
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$target = Join-Path $root $OutputDirectory
New-Item -ItemType Directory -Force -Path $target | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

$databases = @(
  @{ Name = "fortress-identity-$Environment"; Config = 'apps/auth/wrangler.jsonc' },
  @{ Name = "fortress-platform-$Environment"; Config = 'apps/api/wrangler.jsonc' }
)

$files = @()
foreach ($database in $databases) {
  $output = Join-Path $target "$($database.Name)-$stamp.sql"
  & npx wrangler d1 export $database.Name --remote --env $Environment --config $database.Config --output $output --skip-confirmation
  if ($LASTEXITCODE -ne 0) { throw "Backup failed for $($database.Name)." }
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash.ToLowerInvariant()
  $files += @{ database = $database.Name; file = Split-Path $output -Leaf; sha256 = $hash }
}

$manifest = @{
  environment = $Environment
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  gitCommit = (git rev-parse HEAD)
  files = $files
} | ConvertTo-Json -Depth 4
$manifestPath = Join-Path $target "manifest-$Environment-$stamp.json"
Set-Content -LiteralPath $manifestPath -Value $manifest -Encoding utf8
Write-Host "Backup complete: $manifestPath"
