# Shared encrypt/decrypt helpers for D1 backup files. Dot-sourced by backup-d1.ps1 and
# decrypt-backup.ps1 so the two stay in lockstep -- duplicating this into both scripts would risk
# them silently drifting apart.
#
# Uses AES-256-CBC + a separate HMAC-SHA256 authentication tag (encrypt-then-MAC) rather than
# AES-GCM: AesGcm requires modern .NET (Core 3.0+/.NET 5+) and is not available under classic .NET
# Framework, which is what Windows PowerShell 5.1 runs on -- these scripts need to work under both
# 5.1 and PowerShell 7+ (GitHub Actions Windows runners use pwsh, but an operator running this
# manually may be on either). CBC+HMAC is a well-established, broadly-compatible alternative that
# gives the same authenticated-encryption guarantee (confidentiality and tamper detection) without
# that dependency.
#
# File format: [16-byte IV][32-byte HMAC-SHA256 tag over IV||ciphertext][ciphertext]

function Get-FortressDerivedKey {
  param([Parameter(Mandatory)][byte[]]$MasterKey, [Parameter(Mandatory)][string]$Label)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $labelBytes = [System.Text.Encoding]::UTF8.GetBytes($Label)
    return $sha256.ComputeHash($MasterKey + $labelBytes)
  } finally {
    $sha256.Dispose()
  }
}

$FortressCryptoBufferSize = 4MB

