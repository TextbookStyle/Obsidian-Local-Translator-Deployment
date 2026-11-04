#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'scripts\Ollama.ps1')
$asset = (Get-Content -LiteralPath (Join-Path $root 'assets.json') -Raw -Encoding UTF8 | ConvertFrom-Json).model
$templatePath = Join-Path $root 'model\Modelfile.template'
$template = [regex]::Match([IO.File]::ReadAllText($templatePath), '(?s)TEMPLATE """(.*?)"""').Groups[1].Value
$script:fakeTags = [pscustomobject]@{ models = @() }
$script:fakeShow = [pscustomobject]@{
    template = $template
    modelfile = 'FROM C:/models/blobs/sha256-' + $asset.sha256
    parameters = "num_ctx 8192`nnum_predict 4096`ntemperature 0.7`ntop_p 0.6`ntop_k 20`nrepeat_penalty 1.05`nstop `"<｜hy_place▁holder▁no▁2｜>`""
}
$script:fakeSse = ''
function Invoke-TranslatorApi {
    param([string]$Path, [string]$Method, $Body, [int]$TimeoutSeconds, [switch]$Raw)
    switch ($Path) {
        '/api/tags' { return $script:fakeTags }
        '/api/show' { return $script:fakeShow }
        '/v1/chat/completions' {
            if (-not $Raw -or -not $Body.stream -or $Body.messages.Count -ne 2 -or $Body.messages[1].content -cne 'Process the text.' -or $Body.messages[0].content -notmatch 'TEXT TO PROCESS') {
                throw 'The smoke test no longer uses the actual plugin message/stream format.'
            }
            return $script:fakeSse
        }
        default { throw "Unexpected API call: $Path" }
    }
}
function Assert-True { param([bool]$Condition, [string]$Message); if (-not $Condition) { throw $Message } }
function Assert-Fails { param([scriptblock]$Action, [string]$Message); $failed = $false; try { & $Action | Out-Null } catch { $failed = $true }; Assert-True $failed $Message }
$ownProcess = Get-Process -Id $PID
$identity = [pscustomobject]@{path=$ownProcess.Path; startedFileTimeUtc=$ownProcess.StartTime.ToFileTimeUtc()}
Assert-True (Test-TranslatorProcessIdentity -Process $ownProcess -State $identity) 'Process identity must survive timestamp serialization.'
$identity.startedFileTimeUtc++
Assert-True (-not (Test-TranslatorProcessIdentity -Process $ownProcess -State $identity)) 'A reused PID must not match a different process start time.'
$oldIdentity = [pscustomobject]@{path=$ownProcess.Path; startedUtc=$ownProcess.StartTime.ToUniversalTime()}
Assert-True (Test-TranslatorProcessIdentity -Process $ownProcess -State $oldIdentity) 'An ISO date parsed by PowerShell 7 must retain its identity.'
Assert-True (-not (Get-TranslatorModelState -Asset $asset -TemplatePath $templatePath).Exists) 'Missing alias must be detected.'
$script:fakeTags.models = @([pscustomobject]@{ name = $asset.name })
Assert-True (Get-TranslatorModelState -Asset $asset -TemplatePath $templatePath).Compatible 'Expected adapter was rejected.'
$parameters = $script:fakeShow.parameters
$script:fakeShow.parameters = $parameters.Replace('num_ctx 8192', 'num_ctx 81920').Replace('top_p 0.6', 'top_p 0.65').Replace('top_k 20', 'top_k 200')
Assert-True (-not (Get-TranslatorModelState -Asset $asset -TemplatePath $templatePath).Compatible) 'Parameter values must match completely, not as numeric prefixes.'
$script:fakeShow.parameters = $parameters + "`nstop `"unexpected additional stop`""
Assert-True (-not (Get-TranslatorModelState -Asset $asset -TemplatePath $templatePath).Compatible) 'Additional stop tokens can truncate translations and must be rejected.'
$script:fakeShow.parameters = $parameters
$script:fakeShow.modelfile = 'FROM another-weight'
Assert-True (-not (Get-TranslatorModelState -Asset $asset -TemplatePath $templatePath).Compatible) 'A same-name model with different weights must not be reused.'
Assert-Fails { Install-TranslatorModel -Asset $asset -TemplatePath $templatePath -OllamaPath 'unused' -CacheDirectory $env:TEMP } 'Different alias must require explicit rebuild.'
$script:fakeShow.modelfile = 'FROM C:/models/blobs/sha256-' + $asset.sha256
$script:fakeShow.template = 'wrong chat template'
Assert-True (-not (Get-TranslatorModelState -Asset $asset -TemplatePath $templatePath).Compatible) 'A wrong template must not be reused.'
$script:fakeShow.template = $template
$script:fakeSse = 'data: ' + (@{choices=@(@{delta=@{content='今天的天气很好。'}})} | ConvertTo-Json -Depth 8 -Compress) + "`n`ndata: [DONE]`n"
Assert-True ((Test-TranslatorTranslation) -eq '今天的天气很好。') 'Valid streamed translation was not collected.'
$script:fakeSse = $script:fakeSse.Replace('data: [DONE]', '')
Assert-Fails { Test-TranslatorTranslation } 'A truncated stream must fail.'
$script:fakeSse = 'data: ' + (@{choices=@(@{delta=@{content='处理文本。'}})} | ConvertTo-Json -Depth 8 -Compress) + "`n`ndata: [DONE]`n"
Assert-Fails { Test-TranslatorTranslation } 'Translating only the trigger must fail.'
Write-Host 'PASS: model identity/compatibility protection and real-format SSE smoke-test validation.'
