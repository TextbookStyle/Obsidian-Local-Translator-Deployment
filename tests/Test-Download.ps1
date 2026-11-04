# Run with Windows PowerShell 5.1 or PowerShell 7. Python is a test-only dependency.
[CmdletBinding()]
param([string]$Python = 'python.exe')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\scripts\Download.ps1')

function Assert-DownloadTest {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('ollama-download-tests-' + [guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($testRoot)
$fixture = Join-Path $PSScriptRoot 'download-fixture.py'
$pythonPath = (Get-Command $Python -ErrorAction Stop).Source
$server = Start-Process -FilePath $pythonPath -ArgumentList @(('"' + $fixture + '"'), '--root', ('"' + $testRoot + '"')) -WindowStyle Hidden -PassThru
try {
    $portPath = Join-Path $testRoot 'port.txt'
    for ($attempt = 0; $attempt -lt 100 -and -not [IO.File]::Exists($portPath); $attempt++) { Start-Sleep -Milliseconds 100 }
    Assert-DownloadTest ([IO.File]::Exists($portPath)) 'The local fixture did not start.'
    $port = [IO.File]::ReadAllText($portPath)
    $base = 'http://127.0.0.1:' + $port
    $payload = Join-Path $testRoot 'payload.bin'
    $hash = (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash
    $size = ([IO.FileInfo]$payload).Length
    $options = @{ Sha256 = $hash; ExpectedSize = $size; Connections = 3; ChunkSizeBytes = 4096 }

    $segmented = Join-Path $testRoot 'space path\range.bin'
    $result = Get-VerifiedDownload -Url ($base + '/range') -Destination $segmented @options
    Assert-DownloadTest ($result -eq $segmented) 'The result must be only the completed destination path.'
    Assert-DownloadTest (Test-LtdFileDigest -Path $segmented -Size $size -Sha256 $hash) 'Parallel range download failed.'
    $beforeReuse = ([IO.FileInfo](Join-Path $testRoot 'requests.jsonl')).Length
    $null = Get-VerifiedDownload -Url ($base + '/range') -Destination $segmented @options
    Assert-DownloadTest (([IO.FileInfo](Join-Path $testRoot 'requests.jsonl')).Length -eq $beforeReuse) 'Verified cache reuse made a network request.'

    $noRange = Join-Path $testRoot 'norange.bin'
    $null = Get-VerifiedDownload -Url ($base + '/norange') -Destination $noRange @options
    Assert-DownloadTest (Test-LtdFileDigest -Path $noRange -Size $size -Sha256 $hash) 'Single-download fallback failed.'

    $redirect = Join-Path $testRoot 'redirect.bin'
    $null = Get-VerifiedDownload -Url ($base + '/redirect') -Destination $redirect @options
    Assert-DownloadTest (Test-LtdFileDigest -Path $redirect -Size $size -Sha256 $hash) 'A redirect body blocked the one-byte range probe.'

    $resume = Join-Path $testRoot 'resume.bin'
    $failed = $false
    try { $null = Get-VerifiedDownload -Url ($base + '/resume') -Destination $resume @options } catch { $failed = $true }
    Assert-DownloadTest $failed 'An incomplete range download was accepted.'
    $requestsBeforeResume = @(Get-Content -LiteralPath (Join-Path $testRoot 'requests.jsonl') | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.path -eq '/resume' -and $_.start -eq 0 -and $_.end -eq 4095 }).Count
    Assert-DownloadTest ($requestsBeforeResume -eq 1) 'The first resume segment was not completed.'
    [IO.File]::WriteAllText((Join-Path $testRoot 'allow-resume'), '')
    $null = Get-VerifiedDownload -Url ($base + '/resume') -Destination $resume @options
    $requestsAfterResume = @(Get-Content -LiteralPath (Join-Path $testRoot 'requests.jsonl') | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.path -eq '/resume' -and $_.start -eq 0 -and $_.end -eq 4095 }).Count
    Assert-DownloadTest ($requestsAfterResume -eq $requestsBeforeResume) 'A completed segment was downloaded again.'
    Assert-DownloadTest (Test-LtdFileDigest -Path $resume -Size $size -Sha256 $hash) 'Resumed result failed validation.'

    $existing = Join-Path $testRoot 'existing.bin'
    [IO.File]::WriteAllText($existing, 'keep existing content')
    $failed = $false
    try { $null = Get-VerifiedDownload -Url ($base + '/range') -Destination $existing -Sha256 ('0' * 64) -ExpectedSize $size -Connections 2 -ChunkSizeBytes 4096 } catch { $failed = $true }
    Assert-DownloadTest $failed 'A wrong SHA-256 was accepted.'
    Assert-DownloadTest ([IO.File]::ReadAllText($existing) -eq 'keep existing content') 'A hash failure replaced an existing destination.'

    $null = Get-VerifiedDownload -Url ($base + '/range') -Destination $existing @options
    Assert-DownloadTest (Test-LtdFileDigest -Path $existing -Size $size -Sha256 $hash) 'A verified download did not replace an outdated existing destination.'

    $fallback = Join-Path $testRoot 'fallback.bin'
    $null = Get-VerifiedDownload -Url @(($base + '/bad-data'), ($base + '/range')) -Destination $fallback @options
    Assert-DownloadTest (Test-LtdFileDigest -Path $fallback -Size $size -Sha256 $hash) 'A bad source was not rejected before trying the next source.'

    $wrongRange = Join-Path $testRoot 'wrongrange.bin'
    $failed = $false
    try { $null = Get-VerifiedDownload -Url ($base + '/wrong-range') -Destination $wrongRange @options } catch { $failed = $true }
    Assert-DownloadTest $failed 'An invalid Content-Range was accepted.'
    Assert-DownloadTest (-not [IO.File]::Exists($wrongRange)) 'An invalid range response became the completed file.'
    Write-Host 'PASS: parallel ranges, cache reuse, non-range fallback, redirect bodies, resume, hash rejection, verified replacement, source fallback, Content-Range rejection.'
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force }
    # Keep test files for inspection. The test never recursively deletes a computed path.
    Write-Verbose ('Test artifacts: ' + $testRoot)
}
