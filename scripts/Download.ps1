# Verified, resumable downloads for Windows PowerShell 5.1 and PowerShell 7.
# This module never runs downloaded files. No Python/Node runtime is required.

function ConvertTo-LtdCurlConfigValue {
    param([Parameter(Mandatory = $true)][string]$Value)
    if ($Value.IndexOfAny([char[]]"`r`n") -ge 0) { throw 'A curl option contains a newline.' }
    return '"' + $Value.Replace('\', '\\').Replace('"', '\"') + '"'
}

function Start-LtdCurlTransfer {
    param(
        [string]$CurlPath, [string]$Url, [string]$OutputPath,
        [string]$HeaderPath, [string]$ConfigPath,
        [string]$Range, [long]$MaxFileSize = 0
    )
    $protocol = if (([uri]$Url).Scheme -eq 'https') { '=https' } else { '=http' }
    $options = @(
        'silent', 'show-error', 'fail', 'location',
        'retry = 2', 'retry-delay = 1', 'connect-timeout = 20',
        'speed-limit = 1024', 'speed-time = 120',
        ('proto = ' + (ConvertTo-LtdCurlConfigValue $protocol)),
        ('proto-redir = ' + (ConvertTo-LtdCurlConfigValue $protocol)),
        ('url = ' + (ConvertTo-LtdCurlConfigValue $Url)),
        ('output = ' + (ConvertTo-LtdCurlConfigValue $OutputPath)),
        ('dump-header = ' + (ConvertTo-LtdCurlConfigValue $HeaderPath))
    )
    if ($Range) { $options += 'range = ' + (ConvertTo-LtdCurlConfigValue $Range) }
    # curl applies max-filesize to redirect responses too. Small HTML redirect
    # bodies must fit even when the final range is only one byte. The final
    # response length/Content-Range and whole-file hash are still checked below.
    if ($MaxFileSize -gt 0) { $options += 'max-filesize = ' + [math]::Max($MaxFileSize, 1048576) }
    [IO.File]::WriteAllLines($ConfigPath, $options, [Text.UTF8Encoding]::new($false))
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $CurlPath
    # ConfigPath is generated locally and ends in .curl, so it cannot end in a backslash.
    $info.Arguments = '--config "' + $ConfigPath.Replace('"', '\"') + '"'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $info.RedirectStandardError = $true
    $info.RedirectStandardOutput = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    if (-not $process.Start()) { throw 'Could not start curl.exe.' }
    return [pscustomobject]@{
        Process = $process
        ErrorTask = $process.StandardError.ReadToEndAsync()
        OutputTask = $process.StandardOutput.ReadToEndAsync()
        OutputPath = $OutputPath
        HeaderPath = $HeaderPath
        ConfigPath = $ConfigPath
    }
}

function Complete-LtdCurlTransfer {
    param([Parameter(Mandatory = $true)]$Transfer)
    $Transfer.Process.WaitForExit()
    $exitCode = $Transfer.Process.ExitCode
    $errorText = $Transfer.ErrorTask.GetAwaiter().GetResult()
    $null = $Transfer.OutputTask.GetAwaiter().GetResult()
    $headers = if ([IO.File]::Exists($Transfer.HeaderPath)) {
        [IO.File]::ReadAllText($Transfer.HeaderPath)
    } else { '' }
    $matches = [regex]::Matches($headers, '(?m)^HTTP/\S+\s+(\d{3})[^\r\n]*\r?\n')
    $status = 0
    $finalHeaders = ''
    if ($matches.Count -gt 0) {
        $last = $matches[$matches.Count - 1]
        $status = [int]$last.Groups[1].Value
        $finalHeaders = $headers.Substring($last.Index)
    }
    $Transfer.Process.Dispose()
    return [pscustomobject]@{ ExitCode = $exitCode; Status = $status; Headers = $finalHeaders; Error = $errorText }
}

function Test-LtdFileDigest {
    param([string]$Path, [long]$Size, [string]$Sha256)
    if (-not [IO.File]::Exists($Path)) { return $false }
    if (([IO.FileInfo]$Path).Length -ne $Size) { return $false }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -eq $Sha256
}

function Test-LtdRangeResponse {
    param($Response, [long]$Start, [long]$End, [long]$Total, [string]$Path)
    if ($Response.ExitCode -ne 0 -or $Response.Status -ne 206) { return $false }
    $range = [regex]::Match($Response.Headers, '(?im)^Content-Range:\s*bytes\s+(\d+)-(\d+)/(\d+)\s*$')
    if (-not $range.Success) { return $false }
    if ([long]$range.Groups[1].Value -ne $Start -or [long]$range.Groups[2].Value -ne $End -or [long]$range.Groups[3].Value -ne $Total) { return $false }
    return [IO.File]::Exists($Path) -and ([IO.FileInfo]$Path).Length -eq ($End - $Start + 1)
}

function Get-VerifiedDownload {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string[]]$Url,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$Sha256,
        [Parameter(Mandatory = $true)][ValidateRange(1, [long]::MaxValue)][long]$ExpectedSize,
        [ValidateRange(1, 32)][int]$Connections = 8,
        [ValidateRange(1, 268435456)][long]$ChunkSizeBytes = 8388608
    )
    if ($Url.Count -eq 0) { throw 'At least one download URL is required.' }
    foreach ($source in $Url) {
        $sourceUri = [uri]$source
        if (-not $sourceUri.IsAbsoluteUri -or ($sourceUri.Scheme -ne 'https' -and -not ($sourceUri.Scheme -eq 'http' -and $sourceUri.IsLoopback))) {
            throw 'Downloads require HTTPS (HTTP is allowed only for loopback tests).'
        }
    }
    $Destination = [IO.Path]::GetFullPath($Destination)
    $Sha256 = $Sha256.ToLowerInvariant()
    $parent = [IO.Path]::GetDirectoryName($Destination)
    $null = [IO.Directory]::CreateDirectory($parent)
    if ([IO.Directory]::Exists($Destination)) { throw 'The download destination is a directory.' }
    if (Test-LtdFileDigest -Path $Destination -Size $ExpectedSize -Sha256 $Sha256) {
        Write-Verbose 'Verified download cache reused.'
        return $Destination
    }
    $curlPath = (Get-Command curl.exe -ErrorAction Stop).Source
    $work = $Destination + '.download-' + $Sha256.Substring(0, 16) + '-' + $ChunkSizeBytes
    $null = [IO.Directory]::CreateDirectory($work)
    if (((Get-Item -LiteralPath $work).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'The download work directory must not be a junction or symbolic link.'
    }
    $lock = $null
    $active = [Collections.Generic.List[object]]::new()
    $sourceErrors = [Collections.Generic.List[string]]::new()
    try {
        try { $lock = [IO.File]::Open((Join-Path $work 'download.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
        catch { throw 'Another process is using this download cache. Close the other installer and retry.' }
        for ($sourceIndex = 0; $sourceIndex -lt $Url.Count; $sourceIndex++) {
            $source = $Url[$sourceIndex]
            $urlHasher = [Security.Cryptography.SHA256]::Create()
            try { $sourceKey = ([BitConverter]::ToString($urlHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($source)))).Replace('-', '').Substring(0, 12) }
            finally { $urlHasher.Dispose() }
            $sourceWork = Join-Path $work $sourceKey
            $null = [IO.Directory]::CreateDirectory($sourceWork)
            if (((Get-Item -LiteralPath $sourceWork).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'The source cache must not be a symbolic link.' }
            try {
                $probePath = Join-Path $sourceWork 'probe.tmp'
                $probe = Start-LtdCurlTransfer -CurlPath $curlPath -Url $source -OutputPath $probePath -HeaderPath (Join-Path $sourceWork 'probe.headers') -ConfigPath (Join-Path $sourceWork 'probe.curl') -Range '0-0' -MaxFileSize 1
                $null = $active.Add($probe)
                $probeResult = Complete-LtdCurlTransfer $probe
                $null = $active.Remove($probe)
                $supportsRange = Test-LtdRangeResponse -Response $probeResult -Start 0 -End 0 -Total $ExpectedSize -Path $probePath
                $assembledPath = Join-Path $sourceWork 'complete.tmp'
                if ($supportsRange) {
                    $partCount = [int][math]::Ceiling($ExpectedSize / [double]$ChunkSizeBytes)
                    $pending = [Collections.Generic.Queue[object]]::new()
                    $parts = [Collections.Generic.List[object]]::new()
                    for ($partIndex = 0; $partIndex -lt $partCount; $partIndex++) {
                        $start = [long]$partIndex * $ChunkSizeBytes
                        $end = [math]::Min($ExpectedSize - 1, $start + $ChunkSizeBytes - 1)
                        $partPath = Join-Path $sourceWork ('{0:D6}.part' -f $partIndex)
                        $part = [pscustomobject]@{ Start = $start; End = $end; Path = $partPath; Meta = $partPath + '.json' }
                        $null = $parts.Add($part)
                        $reusable = $false
                        if ([IO.File]::Exists($part.Meta)) {
                            try {
                                $saved = [IO.File]::ReadAllText($part.Meta) | ConvertFrom-Json
                                $reusable = $saved.Start -eq $start -and $saved.End -eq $end -and $saved.Total -eq $ExpectedSize -and (Test-LtdFileDigest -Path $part.Path -Size ($end - $start + 1) -Sha256 $saved.Sha256)
                            } catch { $reusable = $false }
                        }
                        if (-not $reusable) { $pending.Enqueue($part) }
                    }
                    Write-Host ('Downloading {0:N1} MiB in {1} segments ({2} cached), up to {3} connections.' -f ($ExpectedSize / 1MB), $partCount, ($partCount - $pending.Count), $Connections)
                    $running = [Collections.Generic.List[object]]::new()
                    while ($pending.Count -gt 0 -or $running.Count -gt 0) {
                        while ($pending.Count -gt 0 -and $running.Count -lt $Connections) {
                            $part = $pending.Dequeue()
                            $transfer = Start-LtdCurlTransfer -CurlPath $curlPath -Url $source -OutputPath ($part.Path + '.tmp') -HeaderPath ($part.Path + '.headers') -ConfigPath ($part.Path + '.curl') -Range ($part.Start.ToString() + '-' + $part.End.ToString()) -MaxFileSize ($part.End - $part.Start + 1)
                            $null = $active.Add($transfer)
                            $null = $running.Add([pscustomobject]@{ Part = $part; Transfer = $transfer })
                        }
                        $completed = @($running | Where-Object { $_.Transfer.Process.HasExited })
                        foreach ($item in $completed) {
                            $response = Complete-LtdCurlTransfer $item.Transfer
                            $null = $active.Remove($item.Transfer)
                            $null = $running.Remove($item)
                            if (-not (Test-LtdRangeResponse -Response $response -Start $item.Part.Start -End $item.Part.End -Total $ExpectedSize -Path $item.Transfer.OutputPath)) {
                                throw ('Segment {0}-{1} failed (HTTP {2}, curl {3}). Completed segments are retained for retry.' -f $item.Part.Start, $item.Part.End, $response.Status, $response.ExitCode)
                            }
                            if ([IO.File]::Exists($item.Part.Path)) { [IO.File]::Delete($item.Part.Path) }
                            [IO.File]::Move($item.Transfer.OutputPath, $item.Part.Path)
                            $meta = @{ Start = $item.Part.Start; End = $item.Part.End; Total = $ExpectedSize; Sha256 = (Get-FileHash -LiteralPath $item.Part.Path -Algorithm SHA256).Hash }
                            [IO.File]::WriteAllText($item.Part.Meta, ($meta | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
                        }
                        if ($pending.Count -gt 0 -or $running.Count -gt 0) { Start-Sleep -Milliseconds 100 }
                    }
                    $assembled = [IO.File]::Open($assembledPath, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
                    try {
                        foreach ($part in $parts) {
                            $inputStream = [IO.File]::OpenRead($part.Path)
                            try { $inputStream.CopyTo($assembled) } finally { $inputStream.Dispose() }
                        }
                    } finally { $assembled.Dispose() }
                } elseif ($probeResult.Status -eq 200 -or $probeResult.Status -eq 416) {
                    Write-Host 'The server does not support usable byte ranges; using a single verified download.'
                    $transfer = Start-LtdCurlTransfer -CurlPath $curlPath -Url $source -OutputPath $assembledPath -HeaderPath (Join-Path $sourceWork 'full.headers') -ConfigPath (Join-Path $sourceWork 'full.curl') -MaxFileSize $ExpectedSize
                    $null = $active.Add($transfer)
                    $response = Complete-LtdCurlTransfer $transfer
                    $null = $active.Remove($transfer)
                    if ($response.ExitCode -ne 0 -or $response.Status -ne 200) { throw ('Full download failed (HTTP {0}, curl {1}).' -f $response.Status, $response.ExitCode) }
                } else {
                    throw ('The range probe failed or returned an invalid Content-Range (HTTP {0}, curl {1}).' -f $probeResult.Status, $probeResult.ExitCode)
                }
                Write-Host 'Checking SHA-256...'
                if (-not (Test-LtdFileDigest -Path $assembledPath -Size $ExpectedSize -Sha256 $Sha256)) {
                    # Untrusted content must not be reused indefinitely. Preserve the existing destination.
                    if ([IO.File]::Exists($assembledPath)) { [IO.File]::Delete($assembledPath) }
                    if ($supportsRange) {
                        foreach ($part in $parts) {
                            if ([IO.File]::Exists($part.Meta)) { [IO.File]::Delete($part.Meta) }
                        }
                    }
                    throw 'The downloaded file failed the expected size/SHA-256 check. The existing destination was preserved.'
                }
                if ([IO.File]::Exists($Destination)) { [IO.File]::Replace($assembledPath, $Destination, [NullString]::Value) }
                else { [IO.File]::Move($assembledPath, $Destination) }
                # Only known files owned by this module are removed; never recursively remove a cache path.
                if ($supportsRange) {
                    foreach ($part in $parts) {
                        foreach ($suffix in @('', '.json', '.headers', '.curl', '.tmp')) {
                            $ownedPath = $part.Path + $suffix
                            if ([IO.File]::Exists($ownedPath)) { [IO.File]::Delete($ownedPath) }
                        }
                    }
                }
                return $Destination
            } catch {
                foreach ($transfer in @($active.ToArray())) {
                    try { if (-not $transfer.Process.HasExited) { $transfer.Process.Kill(); $transfer.Process.WaitForExit() } } catch { }
                    try { $transfer.Process.Dispose() } catch { }
                    $null = $active.Remove($transfer)
                }
                $sourceErrors.Add(('Source {0}: {1}' -f ($sourceIndex + 1), $_.Exception.Message))
                Write-Warning ('Download source {0} failed; trying another source if available.' -f ($sourceIndex + 1))
            }
        }
        throw ('All download sources failed. ' + ($sourceErrors -join ' '))
    } finally {
        foreach ($transfer in @($active.ToArray())) {
            try { if (-not $transfer.Process.HasExited) { $transfer.Process.Kill(); $transfer.Process.WaitForExit() } } catch { }
            try { $transfer.Process.Dispose() } catch { }
        }
        if ($null -ne $lock) { $lock.Dispose() }
    }
}
