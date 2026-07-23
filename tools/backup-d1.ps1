param(
  [ValidateSet('test', 'production')]
  [string]$Environment = 'test',
  [string]$OutputDirectory = '.fortress-backups',
  [ValidateRange(1, 120)]
  [int]$ExportTimeoutMinutes = 30
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$target = Join-Path $root $OutputDirectory
New-Item -ItemType Directory -Force -Path $target | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$npxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $npxCommand) { $npxCommand = Get-Command npx -ErrorAction Stop }

$databases = @(
  @{ Name = "fortress-identity-$Environment"; Config = 'apps/auth/wrangler.jsonc'; Mode = 'full' },
  @{ Name = "fortress-platform-$Environment"; Config = 'apps/api/wrangler.jsonc'; Mode = 'application-tables' }
)

$files = @()
foreach ($database in $databases) {
  $output = Join-Path $target "$($database.Name)-$stamp.sql"
  $bookmarkJson = & $npxCommand.Source wrangler d1 time-travel info $database.Name --env $Environment --config $database.Config --json
  if ($LASTEXITCODE -ne 0) { throw "Could not capture a recovery bookmark for $($database.Name)." }
  $bookmark = ($bookmarkJson | ConvertFrom-Json).bookmark
  $arguments = @(
    'wrangler', 'd1', 'export', $database.Name, '--remote',
    '--env', $Environment, '--config', $database.Config,
    '--output', "`"$output`"", '--skip-confirmation'
  )
  if ($database.Mode -eq 'application-tables') {
    $tableJson = & $npxCommand.Source wrangler d1 execute $database.Name --remote --env $Environment --config $database.Config --command "SELECT name FROM sqlite_master WHERE type='table' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%' AND name NOT LIKE '%_fts_%' AND name NOT IN ('_cf_KV','sqlite_sequence','d1_migrations') ORDER BY name" --json
    if ($LASTEXITCODE -ne 0) { throw "Could not list application tables for $($database.Name)." }
    $tables = ($tableJson | ConvertFrom-Json)[0].results.name
    foreach ($table in $tables) { $arguments += @('--table', $table) }
  }
  $process = Start-Process -FilePath $npxCommand.Source -ArgumentList $arguments -NoNewWindow -PassThru
  if (-not $process.WaitForExit($ExportTimeoutMinutes * 60 * 1000)) {
    try { $process.Kill($true) } catch { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $output -Force -ErrorAction SilentlyContinue
    throw "Backup timed out after $ExportTimeoutMinutes minutes for $($database.Name). No manifest was created."
  }
  $process.WaitForExit()
  $exported = Get-Item -LiteralPath $output -ErrorAction SilentlyContinue
  if (-not $exported -or $exported.Length -lt 100) {
    Remove-Item -LiteralPath $output -Force -ErrorAction SilentlyContinue
    throw "Backup failed for $($database.Name)."
  }
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash.ToLowerInvariant()
  $files += @{
    database = $database.Name
    file = Split-Path $output -Leaf
    sha256 = $hash
    bookmark = $bookmark
    exportMode = $database.Mode
  }
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
