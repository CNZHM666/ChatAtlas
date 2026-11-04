param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$package = Get-Content -LiteralPath (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $workspace "release-output/ChatAtlas-$version-$(Get-Date -Format yyyyMMdd-HHmmss)" }
$destination = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $destination) { throw 'Choose a new output directory; existing files will not be overwritten.' }
$dist = Join-Path $workspace 'dist'
$manifest = Get-Content -LiteralPath (Join-Path $dist 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $version) { throw 'Build version differs from package version. Run npm run check first.' }
if ($manifest.name -ne 'ChatAtlas') { throw 'Unexpected extension name. Build ChatAtlas first.' }
if (@($manifest.host_permissions).Count -ne 1 -or $manifest.host_permissions[0] -ne 'https://chatgpt.com/*') { throw 'Unexpected fixed host permissions.' }
foreach ($entryPoint in @('atlas.html','sidecar.html')) {
  if ((Get-Content -LiteralPath (Join-Path $dist $entryPoint) -Raw) -match 'localhost|127\.0\.0\.1|@vite/client') { throw 'Development loader found. Build production first.' }
}
# The same explicit manifest is used by CI and the source archive.
$listFile = [IO.Path]::GetTempFileName()
try {
  & node (Join-Path $workspace 'scripts/public-source.mjs') --write-list $listFile
  if ($LASTEXITCODE -ne 0) { throw 'Public source verification failed.' }
  $sourceFiles = @(Get-Content -LiteralPath $listFile | Where-Object { $_ } | ForEach-Object { Get-Item -LiteralPath (Join-Path $workspace $_) })
} finally { Remove-Item -LiteralPath $listFile -Force }
Copy-Item -LiteralPath (Join-Path $workspace 'LICENSE') -Destination (Join-Path $dist 'LICENSE')
Copy-Item -LiteralPath (Join-Path $workspace 'docs/THIRD_PARTY_LICENSES.txt') -Destination (Join-Path $dist 'THIRD_PARTY_LICENSES.txt')
Copy-Item -LiteralPath (Join-Path $workspace 'docs/THIRD_PARTY_NOTICES.md') -Destination (Join-Path $dist 'THIRD_PARTY_NOTICES.md')
$extensionFiles = @(Get-ChildItem -LiteralPath $dist -File -Recurse | Where-Object { $_.Extension -ne '.map' })

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Directory]::CreateDirectory($destination) | Out-Null
function Write-VerifiedZip([string]$Path, [string]$BaseDirectory, [object[]]$Files) {
  $archive = [IO.Compression.ZipFile]::Open($Path, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in ($Files | Sort-Object FullName -Unique)) {
      $relative = [IO.Path]::GetRelativePath($BaseDirectory, $file.FullName).Replace('\','/')
      if ($relative.StartsWith('../')) { throw 'File is outside package root.' }
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $archive.Dispose() }
  $archive = [IO.Compression.ZipFile]::OpenRead($Path)
  try {
    foreach ($entry in $archive.Entries) {
      $stream = $entry.Open()
      $sha = [Security.Cryptography.SHA256]::Create()
      try { $actual = [Convert]::ToHexString($sha.ComputeHash($stream)) } finally { $stream.Dispose(); $sha.Dispose() }
      $expected = (Get-FileHash -LiteralPath (Join-Path $BaseDirectory $entry.FullName) -Algorithm SHA256).Hash
      if ($actual -ne $expected) { throw "Archive mismatch: $($entry.FullName)" }
    }
  } finally { $archive.Dispose() }
}
$sourceZip = Join-Path $destination "ChatAtlas-source-v$version.zip"
$extensionZip = Join-Path $destination "ChatAtlas-extension-v$version.zip"
Write-VerifiedZip $sourceZip $workspace $sourceFiles
Write-VerifiedZip $extensionZip $dist $extensionFiles
@($sourceZip,$extensionZip) | ForEach-Object { $hash = Get-FileHash -LiteralPath $_ -Algorithm SHA256; "$($hash.Hash)  $([IO.Path]::GetFileName($_))" } | Set-Content -LiteralPath (Join-Path $destination 'SHA256.txt') -Encoding utf8
$sourceFiles | Sort-Object FullName -Unique | ForEach-Object { [IO.Path]::GetRelativePath($workspace, $_.FullName).Replace('\','/') } | Set-Content -LiteralPath (Join-Path $destination 'SOURCE_FILES.txt') -Encoding utf8
Write-Output "Created and hash-verified source and extension archives: $destination"
