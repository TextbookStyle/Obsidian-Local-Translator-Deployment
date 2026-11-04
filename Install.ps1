#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$VaultPath,
    [ValidateRange(1, 32)][int]$Connections = 8,
    [string]$CacheDirectory = '',
    [string]$TargetLanguage = '',
    [switch]$ForcePlugin,
    [switch]$RebuildModel,
    [switch]$CheckOnly,
    [switch]$SkipTranslationTest
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $CacheDirectory) { $CacheDirectory = Join-Path $PSScriptRoot 'cache' }
. (Join-Path $PSScriptRoot 'scripts\Download.ps1')
. (Join-Path $PSScriptRoot 'scripts\Ollama.ps1')
. (Join-Path $PSScriptRoot 'scripts\Obsidian.ps1')

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This package supports Windows x64 only.' }
    $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    if ($architecture -ne 'AMD64') { throw 'This package supports Windows x64 (Intel/AMD), not ARM64 or 32-bit Windows.' }
    $assets = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'assets.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $vendor = Join-Path $PSScriptRoot 'vendor\llm-text-assistant'
    foreach ($file in $assets.plugin.files.PSObject.Properties) {
        $path = Join-Path $vendor $file.Name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $file.Value) {
            throw "Bundled plugin integrity check failed: $($file.Name). Extract a fresh copy of the package."
        }
    }
    $templatePath = Join-Path $PSScriptRoot 'model\Modelfile.template'
    $ollama = Get-TranslatorOllamaPath
    $serverReady = Test-TranslatorServer
    Write-Host "Obsidian Local Translator $($assets.packageVersion) (Windows x64)" -ForegroundColor Cyan
    Write-Host "Ollama command: $(if ($ollama) { $ollama } else { 'not installed' })"
    Write-Host "Local API ready: $serverReady"
    try {
        $computer = Get-CimInstance Win32_ComputerSystem
        Write-Host ('Installed RAM: {0:N1} GiB' -f ($computer.TotalPhysicalMemory / 1GB))
        Get-CimInstance Win32_VideoController | ForEach-Object { Write-Host "GPU: $($_.Name), driver $($_.DriverVersion)" }
        if ($computer.TotalPhysicalMemory -lt 8GB) { Write-Warning 'Less than 8 GiB RAM detected. Translation may be slow or fail from insufficient memory.' }
    } catch { Write-Warning 'Hardware inventory unavailable. Ollama will choose supported GPU acceleration or CPU.' }
    if ([Environment]::OSVersion.Version.Build -lt 19045) {
        Write-Warning 'Ollama currently documents Windows 10 22H2 (build 19045) or newer. This older Windows build is outside the supported target.'
        if (-not $ollama -and -not $CheckOnly) { throw 'Update Windows before a new Ollama installation.' }
    }

    if ($CheckOnly) {
        Write-Host 'Check-only mode: no downloads, service starts, model creation or vault writes.'
        if ($serverReady) {
            $model = Get-TranslatorModelState -Asset $assets.model -TemplatePath $templatePath
            Write-Host "Model exists: $($model.Exists); compatible: $($model.Compatible). $($model.Reason)"
        } else { Write-Host 'Model status cannot be checked while the local service is stopped.' }
        if ($VaultPath) { Write-Host "Selected vault: $(Select-ObsidianVault -VaultPath $VaultPath)" }
        else { Get-ObsidianVaults | Format-Table -AutoSize | Out-Host }
        return
    }

    while (Get-Process -Name Obsidian -ErrorAction SilentlyContinue) {
        if ($VaultPath) { throw 'Close Obsidian before running installation. The installer will not close it or discard a pending review.' }
        Write-Host 'Please save your notes, finish any pending review, and close Obsidian.' -ForegroundColor Yellow
        [void](Read-Host 'After closing Obsidian, press Enter to continue')
    }
    $selectedVault = Select-ObsidianVault -VaultPath $VaultPath
    $CacheDirectory = [IO.Path]::GetFullPath($CacheDirectory)
    [IO.Directory]::CreateDirectory($CacheDirectory) | Out-Null
    $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($CacheDirectory))
    if ($drive.AvailableFreeSpace -lt 8GB) { Write-Warning 'Less than 8 GiB is free on the cache drive. A first install also needs space for Ollama and model storage; see README.' }

    Write-Host '[1/4] Checking/installing Ollama...' -ForegroundColor Cyan
    $ollama = Install-TranslatorOllama -Asset $assets.ollama -CacheDirectory $CacheDirectory -Connections $Connections
    Start-TranslatorServer -OllamaPath $ollama
    $version = Invoke-TranslatorApi -Path '/api/version'
    Write-Host "Ollama server version: $($version.version)"
    if ([version]($version.version -replace '-.*$', '') -lt [version]$assets.ollama.version) {
        throw "Installed Ollama predates the tested version $($assets.ollama.version). Update it manually, then rerun. Existing installations are not silently upgraded."
    }

    Write-Host '[2/4] Checking/creating the translation model...' -ForegroundColor Cyan
    Install-TranslatorModel -Asset $assets.model -TemplatePath $templatePath -OllamaPath $ollama `
        -CacheDirectory $CacheDirectory -Connections $Connections -RebuildModel:$RebuildModel
    Write-Host '[3/4] Testing the same streaming API format used by the plugin...' -ForegroundColor Cyan
    if ($SkipTranslationTest) { Write-Warning 'Translation inference test skipped. Successful setup does not yet prove usable translations.' }
    else { [void](Test-TranslatorTranslation -ModelName $assets.model.name) }
    Write-Host '[4/4] Installing/configuring the plugin in the selected vault...' -ForegroundColor Cyan
    $pluginResult = Install-ObsidianTranslationPlugin -VaultPath $selectedVault -PluginSourcePath $vendor `
        -ModelName $assets.model.name -TargetLanguage $TargetLanguage -ForcePlugin:$ForcePlugin
    Write-Host "Vault: $selectedVault"
    if ($pluginResult.BackupPath) { Write-Host "Backup: $($pluginResult.BackupPath)" }
    Write-Host 'Setup finished. Open this vault in Obsidian.' -ForegroundColor Green
    Write-Host 'If Restricted mode is enabled, enable community plugins manually in Settings, then enable LLM Text Assistant.'
    Write-Host 'Select text, open the command palette, choose LLM Text Assistant: Translate, review the result, then Apply.'
    Write-Host 'Stop-Translator.cmd unloads only this model. README.MD explains daily controls and restore.'
} catch {
    Write-Host "Setup stopped: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Fix the issue and rerun. Valid cached downloads and completed segments can be reused.'
    exit 1
}
