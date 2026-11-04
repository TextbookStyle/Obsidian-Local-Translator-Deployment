# Self-contained integration tests. Uses temporary vaults only; never a real vault.
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Path $PSScriptRoot -Parent) 'scripts\Obsidian.ps1')

function Assert-Test {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "FAILED: $Message" }
}
function Assert-Throws {
    param([scriptblock]$Action, [string]$Message)
    $thrown = $false
    try { & $Action | Out-Null } catch { $thrown = $true }
    Assert-Test $thrown $Message
}
function Set-TestJson {
    param([string]$Path, $Value)
    [System.IO.Directory]::CreateDirectory((Split-Path $Path -Parent)) | Out-Null
    [System.IO.File]::WriteAllBytes($Path, (ConvertTo-ObsidianJsonBytes -Value $Value))
}
function New-TestVault {
    param([string]$Name)
    $path = Join-Path $testRoot $Name
    [System.IO.Directory]::CreateDirectory((Join-Path $path '.obsidian')) | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $path 'untouched.md'), '# User note: do not modify')
    return $path
}

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('local-translator-obsidian-test-' + [guid]::NewGuid().ToString('N'))
[System.IO.Directory]::CreateDirectory($testRoot) | Out-Null
$vendor = Join-Path $testRoot 'vendor'
[System.IO.Directory]::CreateDirectory($vendor) | Out-Null
[System.IO.File]::WriteAllText((Join-Path $vendor 'main.js'), '// fixed fixture bundle')
[System.IO.File]::WriteAllText((Join-Path $vendor 'styles.css'), '.fixture { color: red; }')
Set-TestJson (Join-Path $vendor 'manifest.json') ([pscustomobject]@{ id = 'llm-text-assistant'; version = '1.1.0' })

