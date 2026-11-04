#Requires -Version 5.1
[CmdletBinding()]
param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot 'dist' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$assets = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'assets.json') -Raw -Encoding UTF8 | ConvertFrom-Json
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$archivePath = Join-Path $OutputDirectory "obsidian-local-translator-windows-v$($assets.packageVersion).zip"
$packageRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\') + '\'
$files = @(Get-ChildItem -LiteralPath $PSScriptRoot -File -Recurse -Force | Where-Object {
    $relative = $_.FullName.Substring($packageRoot.Length)
    $relative -notmatch '^(cache|logs|dist|test-results|\.git)(\\|$)' -and -not $_.FullName.StartsWith($outputRoot, [StringComparison]::OrdinalIgnoreCase)
})
$temporary = $archivePath + '.tmp'
$stream = [IO.File]::Open($temporary, [IO.FileMode]::Create)
$zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($packageRoot.Length).Replace('\', '/')
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, "obsidian-local-translator/$relative", [IO.Compression.CompressionLevel]::Optimal)
    }
} finally { $zip.Dispose(); $stream.Dispose() }
if (Test-Path -LiteralPath $archivePath) { [IO.File]::Replace($temporary, $archivePath, [System.Management.Automation.Language.NullString]::Value) }
else { [IO.File]::Move($temporary, $archivePath) }
Write-Host "Created $archivePath ($($files.Count) files)"
$hash = Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
[IO.File]::WriteAllText(($archivePath + '.sha256'), ($hash.Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($archivePath) + [Environment]::NewLine), [Text.Encoding]::ASCII)
$hash
