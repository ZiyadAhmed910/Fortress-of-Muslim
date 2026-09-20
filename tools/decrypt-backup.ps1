param(
  [Parameter(Mandatory)][string]$InputPath,
  [string]$OutputPath,
  [string]$EncryptionKeyBase64 = $env:FORTRESS_BACKUP_KEY
)

# Companion to backup-d1.ps1 -EncryptionKeyBase64. Verifies the HMAC integrity tag before writing
# anything to disk -- a failed check means the wrong key, a corrupted file, or tampering, and this
# refuses to decrypt in all three cases rather than guessing.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/backup-crypto.ps1')

if (-not $EncryptionKeyBase64) {
  throw 'Provide -EncryptionKeyBase64 or set $env:FORTRESS_BACKUP_KEY.'
}
if (-not (Test-Path -LiteralPath $InputPath)) {
  throw "Input file not found: $InputPath"
}
if (-not $OutputPath) {
  $OutputPath = $InputPath -replace '\.enc$', ''
  if ($OutputPath -eq $InputPath) { $OutputPath = "$InputPath.decrypted" }
}

$key = Get-FortressBackupKeyBytes -Base64Key $EncryptionKeyBase64
Unprotect-FortressBackupFile -InputPath $InputPath -OutputPath $OutputPath -MasterKey $key
Write-Host "Decrypted: $OutputPath"
Write-Host 'Verify the SHA-256 checksum in the backup manifest against the .enc file (not this decrypted output) before trusting it, then follow docs/incident-response.md for import.'