try {
    $vault = New-TestVault ('Test vault ' + [char]0x7ffb + [char]0x8bd1)
    $communityPath = Join-Path $vault '.obsidian\community-plugins.json'
    Set-TestJson $communityPath @('other-plugin')
    $noteBefore = [System.IO.File]::ReadAllText((Join-Path $vault 'untouched.md'))
    $result = Install-ObsidianTranslationPlugin -VaultPath $vault -PluginSourcePath $vendor -SkipProcessCheck
    Assert-Test $result.Changed 'initial install reports changed'
    Assert-Test (Test-Path -LiteralPath (Join-Path $result.BackupPath 'snapshot.json')) 'initial install creates a complete snapshot'
    $settingsPath = Join-Path $result.PluginPath 'data.json'
    $settings = Read-ObsidianJson $settingsPath
    Assert-Test ($settings.apiUrl -eq 'http://127.0.0.1:11434/v1/chat/completions') 'local API endpoint'
    Assert-Test ($settings.model -eq 'hy-mt2-obsidian:Q4_K_M') 'adapter model name'
    Assert-Test ($settings.apiKey -eq '' -and $settings.confirmBeforeReplace -eq $true) 'no key and review enabled'
    Assert-Test ($settings.targetLanguage -eq ([string][char]0x7b80 + [char]0x4f53 + [char]0x4e2d + [char]0x6587)) 'Chinese configuration survives encoding'
    Assert-Test ($settings.promptTranslate.Contains('{TARGET_LANGUAGE}') -and $settings.promptTranslate.Contains('TEXT TO PROCESS')) 'translation prompt uses required markers'
    $plugins = @(Read-ObsidianJson $communityPath -Kind Array)
    Assert-Test ($plugins.Count -eq 2 -and $plugins[0] -eq 'other-plugin' -and $plugins[1] -eq 'llm-text-assistant') 'existing enabled plugins preserved'
    $again = Install-ObsidianTranslationPlugin -VaultPath $vault -PluginSourcePath $vendor -SkipProcessCheck
    Assert-Test (-not $again.Changed -and $null -eq $again.BackupPath) 'identical repeated install is a no-op'
    Assert-Test (@(Get-ChildItem -LiteralPath (Split-Path $result.BackupPath -Parent) -Directory).Count -eq 1) 'repeat does not create redundant backups'

    $settings | Add-Member -NotePropertyName unknownPreference -NotePropertyValue ([pscustomobject]@{ enabled = $true })
    $settings | Add-Member -NotePropertyName customActions -NotePropertyValue @([pscustomobject]@{ title = 'Custom'; prompt = 'keep me' })
    $settings.targetLanguage = 'English'
    $settings.promptTranslate = 'Custom translation instruction: {TARGET_LANGUAGE}'
    $settings.apiUrl = 'https://old.example/v1/chat/completions'
    $settings.apiKey = 'fixture-only-not-a-real-key'
    Set-TestJson $settingsPath $settings
    $oldDataBytes = [System.IO.File]::ReadAllBytes($settingsPath)
    $reconfigure = Install-ObsidianTranslationPlugin -VaultPath $vault -PluginSourcePath $vendor -SkipProcessCheck
    $updated = Read-ObsidianJson $settingsPath
    Assert-Test ($updated.unknownPreference.enabled -and $updated.customActions[0].prompt -eq 'keep me') 'unknown settings and custom actions survive'
    Assert-Test ($updated.targetLanguage -eq 'English' -and $updated.promptTranslate -eq 'Custom translation instruction: {TARGET_LANGUAGE}') 'nonempty translation preferences survive'
    Assert-Test ($updated.apiKey -eq '' -and $updated.apiUrl.StartsWith('http://127.0.0.1:')) 'connection changed to local without retaining an API key'
    Restore-ObsidianTranslationBackup -VaultPath $vault -BackupPath $reconfigure.BackupPath -SkipProcessCheck | Out-Null
    Assert-Test (Test-ObsidianBytesEqual -Left $oldDataBytes -Right ([System.IO.File]::ReadAllBytes($settingsPath))) 'restoration preserves exact previous data bytes'

    $invalidVault = New-TestVault 'invalid JSON'
    $invalidPlugins = Join-Path $invalidVault '.obsidian\community-plugins.json'
    [System.IO.File]::WriteAllText($invalidPlugins, '{ invalid json')
    Assert-Throws { Install-ObsidianTranslationPlugin -VaultPath $invalidVault -PluginSourcePath $vendor -SkipProcessCheck } 'invalid community JSON refuses installation'
    Assert-Test (-not (Test-Path -LiteralPath (Join-Path $invalidVault '.obsidian\plugins\llm-text-assistant\main.js'))) 'invalid JSON cannot cause a partial install'
    [System.IO.File]::WriteAllText($invalidPlugins, '[null]')
    Assert-Throws { Install-ObsidianTranslationPlugin -VaultPath $invalidVault -PluginSourcePath $vendor -SkipProcessCheck } 'invalid null plugin id is not silently removed'
    [System.IO.File]::WriteAllText($invalidPlugins, '[]')
    $emptyListInstall = Install-ObsidianTranslationPlugin -VaultPath $invalidVault -PluginSourcePath $vendor -SkipProcessCheck
    Assert-Test $emptyListInstall.Changed 'an empty enabled-plugin array is supported'

    $invalidDataVault = New-TestVault 'invalid plugin data'
    $invalidDataDirectory = Join-Path $invalidDataVault '.obsidian\plugins\llm-text-assistant'
    [System.IO.Directory]::CreateDirectory($invalidDataDirectory) | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $invalidDataDirectory 'data.json'), '{ broken data')
    Assert-Throws { Install-ObsidianTranslationPlugin -VaultPath $invalidDataVault -PluginSourcePath $vendor -SkipProcessCheck } 'invalid existing settings refuse installation'
    Assert-Test (-not (Test-Path -LiteralPath (Join-Path $invalidDataDirectory 'main.js'))) 'invalid settings cannot cause a partial install'

    $newerVault = New-TestVault 'newer plugin'
    $newerPlugin = Join-Path $newerVault '.obsidian\plugins\llm-text-assistant'
    [System.IO.Directory]::CreateDirectory($newerPlugin) | Out-Null
    Set-TestJson (Join-Path $newerPlugin 'manifest.json') ([pscustomobject]@{ id = 'llm-text-assistant'; version = '9.0.0' })
    Assert-Throws { Install-ObsidianTranslationPlugin -VaultPath $newerVault -PluginSourcePath $vendor -SkipProcessCheck } 'different version is not silently replaced'
    Assert-Test ((Read-ObsidianJson (Join-Path $newerPlugin 'manifest.json')).version -eq '9.0.0') 'newer manifest remains intact'
    $forced = Install-ObsidianTranslationPlugin -VaultPath $newerVault -PluginSourcePath $vendor -SkipProcessCheck -ForcePlugin
    Assert-Test $forced.Changed 'explicit replacement succeeds with backup'
    Restore-ObsidianTranslationBackup -VaultPath $newerVault -BackupPath $forced.BackupPath -SkipProcessCheck | Out-Null
    Assert-Test ((Read-ObsidianJson (Join-Path $newerPlugin 'manifest.json')).version -eq '9.0.0') 'explicit replacement can be restored'
    Assert-Test (-not (Test-Path -LiteralPath (Join-Path $newerPlugin 'main.js'))) 'restore removes only files originally absent'

    $registryPath = Join-Path $testRoot 'obsidian.json'
    Set-TestJson $registryPath ([pscustomobject]@{ vaults = [pscustomobject]@{ 'fixture-vault' = [pscustomobject]@{ path = $vault; open = $true } } })
    $registered = @(Get-ObsidianVaults -RegistryPath $registryPath)
    Assert-Test ($registered.Count -eq 1 -and $registered[0].Path -eq $vault) 'registered vault discovery'
    Assert-Test ((Select-ObsidianVault -VaultPath $vault) -eq $vault) 'explicit vault selection supports spaces and Unicode'
    Assert-Throws { Select-ObsidianVault -VaultPath $testRoot } 'uninitialized folders are not treated as vaults'
    Assert-Test ([System.IO.File]::ReadAllText((Join-Path $vault 'untouched.md')) -ceq $noteBefore) 'user note bytes are untouched'

    Restore-ObsidianTranslationBackup -VaultPath $vault -BackupPath $result.BackupPath -SkipProcessCheck | Out-Null
    Assert-Test (-not (Test-Path -LiteralPath $settingsPath)) 'initial installation restore removes newly created settings'
    $originalPlugins = @(Read-ObsidianJson $communityPath -Kind Array)
    Assert-Test ($originalPlugins.Count -eq 1 -and $originalPlugins[0] -eq 'other-plugin') 'initial restore recovers original enabled plugins'
    Write-Host 'PASS: Obsidian temporary-vault integration checks (install, no-op, preservation, refusal, backup, restore, Unicode).'
}
finally {
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    $expectedPrefix = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\local-translator-obsidian-test-'
    if ($resolvedTestRoot.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTestRoot)) {
        $reparseItems = @(Get-ChildItem -LiteralPath $resolvedTestRoot -Force -Recurse | Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint })
        if ($reparseItems.Count -eq 0) { Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force }
    }
}
