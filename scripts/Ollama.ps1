# Local API access deliberately bypasses HTTP proxy settings for loopback only.
function Invoke-TranslatorApi {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path, [string]$Method = 'GET', $Body,
          [int]$TimeoutSeconds = 15, [switch]$Raw)
    if ($Path -notmatch '^/(api|v1)/[a-zA-Z0-9/_-]+$') { throw 'Invalid local API path.' }
    $request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:11434$Path")
    $request.Proxy = $null
    $request.Method = $Method
    $request.Timeout = $TimeoutSeconds * 1000
    $request.ReadWriteTimeout = $TimeoutSeconds * 1000
    if ($null -ne $Body) {
        $bytes = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 30 -Compress))
        $request.ContentType = 'application/json; charset=utf-8'
        $request.ContentLength = $bytes.Length
        $writer = $request.GetRequestStream()
        try { $writer.Write($bytes, 0, $bytes.Length) } finally { $writer.Dispose() }
    }
    $response = $request.GetResponse()
    try {
        $reader = [IO.StreamReader]::new($response.GetResponseStream(), [Text.Encoding]::UTF8)
        try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally { $response.Dispose() }
    if ($Raw) { return $text }
    return ($text | ConvertFrom-Json)
}

function Get-TranslatorOllamaPath {
    $command = Get-Command ollama.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    $candidates = @((Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'))
    if ($env:OLLAMA_INSTALL_DIR) { $candidates += Join-Path $env:OLLAMA_INSTALL_DIR 'ollama.exe' }
    if ($env:ProgramFiles) { $candidates += Join-Path $env:ProgramFiles 'Ollama\ollama.exe' }
    foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate } }
    return $null
}

function Test-TranslatorServer {
    try { $version = Invoke-TranslatorApi -Path '/api/version' -TimeoutSeconds 2; return [bool]$version.version }
    catch { return $false }
}

function Test-TranslatorProcessIdentity {
    param($Process, $State)
    if (-not $Process -or -not $State -or $Process.Path -ne $State.path) { return $false }
    if ($State.PSObject.Properties['startedFileTimeUtc']) { return $Process.StartTime.ToFileTimeUtc() -eq [long]$State.startedFileTimeUtc }
    # Read older state as well: PowerShell 7 can deserialize an ISO timestamp as DateTime.
    if ($State.PSObject.Properties['startedUtc']) {
        try { return $Process.StartTime.ToUniversalTime().Ticks -eq ([datetime]$State.startedUtc).ToUniversalTime().Ticks }
        catch { return $false }
    }
    return $false
}

function Install-TranslatorOllama {
    param([Parameter(Mandatory)]$Asset, [Parameter(Mandatory)][string]$CacheDirectory, [int]$Connections = 8)
    $existing = Get-TranslatorOllamaPath
    if ($existing) { Write-Host "Using installed Ollama: $existing"; return $existing }
    $installer = Get-VerifiedDownload -Url $Asset.urls -Destination (Join-Path $CacheDirectory $Asset.fileName) `
        -Sha256 $Asset.sha256 -ExpectedSize $Asset.size -Connections $Connections
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Ollama Inc\.(,|$)') {
        throw 'Ollama installer signature is not valid or is not signed by Ollama Inc. Installation stopped.'
    }
    $markerDirectory = Join-Path $env:LOCALAPPDATA 'Ollama'
    [IO.Directory]::CreateDirectory($markerDirectory) | Out-Null
    [IO.File]::WriteAllText((Join-Path $markerDirectory 'upgraded'), '')
    Write-Host 'Installing the verified official Ollama installer for this Windows account...'
    $process = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT /NORESTART /SUPPRESSMSGBOXES' -PassThru -WindowStyle Hidden
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Ollama installation failed, exit code $($process.ExitCode)." }
    $installed = Get-TranslatorOllamaPath
    if (-not $installed) { throw 'The installer exited, but ollama.exe was not found. See the README.' }
    return $installed
}

function Start-TranslatorServer {
    param([Parameter(Mandatory)][string]$OllamaPath)
    if (Test-TranslatorServer) { Write-Host 'Local Ollama is already running.'; return }
    $stateDirectory = Join-Path $env:LOCALAPPDATA 'ObsidianLocalTranslator'
    [IO.Directory]::CreateDirectory($stateDirectory) | Out-Null
    $statePath = Join-Path $stateDirectory 'server.json'
    # Do not duplicate a process launched by this package while it is still starting.
    if (Test-Path -LiteralPath $statePath) {
        try { $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json }
        catch { throw "Cannot read service state at $statePath. See README before removing a stale state file." }
        $prior = if ($state.pid) { Get-Process -Id $state.pid -ErrorAction SilentlyContinue } else { $null }
        if (Test-TranslatorProcessIdentity -Process $prior -State $state) {
            throw 'A package-managed Ollama process exists but its local API is unavailable. Check logs in %LOCALAPPDATA%\ObsidianLocalTranslator.'
        }
    }
    $savedHost = $env:OLLAMA_HOST
    $savedNoCloud = $env:OLLAMA_NO_CLOUD
    try {
        $env:OLLAMA_HOST = '127.0.0.1:11434'
        $env:OLLAMA_NO_CLOUD = '1'
        $server = Start-Process -FilePath $OllamaPath -ArgumentList 'serve' -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $stateDirectory 'server.stdout.log') `
            -RedirectStandardError (Join-Path $stateDirectory 'server.stderr.log')
    } finally { $env:OLLAMA_HOST = $savedHost; $env:OLLAMA_NO_CLOUD = $savedNoCloud }
    $record = @{ pid = $server.Id; path = $OllamaPath; startedUtc = $server.StartTime.ToUniversalTime().ToString('o'); startedFileTimeUtc = $server.StartTime.ToFileTimeUtc() }
    [IO.File]::WriteAllText($statePath, ($record | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if (Test-TranslatorServer) { Write-Host 'Local Ollama is ready on 127.0.0.1:11434.'; return }
        if ($server.HasExited) { throw 'Ollama exited before the API became ready. Check %LOCALAPPDATA%\ObsidianLocalTranslator\server.stderr.log.' }
        Start-Sleep -Seconds 1
    }
    throw 'Ollama did not become ready within 60 seconds. Check its logs and whether port 11434 is occupied.'
}

