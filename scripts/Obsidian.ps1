# Obsidian integration for the Windows local translation installer.
# Compatible with Windows PowerShell 5.1. No note content is read or written.

function Read-ObsidianJson {
    param([Parameter(Mandatory = $true)][string]$Path, [ValidateSet('Object', 'Array')][string]$Kind = 'Object')
    $text = [System.IO.File]::ReadAllText($Path)
    $expected = if ($Kind -eq 'Array') { '[' } else { '{' }
    if (-not $text.TrimStart().StartsWith($expected)) { throw "Expected a JSON $Kind in: $Path" }
    try {
        # Wrapping preserves empty arrays and null elements in Windows PowerShell 5.1.
        if ($Kind -eq 'Array') { $value = (ConvertFrom-Json -InputObject ('{"items":' + $text + '}') -ErrorAction Stop).items }
        else { $value = ConvertFrom-Json -InputObject $text -ErrorAction Stop }
    }
    catch { throw "Invalid JSON; no configuration will be changed: $Path. $($_.Exception.Message)" }
    if ($Kind -eq 'Array') {
        foreach ($item in $value) { if ($null -eq $item) { throw "Null array entry in JSON: $Path" } }
        return @($value)
    }
    return $value
}

function Assert-ObsidianClosed {
    if (@(Get-Process -Name Obsidian -ErrorAction SilentlyContinue).Count -gt 0) {
        throw 'Close Obsidian completely, then run setup again. Setup will not force-close the app.'
    }
}

function Resolve-ObsidianVaultPath {
    param([Parameter(Mandatory = $true)][string]$VaultPath)
    $item = Get-Item -LiteralPath $VaultPath -ErrorAction Stop
    if (-not $item.PSIsContainer) { throw "Vault is not a folder: $VaultPath" }
    $resolved = $item.FullName.TrimEnd([char[]]@('\', '/'))
    if (-not (Test-Path -LiteralPath (Join-Path $resolved '.obsidian') -PathType Container)) {
        throw "This folder has no .obsidian configuration folder. Open it as a vault in Obsidian once, close Obsidian, then retry: $resolved"
    }
    return $resolved
}

function Get-ObsidianVaults {
    [CmdletBinding()]
    param([string]$RegistryPath = (Join-Path $env:APPDATA 'obsidian\obsidian.json'))
    if (-not (Test-Path -LiteralPath $RegistryPath -PathType Leaf)) { return @() }
    $registry = Read-ObsidianJson -Path $RegistryPath
    if ($null -eq $registry.PSObject.Properties['vaults']) { return @() }
    foreach ($property in $registry.vaults.PSObject.Properties) {
        $vault = $property.Value
        if ($null -ne $vault.PSObject.Properties['path'] -and (Test-Path -LiteralPath $vault.path -PathType Container)) {
            [pscustomobject]@{
                Name = Split-Path -Path $vault.path -Leaf
                Path = [System.IO.Path]::GetFullPath($vault.path)
                Id = $property.Name
            }
        }
    }
}

function Select-ObsidianVault {
    [CmdletBinding()]
    param([string]$VaultPath, [string]$RegistryPath = (Join-Path $env:APPDATA 'obsidian\obsidian.json'))
    if ($VaultPath) { return Resolve-ObsidianVaultPath -VaultPath $VaultPath }
    $vaults = @(Get-ObsidianVaults -RegistryPath $RegistryPath)
    Write-Host 'Choose the Obsidian vault to configure:'
    for ($index = 0; $index -lt $vaults.Count; $index++) { Write-Host ("  {0}. {1}" -f ($index + 1), $vaults[$index].Path) }
    Write-Host '  0. Enter a vault folder path'
    $choice = Read-Host 'Vault number (or enter the full folder path)'
    $number = 0
    if ([int]::TryParse($choice, [ref]$number)) {
        if ($number -eq 0) { return Resolve-ObsidianVaultPath -VaultPath (Read-Host 'Existing vault folder path') }
        if ($number -lt 1 -or $number -gt $vaults.Count) { throw 'Invalid vault number. Run setup again and select a listed vault or enter its full path.' }
        return Resolve-ObsidianVaultPath -VaultPath $vaults[$number - 1].Path
    }
    return Resolve-ObsidianVaultPath -VaultPath $choice.Trim('"')
}

function Write-ObsidianBytesAtomic {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][AllowEmptyCollection()][byte[]]$Bytes)
    $directory = Split-Path -Path $Path -Parent
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    $temporary = Join-Path $directory ('.local-translator-' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [System.IO.File]::WriteAllBytes($temporary, $Bytes)
        if ([System.IO.File]::Exists($Path)) { [System.IO.File]::Replace($temporary, $Path, [NullString]::Value) }
        else { [System.IO.File]::Move($temporary, $Path) }
    }
    finally { if ([System.IO.File]::Exists($temporary)) { [System.IO.File]::Delete($temporary) } }
}

function ConvertTo-ObsidianJsonBytes {
    param([Parameter(Mandatory = $true)]$Value)
    $json = ConvertTo-Json -InputObject $Value -Depth 64
    return ,([System.Text.UTF8Encoding]::new($false).GetBytes($json + [Environment]::NewLine))
}

