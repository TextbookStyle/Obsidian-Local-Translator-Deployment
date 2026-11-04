#Requires -Version 5.1
# Optional local integration test. Requires an existing Ollama installation and verified model weights.
# Uses a disposable model name and a temporary vault, never the user's Obsidian vault.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'scripts\Download.ps1')
. (Join-Path $root 'scripts\Ollama.ps1')
. (Join-Path $root 'scripts\Obsidian.ps1')
$assets = Get-Content -LiteralPath (Join-Path $root 'assets.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$ollama = Get-TranslatorOllamaPath
if (-not $ollama) { throw 'Install Ollama first. This optional test does not install it.' }
$modelsRoot = if ($env:OLLAMA_MODELS) { $env:OLLAMA_MODELS } else { Join-Path $env:USERPROFILE '.ollama\models' }
$blob = Join-Path $modelsRoot ('blobs\sha256-' + $assets.model.sha256)
if (-not (Test-Path -LiteralPath $blob -PathType Leaf)) { throw 'Import the expected weights first. This optional test does not download them.' }
$runId = [guid]::NewGuid().ToString('N')
$testRoot = Join-Path (Join-Path $root 'test-results') ('live-' + $runId)
$vault = Join-Path $testRoot 'Temporary vault'
[IO.Directory]::CreateDirectory((Join-Path $vault '.obsidian')) | Out-Null
$model = $assets.model
$model.name = 'hy-mt2-obsidian-package-test:' + $runId
$serverWasRunning = Test-TranslatorServer
$savedHost = $env:OLLAMA_HOST
try {
    Start-TranslatorServer -OllamaPath $ollama
    $env:OLLAMA_HOST = '127.0.0.1:11434'
    Install-TranslatorModel -Asset $model -TemplatePath (Join-Path $root 'model\Modelfile.template') -OllamaPath $ollama -CacheDirectory $testRoot
    [void](Test-TranslatorTranslation -ModelName $model.name)
    $plugin = Install-ObsidianTranslationPlugin -VaultPath $vault -PluginSourcePath (Join-Path $root 'vendor\llm-text-assistant') -ModelName $model.name -SkipProcessCheck
    if (-not $plugin.Changed) { throw 'First temporary vault configuration should change files.' }
    Install-TranslatorModel -Asset $model -TemplatePath (Join-Path $root 'model\Modelfile.template') -OllamaPath $ollama -CacheDirectory $testRoot
    $again = Install-ObsidianTranslationPlugin -VaultPath $vault -PluginSourcePath (Join-Path $root 'vendor\llm-text-assistant') -ModelName $model.name -SkipProcessCheck
    if ($again.Changed) { throw 'A repeated installation should be a no-op.' }
    $loaded = Invoke-TranslatorApi -Path '/api/ps'
    $loaded.models | Select-Object name, size_vram, context_length | Format-Table -AutoSize | Out-Host
    Write-Host 'PASS: direct GGUF import, packaged adapter, streaming translation, temporary vault installation and repeated-run reuse.'
} finally {
    if (Test-TranslatorServer) {
        try { [void](Invoke-TranslatorApi -Path '/api/generate' -Method POST -Body @{model=$model.name; keep_alive=0; stream=$false} -TimeoutSeconds 30) } catch { Write-Warning $_.Exception.Message }
        & $ollama rm $model.name
        if (-not $serverWasRunning) { Stop-TranslatorOwnedServer }
    }
    $env:OLLAMA_HOST = $savedHost
    if (Test-Path -LiteralPath $testRoot) {
        $allowed = [IO.Path]::GetFullPath((Join-Path $root 'test-results')).TrimEnd('\') + '\'
        $resolved = (Get-Item -LiteralPath $testRoot).FullName
        if (-not $resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -or (Get-Item -LiteralPath $testRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'Unexpected temporary test path; automatic cleanup refused.'
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
