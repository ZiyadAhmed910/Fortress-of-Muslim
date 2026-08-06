param(
  [ValidateSet('test', 'production')]
  [string]$Environment = 'test',
  [string]$OutputDirectory = '.fortress-backups',
  [ValidateRange(1, 120)]
  [int]$ExportTimeoutMinutes = 30,
  [string]$EncryptionKeyBase64 = $env:FORTRESS_BACKUP_KEY
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
. (Join-Path $PSScriptRoot 'lib/backup-crypto.ps1')
$target = Join-Path $root $OutputDirectory
New-Item -ItemType Directory -Force -Path $target | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$npxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $npxCommand) { $npxCommand = Get-Command npx -ErrorAction Stop }

$encryptionKey = $null
if ($EncryptionKeyBase64) {
  $encryptionKey = Get-FortressBackupKeyBytes -Base64Key $EncryptionKeyBase64
} else {
  Write-Warning 'No encryption key was provided (-EncryptionKeyBase64 or $env:FORTRESS_BACKUP_KEY). This export will be written as PLAIN, UNENCRYPTED SQL. It is not actually "encrypted at rest" unless the disk or destination it lands on provides that separately. Generate a key with: . tools/lib/backup-crypto.ps1; New-FortressBackupKey'
}

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

  $finalPath = $output
  $encrypted = $false
  if ($encryptionKey) {
    $encryptedPath = "$output.enc"
    Protect-FortressBackupFile -InputPath $output -OutputPath $encryptedPath -MasterKey $encryptionKey
    Remove-Item -LiteralPath $output -Force
    $finalPath = $encryptedPath
    $encrypted = $true
  }

  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $finalPath).Hash.ToLowerInvariant()
  $files += @{
    database = $database.Name
    file = Split-Path $finalPath -Leaf
    sha256 = $hash
    bookmark = $bookmark
    exportMode = $database.Mode
    encrypted = $encrypted
  }
}

$manifest = @{
  environment = $Environment
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  gitCommit = (git rev-parse HEAD)
  encrypted = [bool]$encryptionKey
  files = $files
} | ConvertTo-Json -Depth 4
$manifestPath = Join-Path $target "manifest-$Environment-$stamp.json"
Set-Content -LiteralPath $manifestPath -Value $manifest -Encoding utf8
Write-Host "Backup complete: $manifestPath"
