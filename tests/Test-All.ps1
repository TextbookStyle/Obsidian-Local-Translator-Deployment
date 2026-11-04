#Requires -Version 5.1
[CmdletBinding()]
param([string]$PythonPath = 'python.exe')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
foreach ($file in (Get-ChildItem -LiteralPath $root -Recurse -File -Filter '*.ps1' | Where-Object { $_.FullName -notmatch '\\vendor\\' })) {
    $parseTokens = $null
    $parseErrors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$parseTokens, [ref]$parseErrors)
    if ($parseErrors.Count -gt 0) { throw "Parse errors in $($file.FullName): $($parseErrors | Out-String)" }
}
Write-Host 'PASS: deployment PowerShell syntax.'
& (Join-Path $PSScriptRoot 'Test-Ollama.ps1')
& (Join-Path $PSScriptRoot 'Test-Obsidian.ps1')
& (Join-Path $PSScriptRoot 'Test-Download.ps1') -Python $PythonPath
Write-Host 'PASS: all local tests. No real Ollama installation or user vault was changed.'
