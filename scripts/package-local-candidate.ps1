param([string]$Checkpoint = '')
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$checkpointRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot '..\tavern-battle-checkpoints'))
$workspaceCheckpointRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'release\checkpoints'))
if (!$Checkpoint) { $Checkpoint = Join-Path $checkpointRoot ('v2-p6-complete-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
$Checkpoint = [IO.Path]::GetFullPath($Checkpoint)
if (![IO.Path]::GetDirectoryName($Checkpoint).Equals($checkpointRoot, [StringComparison]::OrdinalIgnoreCase) -and ![IO.Path]::GetDirectoryName($Checkpoint).Equals($workspaceCheckpointRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Checkpoint must stay directly inside an approved project checkpoint directory' }
Set-Location -LiteralPath $taskRoot
$sourceList = @(& rg --files --hidden -g '!node_modules/**' -g '!panel/dist/**' -g '!artifacts/**' -g '!release/**' -g '!.git/**' -g '!.env*')
if ($LASTEXITCODE -ne 0) { throw 'Source enumeration failed' }
$sourceList += @('panel/dist/index.html','panel/dist/controller.js','panel/dist/release-manifest.json','panel/dist/tavern-battle-script.json')
$sourceList = @($sourceList | ForEach-Object { $_.Replace('\','/') } | Sort-Object -Unique)
$entries = foreach ($taskRelative in $sourceList) {
  $sourcePath = [IO.Path]::GetFullPath((Join-Path $taskRoot $taskRelative))
  $copyPath = [IO.Path]::GetFullPath((Join-Path $Checkpoint $taskRelative))
  if (!$sourcePath.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or !$copyPath.StartsWith($Checkpoint + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escaped declared roots' }
  New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($copyPath)) | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $copyPath -Force
  $taskHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ((Get-FileHash -LiteralPath $copyPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskHash) { throw "Checkpoint mismatch: $taskRelative" }
  [pscustomobject]@{ path=$taskRelative; bytes=(Get-Item -LiteralPath $sourcePath).Length; sha256=$taskHash }
}
$build = Get-Content -Raw -LiteralPath 'panel/dist/release-manifest.json' | ConvertFrom-Json
$fileManifest = [pscustomobject]@{ createdAt=(Get-Date).ToUniversalTime().ToString('o'); sourceRoot=$taskRoot; releaseFingerprint=$build.sourceFingerprint; scope='Project source, dependencies lock, tests, docs, calibration inputs/data, screenshots and four distribution files. Excludes installed dependencies, artifacts and release archives; no real chats.'; files=@($entries) }
$fileManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Checkpoint 'manifest.json') -Encoding utf8

# The candidate carries the same source/evidence as its recovery directory and ready-to-import files.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$releaseRoot = Join-Path $taskRoot 'release'
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
$zipPath = Join-Path $releaseRoot ((Split-Path -Leaf $Checkpoint) + '-local-candidate.zip')
$stream = [IO.File]::Open($zipPath, [IO.FileMode]::Create, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
try {
  foreach ($entry in $entries) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $Checkpoint $entry.path), $entry.path, [IO.Compression.CompressionLevel]::Optimal) | Out-Null }
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $Checkpoint 'manifest.json'), 'manifest.json', [IO.Compression.CompressionLevel]::Optimal) | Out-Null
} finally { $archive.Dispose(); $stream.Dispose() }
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  if ($archive.Entries.Count -ne $entries.Count + 1) { throw 'Unexpected ZIP entry count' }
  foreach ($entry in $entries) {
    $member = $archive.GetEntry($entry.path); if (!$member) { throw "Missing ZIP member: $($entry.path)" }
    $memberStream = $member.Open(); $sha = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($sha.ComputeHash($memberStream)).Replace('-','').ToLowerInvariant() }
    finally { $memberStream.Dispose(); $sha.Dispose() }
    if ($digest -ne $entry.sha256) { throw "ZIP member mismatch: $($entry.path)" }
  }
} finally { $archive.Dispose() }
$delivery = [pscustomobject]@{ checkedAt=(Get-Date).ToUniversalTime().ToString('o'); checkpoint=$Checkpoint; fileCount=$entries.Count; zip=$zipPath; zipBytes=(Get-Item -LiteralPath $zipPath).Length; zipSha256=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant(); releaseFingerprint=$build.sourceFingerprint; verified='Every copied source/output file and ZIP member hash matches'; realHost='Deferred by user, not tested' }
$delivery | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $releaseRoot 'latest-local-candidate.json') -Encoding utf8
$delivery | ConvertTo-Json -Depth 4