function Test-ObsidianBytesEqual {
    param([byte[]]$Left, [byte[]]$Right)
    if ($Left.Length -ne $Right.Length) { return $false }
    for ($index = 0; $index -lt $Left.Length; $index++) { if ($Left[$index] -ne $Right[$index]) { return $false } }
    return $true
}

function Get-ObsidianManagedPaths {
    return @('plugins\llm-text-assistant\main.js', 'plugins\llm-text-assistant\manifest.json', 'plugins\llm-text-assistant\styles.css', 'plugins\llm-text-assistant\data.json', 'community-plugins.json')
}

function Restore-ObsidianTranslationBackup {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$VaultPath, [Parameter(Mandatory = $true)][string]$BackupPath, [switch]$SkipProcessCheck)
    if (-not $SkipProcessCheck) { Assert-ObsidianClosed }
    $vault = Resolve-ObsidianVaultPath -VaultPath $VaultPath
    $configuration = Join-Path $vault '.obsidian'
    $backupRoot = [System.IO.Path]::GetFullPath((Join-Path $configuration 'local-translator-backups')).TrimEnd('\') + '\'
    $backup = [System.IO.Path]::GetFullPath($BackupPath).TrimEnd('\')
    if (-not $backup.StartsWith($backupRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Backup must be inside this vault .obsidian\local-translator-backups folder.' }
    $snapshot = Read-ObsidianJson -Path (Join-Path $backup 'snapshot.json')
    if ($snapshot.formatVersion -ne 1 -or -not [string]::Equals($snapshot.vaultPath, $vault, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'This backup does not belong to the selected vault or its format is unsupported.' }
    $allowed = @(Get-ObsidianManagedPaths)
    $entries = @($snapshot.files)
    foreach ($entry in $entries) {
        if ($allowed -notcontains $entry.path) { throw "Unexpected path in backup snapshot: $($entry.path)" }
        if ($entry.existed -and -not (Test-Path -LiteralPath (Join-Path $backup $entry.path) -PathType Leaf)) { throw "Backup file is missing: $($entry.path)" }
    }
    foreach ($entry in $entries) {
        $target = Join-Path $configuration $entry.path
        if ($entry.existed) { Write-ObsidianBytesAtomic -Path $target -Bytes ([System.IO.File]::ReadAllBytes((Join-Path $backup $entry.path))) }
        elseif ([System.IO.File]::Exists($target)) { [System.IO.File]::Delete($target) }
    }
    return [pscustomobject]@{ VaultPath = $vault; RestoredFiles = @($entries.path); BackupPath = $backup }
}

function Install-ObsidianTranslationPlugin {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$VaultPath,
        [Parameter(Mandatory = $true)][string]$PluginSourcePath,
        [string]$ModelName = 'hy-mt2-obsidian:Q4_K_M',
        [string]$TargetLanguage = '',
        [switch]$ForcePlugin,
        [switch]$SkipProcessCheck
    )
    if (-not $SkipProcessCheck) { Assert-ObsidianClosed }
    $vault = Resolve-ObsidianVaultPath -VaultPath $VaultPath
    $configuration = Join-Path $vault '.obsidian'
    $pluginDirectory = Join-Path $configuration 'plugins\llm-text-assistant'
    $vendorManifest = Read-ObsidianJson -Path (Join-Path $PluginSourcePath 'manifest.json')
    if ($vendorManifest.id -ne 'llm-text-assistant') { throw 'Bundled plugin manifest has an unexpected id.' }
    $bundleNames = @('main.js', 'manifest.json', 'styles.css')
    $changes = New-Object 'System.Collections.Generic.List[object]'
    foreach ($name in $bundleNames) {
        $source = Join-Path $PluginSourcePath $name
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Bundled plugin file is missing: $source" }
        $relative = 'plugins\llm-text-assistant\' + $name
        $target = Join-Path $configuration $relative
        $bytes = [System.IO.File]::ReadAllBytes($source)
        if ([System.IO.File]::Exists($target)) {
            if (Test-ObsidianBytesEqual -Left ([System.IO.File]::ReadAllBytes($target)) -Right $bytes) { continue }
            if (-not $ForcePlugin) {
                throw "An existing LLM Text Assistant bundle differs from this package ($name). No files were changed. Use -ForcePlugin to replace it with the bundled version $($vendorManifest.version), after checking the installed version. A backup will be created."
            }
        }
        $changes.Add([pscustomobject]@{ Path = $relative; Bytes = $bytes })
    }

    $dataPath = Join-Path $pluginDirectory 'data.json'
    $settings = if ([System.IO.File]::Exists($dataPath)) { Read-ObsidianJson -Path $dataPath } else { [pscustomobject]@{} }
    # Keep user-created actions, unrelated settings and nonempty translation preferences.
    $defaults = [ordered]@{
        temperature = '0.7'; timeoutSeconds = '120'; contextChars = '600'
        targetLanguage = (ConvertFrom-Json '"\u7b80\u4f53\u4e2d\u6587"')
        promptTranslate = (ConvertFrom-Json '"\u5c06\u4e0b\u65b9 TEXT TO PROCESS \u4e0e END TEXT \u6807\u8bb0\u4e4b\u95f4\u7684\u6587\u672c\u7ffb\u8bd1\u4e3a{TARGET_LANGUAGE}\u3002\u53ea\u8f93\u51fa\u8bd1\u6587\uff0c\u4e0d\u8981\u89e3\u91ca\uff0c\u4e0d\u8981\u7ffb\u8bd1\u6807\u8bb0\u53ca\u6700\u540e\u7684\u64cd\u4f5c\u6307\u4ee4\u3002\u4fdd\u7559 Markdown \u7ed3\u6784\u3001\u94fe\u63a5\u5730\u5740\u3001\u4ee3\u7801\u548c\u5360\u4f4d\u7b26\u3002"')
    }
    $required = [ordered]@{
        apiUrl = 'http://127.0.0.1:11434/v1/chat/completions'; apiKey = ''; model = $ModelName
        confirmBeforeReplace = $true; contextEnabled = $false; freePromptEnabled = $false
    }
    if ($TargetLanguage) { $required['targetLanguage'] = $TargetLanguage }
    $settingsChanged = -not [System.IO.File]::Exists($dataPath)
    foreach ($key in $defaults.Keys) {
        $property = $settings.PSObject.Properties[$key]
        if ($null -eq $property -or [string]::IsNullOrWhiteSpace([string]$property.Value)) {
            $settings | Add-Member -MemberType NoteProperty -Name $key -Value $defaults[$key] -Force
            $settingsChanged = $true
        }
    }
    foreach ($key in $required.Keys) {
        $property = $settings.PSObject.Properties[$key]
        if ($null -eq $property -or $property.Value -cne $required[$key] -or $property.Value.GetType() -ne $required[$key].GetType()) {
            $settings | Add-Member -MemberType NoteProperty -Name $key -Value $required[$key] -Force
            $settingsChanged = $true
        }
    }
    if ($settingsChanged) { $changes.Add([pscustomobject]@{ Path = 'plugins\llm-text-assistant\data.json'; Bytes = (ConvertTo-ObsidianJsonBytes -Value $settings) }) }

    $communityPath = Join-Path $configuration 'community-plugins.json'
    $community = if ([System.IO.File]::Exists($communityPath)) { @(Read-ObsidianJson -Path $communityPath -Kind Array) } else { @() }
    foreach ($id in $community) { if ($id -isnot [string]) { throw 'community-plugins.json must contain an array of plugin id strings. No files were changed.' } }
    if ($community -notcontains 'llm-text-assistant') {
        $community = @($community) + @('llm-text-assistant')
        $changes.Add([pscustomobject]@{ Path = 'community-plugins.json'; Bytes = (ConvertTo-ObsidianJsonBytes -Value @($community)) })
    }
    if ($changes.Count -eq 0) { return [pscustomobject]@{ Changed = $false; VaultPath = $vault; PluginPath = $pluginDirectory; BackupPath = $null; FilesChanged = @() } }

    $backupName = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $backupPath = Join-Path (Join-Path $configuration 'local-translator-backups') $backupName
    [System.IO.Directory]::CreateDirectory($backupPath) | Out-Null
    $snapshotEntries = New-Object 'System.Collections.Generic.List[object]'
    foreach ($change in $changes) {
        $target = Join-Path $configuration $change.Path
        $existed = [System.IO.File]::Exists($target)
        if ($existed) {
            $copy = Join-Path $backupPath $change.Path
            [System.IO.Directory]::CreateDirectory((Split-Path -Path $copy -Parent)) | Out-Null
            [System.IO.File]::WriteAllBytes($copy, [System.IO.File]::ReadAllBytes($target))
        }
        $snapshotEntries.Add([pscustomobject]@{ path = $change.Path; existed = $existed })
    }
    $snapshot = [pscustomobject]@{ formatVersion = 1; vaultPath = $vault; createdUtc = [DateTime]::UtcNow.ToString('o'); files = @($snapshotEntries.ToArray()) }
    Write-ObsidianBytesAtomic -Path (Join-Path $backupPath 'snapshot.json') -Bytes (ConvertTo-ObsidianJsonBytes -Value $snapshot)
    try {
        foreach ($change in $changes) { Write-ObsidianBytesAtomic -Path (Join-Path $configuration $change.Path) -Bytes $change.Bytes }
    }
    catch {
        $writeFailure = $_
        try { Restore-ObsidianTranslationBackup -VaultPath $vault -BackupPath $backupPath -SkipProcessCheck | Out-Null }
        catch { throw "Setup write failed and automatic restore failed. Close Obsidian and restore backup at: $backupPath. Write error: $($writeFailure.Exception.Message). Restore error: $($_.Exception.Message)" }
        throw "Setup write failed; previous plugin/configuration files were restored. Backup: $backupPath. $($writeFailure.Exception.Message)"
    }
    return [pscustomobject]@{ Changed = $true; VaultPath = $vault; PluginPath = $pluginDirectory; BackupPath = $backupPath; FilesChanged = @($changes.ToArray().Path) }
}
