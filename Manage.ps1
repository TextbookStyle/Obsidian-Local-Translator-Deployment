#Requires -Version 5.1
[CmdletBinding()]
param([ValidateSet('Start', 'Stop', 'Status', 'Test', 'Quit')][string]$Action = 'Status')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts\Ollama.ps1')
try {
    $assets = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'assets.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($Action -eq 'Start') {
        $ollama = Get-TranslatorOllamaPath
        if (-not $ollama) { throw 'Ollama is not installed. Run Install.cmd first.' }
        Start-TranslatorServer -OllamaPath $ollama
        $model = Get-TranslatorModelState -Asset $assets.model -TemplatePath (Join-Path $PSScriptRoot 'model\Modelfile.template')
        if (-not $model.Compatible) { throw "Translation model is not ready. Run Install.cmd first. $($model.Reason)" }
        Write-Host 'Ready. Obsidian will load the translation model on its next translation request.'
        return
    }
    if ($Action -eq 'Quit') { Stop-TranslatorOwnedServer; return }
    if (-not (Test-TranslatorServer)) { Write-Host 'Local Ollama is stopped.'; return }
    switch ($Action) {
        'Status' {
            $loaded = Invoke-TranslatorApi -Path '/api/ps'
            if (@($loaded.models).Count -eq 0) { Write-Host 'Ollama is running. No model is currently loaded.' }
            else { $loaded.models | Select-Object name, size, size_vram, context_length, expires_at | Format-Table -AutoSize | Out-Host }
        }
        'Stop' {
            [void](Invoke-TranslatorApi -Path '/api/generate' -Method POST -Body @{ model = $assets.model.name; keep_alive = 0; stream = $false } -TimeoutSeconds 30)
            Write-Host 'Translation model unloaded. Weights stay on disk; the next translation loads it again.'
        }
        'Test' { [void](Test-TranslatorTranslation -ModelName $assets.model.name) }
    }
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