function Stop-TranslatorOwnedServer {
    $statePath = Join-Path $env:LOCALAPPDATA 'ObsidianLocalTranslator\server.json'
    if (-not (Test-Path -LiteralPath $statePath)) { Write-Host 'No package-managed service. Quit the Ollama tray app to stop an independently started service.'; return }
    $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $process = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
    if (-not $process) { Remove-Item -LiteralPath $statePath; return }
    if (-not (Test-TranslatorProcessIdentity -Process $process -State $state)) {
        throw 'Recorded process identity no longer matches. No process was stopped.'
    }
    if (Test-TranslatorServer) {
        $loaded = Invoke-TranslatorApi -Path '/api/ps'
        if (@($loaded.models).Count -gt 0) { throw 'Models are still loaded. Unload them before quitting this shared local service.' }
    } else { Write-Warning 'The API is unavailable. Stopping only the process with the verified package-owned identity.' }
    $process.Kill()
    $process.WaitForExit()
    Remove-Item -LiteralPath $statePath
    Write-Host 'Stopped only the Ollama service launched by this package.'
}

function Get-TranslatorModelState {
    param([Parameter(Mandatory)]$Asset, [Parameter(Mandatory)][string]$TemplatePath)
    $tags = Invoke-TranslatorApi -Path '/api/tags'
    $found = @($tags.models | Where-Object { $_.name -ieq $Asset.name -or $_.model -ieq $Asset.name })
    if ($found.Count -eq 0) { return [pscustomobject]@{ Exists = $false; Compatible = $false; Reason = 'Model has not been created.' } }
    $details = Invoke-TranslatorApi -Path '/api/show' -Method POST -Body @{ model = $Asset.name }
    $source = [IO.File]::ReadAllText($TemplatePath)
    $expected = [regex]::Match($source, '(?s)TEMPLATE """(.*?)"""').Groups[1].Value.Trim()
    $compatible = ($expected -and ([string]$details.template).Trim() -ceq $expected)
    $compatible = $compatible -and ($details.modelfile -match [regex]::Escape($Asset.sha256))
    foreach ($parameter in @('(?m)^num_ctx\s+8192\s*$', '(?m)^num_predict\s+4096\s*$', '(?m)^temperature\s+0\.7\s*$', '(?m)^top_p\s+0\.6\s*$', '(?m)^top_k\s+20\s*$', '(?m)^repeat_penalty\s+1\.05\s*$')) {
        $compatible = $compatible -and ($details.parameters -match $parameter)
    }
    $stops = @(([string]$details.parameters -split '\r?\n') | Where-Object { $_ -match '^stop\s+' })
    $compatible = $compatible -and ($stops.Count -eq 1)
    if ($stops.Count -eq 1) {
        try { $stopValue = ($stops[0] -replace '^stop\s+', '') | ConvertFrom-Json; $compatible = $compatible -and ($stopValue -ceq '<｜hy_place▁holder▁no▁2｜>') }
        catch { $compatible = $false }
    }
    return [pscustomobject]@{ Exists = $true; Compatible = [bool]$compatible; Reason = $(if ($compatible) { 'Verified weight digest, adapter template and parameters.' } else { 'This model name exists with different weights, template or parameters. Use -RebuildModel to replace it with a backup.' }) }
}