function Protect-FortressBackupFile {
  # Fully streamed: D1 content exports run 150MB+, and an all-in-memory approach (ReadAllBytes +
  # TransformFinalBlock + array concatenation) hits .NET Framework array/memory limits on files
  # that size (confirmed by an OutOfMemoryException during live verification against the real
  # content DB export -- this isn't a hypothetical). Two passes over the ciphertext are needed
  # because the HMAC tag can't be known until the whole ciphertext exists, but the tag must be
  # written before the ciphertext in the output file -- so ciphertext is written to a temp file
  # first, then the final file is assembled as IV + tag + streamed-copy-of-temp-file.
  param(
    [Parameter(Mandatory)][string]$InputPath,
    [Parameter(Mandatory)][string]$OutputPath,
    [Parameter(Mandatory)][byte[]]$MasterKey
  )
  if ($MasterKey.Length -ne 32) { throw 'Backup encryption key must be exactly 32 bytes (256 bits).' }
  $encKey = Get-FortressDerivedKey -MasterKey $MasterKey -Label 'fortress-backup-encrypt-v1'
  $macKey = Get-FortressDerivedKey -MasterKey $MasterKey -Label 'fortress-backup-mac-v1'
  $tempCipherPath = "$OutputPath.tmp"
  $aes = [System.Security.Cryptography.Aes]::Create()
  try {
    $aes.Key = $encKey
    $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
    $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
    $aes.GenerateIV()

    $inStream = [System.IO.File]::OpenRead($InputPath)
    try {
      $outStream = [System.IO.File]::Create($tempCipherPath)
      try {
        $encryptor = $aes.CreateEncryptor()
        $cryptoStream = New-Object System.Security.Cryptography.CryptoStream(
          $outStream, $encryptor, [System.Security.Cryptography.CryptoStreamMode]::Write)
        try {
          $inStream.CopyTo($cryptoStream, $FortressCryptoBufferSize)
          $cryptoStream.FlushFinalBlock()
        } finally {
          $cryptoStream.Dispose()
        }
      } finally {
        $outStream.Dispose()
      }
    } finally {
      $inStream.Dispose()
    }

    $hmac = New-Object System.Security.Cryptography.HMACSHA256(,$macKey)
    try {
      $hmac.TransformBlock($aes.IV, 0, $aes.IV.Length, $null, 0) | Out-Null
      $cipherStream = [System.IO.File]::OpenRead($tempCipherPath)
      try {
        $buffer = New-Object byte[] $FortressCryptoBufferSize
        while (($read = $cipherStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
          $hmac.TransformBlock($buffer, 0, $read, $null, 0) | Out-Null
        }
      } finally {
        $cipherStream.Dispose()
      }
      $hmac.TransformFinalBlock([byte[]]@(), 0, 0) | Out-Null
      $tag = $hmac.Hash
    } finally {
      $hmac.Dispose()
    }

    $finalStream = [System.IO.File]::Create($OutputPath)
    try {
      $finalStream.Write($aes.IV, 0, $aes.IV.Length)
      $finalStream.Write($tag, 0, $tag.Length)
      $cipherStream2 = [System.IO.File]::OpenRead($tempCipherPath)
      try {
        $cipherStream2.CopyTo($finalStream, $FortressCryptoBufferSize)
      } finally {
        $cipherStream2.Dispose()
      }
    } finally {
      $finalStream.Dispose()
    }
  } finally {
    $aes.Dispose()
    Remove-Item -LiteralPath $tempCipherPath -Force -ErrorAction SilentlyContinue
  }
}

function Unprotect-FortressBackupFile {
  # Two passes for the same reason as Protect-FortressBackupFile: the integrity tag must be fully
  # verified before any plaintext is written (never decrypt-then-check -- that's the padding-oracle
  # shaped mistake this design avoids), which means reading the ciphertext once to check the HMAC
  # and a second time to actually decrypt it. Both passes are streamed.
  param(
    [Parameter(Mandatory)][string]$InputPath,
    [Parameter(Mandatory)][string]$OutputPath,
    [Parameter(Mandatory)][byte[]]$MasterKey
  )
  if ($MasterKey.Length -ne 32) { throw 'Backup encryption key must be exactly 32 bytes (256 bits).' }
  $encKey = Get-FortressDerivedKey -MasterKey $MasterKey -Label 'fortress-backup-encrypt-v1'
  $macKey = Get-FortressDerivedKey -MasterKey $MasterKey -Label 'fortress-backup-mac-v1'
  $fileInfo = Get-Item -LiteralPath $InputPath
  if ($fileInfo.Length -lt 48) { throw 'File is too short to be a Fortress-encrypted backup.' }

  $iv = New-Object byte[] 16
  $expectedTag = New-Object byte[] 32
  $actualTag = $null
  $verifyStream = [System.IO.File]::OpenRead($InputPath)
  try {
    $verifyStream.Read($iv, 0, 16) | Out-Null
    $verifyStream.Read($expectedTag, 0, 32) | Out-Null
    $hmac = New-Object System.Security.Cryptography.HMACSHA256(,$macKey)
    try {
      $hmac.TransformBlock($iv, 0, 16, $null, 0) | Out-Null
      $buffer = New-Object byte[] $FortressCryptoBufferSize
      while (($read = $verifyStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $hmac.TransformBlock($buffer, 0, $read, $null, 0) | Out-Null
      }
      $hmac.TransformFinalBlock([byte[]]@(), 0, 0) | Out-Null
      $actualTag = $hmac.Hash
    } finally {
      $hmac.Dispose()
    }
  } finally {
    $verifyStream.Dispose()
  }
  if (-not [System.Linq.Enumerable]::SequenceEqual([byte[]]$expectedTag, [byte[]]$actualTag)) {
    throw 'Backup integrity check failed: the file does not match the given key, or was corrupted or tampered with. Refusing to decrypt.'
  }

  $aes = [System.Security.Cryptography.Aes]::Create()
  try {
    $aes.Key = $encKey
    $aes.IV = $iv
    $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
    $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
    $inStream = [System.IO.File]::OpenRead($InputPath)
    try {
      $inStream.Seek(48, [System.IO.SeekOrigin]::Begin) | Out-Null
      $decryptor = $aes.CreateDecryptor()
      $cryptoStream = New-Object System.Security.Cryptography.CryptoStream(
        $inStream, $decryptor, [System.Security.Cryptography.CryptoStreamMode]::Read)
      try {
        $outStream = [System.IO.File]::Create($OutputPath)
        try {
          $cryptoStream.CopyTo($outStream, $FortressCryptoBufferSize)
        } finally {
          $outStream.Dispose()
        }
      } finally {
        $cryptoStream.Dispose()
      }
    } finally {
      $inStream.Dispose()
    }
  } finally {
    $aes.Dispose()
  }
}

function New-FortressBackupKey {
  # Uses the instance-based RandomNumberGenerator.Create()/GetBytes(byte[]) API rather than the
  # static RandomNumberGenerator.GetBytes(int) helper (.NET 6+ only) -- the instance API has been
  # available since classic .NET Framework and works under both Windows PowerShell 5.1 and pwsh.
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  [Convert]::ToBase64String($bytes)
}

function Get-FortressBackupKeyBytes {
  param([Parameter(Mandatory)][string]$Base64Key)
  try {
    $bytes = [Convert]::FromBase64String($Base64Key)
  } catch {
    throw 'Backup encryption key must be valid base64.'
  }
  if ($bytes.Length -ne 32) { throw "Backup encryption key must decode to exactly 32 bytes; got $($bytes.Length)." }
  return $bytes
}