function Get-TranslatorWeightFile {
    param([Parameter(Mandatory)]$Asset, [Parameter(Mandatory)][string]$CacheDirectory, [int]$Connections = 8)
    $modelsRoot = $env:OLLAMA_MODELS
    if (-not $modelsRoot) { $modelsRoot = Join-Path $env:USERPROFILE '.ollama\models' }
    $blob = Join-Path $modelsRoot ("blobs\sha256-" + $Asset.sha256)
    if (Test-Path -LiteralPath $blob -PathType Leaf) {
        if ((Get-Item -LiteralPath $blob).Length -eq $Asset.size -and (Get-FileHash -LiteralPath $blob -Algorithm SHA256).Hash -ieq $Asset.sha256) {
            Write-Host 'Reusing verified weights already stored by Ollama.'
            return $blob
        }
    }
    return (Get-VerifiedDownload -Url $Asset.urls -Destination (Join-Path $CacheDirectory $Asset.fileName) `
        -Sha256 $Asset.sha256 -ExpectedSize $Asset.size -Connections $Connections)
}

function Install-TranslatorModel {
    param([Parameter(Mandatory)]$Asset, [Parameter(Mandatory)][string]$TemplatePath,
          [Parameter(Mandatory)][string]$OllamaPath, [Parameter(Mandatory)][string]$CacheDirectory,
          [int]$Connections = 8, [switch]$RebuildModel)
    $state = Get-TranslatorModelState -Asset $Asset -TemplatePath $TemplatePath
    if ($state.Compatible -and -not $RebuildModel) { Write-Host 'The configured translation model is already installed.'; return }
    if ($state.Exists -and -not $RebuildModel) { throw $state.Reason }
    $weights = Get-TranslatorWeightFile -Asset $Asset -CacheDirectory $CacheDirectory -Connections $Connections
    $modelfile = [IO.File]::ReadAllText($TemplatePath).Replace('__GGUF_PATH__', $weights.Replace('\', '/'))
    $modelfilePath = Join-Path $CacheDirectory 'Hy-MT2-Obsidian.Modelfile'
    [IO.File]::WriteAllText($modelfilePath, $modelfile, [Text.UTF8Encoding]::new($false))
    $savedHost = $env:OLLAMA_HOST
    try {
        $env:OLLAMA_HOST = '127.0.0.1:11434'
        if ($state.Exists) {
            $backup = 'hy-mt2-obsidian-backup:' + [DateTime]::Now.ToString('yyyyMMddHHmmss')
            & $OllamaPath cp $Asset.name $backup
            if ($LASTEXITCODE -ne 0) { throw 'Could not back up the existing model. It was not replaced.' }
            Write-Host "Existing model backed up as $backup"
        }
        & $OllamaPath create $Asset.name -f $modelfilePath
        if ($LASTEXITCODE -ne 0) { throw 'Ollama model creation failed.' }
    } finally { $env:OLLAMA_HOST = $savedHost }
    $verified = Get-TranslatorModelState -Asset $Asset -TemplatePath $TemplatePath
    if (-not $verified.Compatible) { throw 'Created model failed the template/weight verification.' }
}

function Test-TranslatorTranslation {
    param([string]$ModelName = 'hy-mt2-obsidian:Q4_K_M', [int]$TimeoutSeconds = 180)
    $system = "将下方 TEXT TO PROCESS 与 END TEXT 标记之间的文本翻译为简体中文。只输出译文，不要解释，不要翻译标记及最后的操作指令。保留 Markdown 结构、链接地址、代码和占位符。`n`n--- TEXT TO PROCESS (not a chat message!) ---`nThe weather is really nice today.`n--- END TEXT ---`n`nProcess the text above strictly according to the instruction above. Output ONLY the result, without introduction, explanation or other additions."
    $raw = Invoke-TranslatorApi -Path '/v1/chat/completions' -Method POST -TimeoutSeconds $TimeoutSeconds -Raw -Body @{
        model = $ModelName; messages = @(@{ role = 'system'; content = $system }, @{ role = 'user'; content = 'Process the text.' })
        temperature = 0.7; stream = $true
    }
    $output = [Text.StringBuilder]::new()
    $finished = $false
    foreach ($line in ($raw -split '\r?\n')) {
        if ($line -notmatch '^data:\s*(.+)$') { continue }
        $payload = $Matches[1].Trim()
        if ($payload -eq '[DONE]') { $finished = $true; continue }
        $part = $payload | ConvertFrom-Json
        if ($part.error) { throw "Translation API returned an error: $($part.error | ConvertTo-Json -Compress)" }
        if ($part.choices -and $part.choices[0].delta.content) { [void]$output.Append($part.choices[0].delta.content) }
    }
    $translation = $output.ToString().Trim()
    if (-not $finished -or $translation.Length -lt 3 -or $translation -notmatch '[\u4e00-\u9fff]' -or $translation -notmatch '天气' -or $translation -match 'TEXT TO PROCESS|END TEXT|处理文本') {
        throw "Translation smoke test failed. Received: $translation"
    }
    Write-Host "Translation test passed: $translation" -ForegroundColor Green
    return $translation
}
