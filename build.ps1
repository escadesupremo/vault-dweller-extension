# Builds the Chrome Web Store package.
#
# Ships an explicit allow-list, never the folder: this repo also holds android/,
# ios/, web/ and .git/, none of which belong in the extension and all of which
# would be published if the whole directory were zipped.
#
# Entries are written by hand with forward slashes. Both Compress-Archive and
# ZipFile::CreateFromDirectory on Windows PowerShell write subdirectory paths
# with backslashes, which the ZIP spec does not permit and which can leave the
# uploaded extension unable to find its own files.
#
#   .\build.ps1                 -> dist\vault-dweller-<version>.zip
#   .\build.ps1 -OutDir C:\tmp  -> writes elsewhere

param(
    [string]$OutDir = (Join-Path $PSScriptRoot 'dist')
)

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot

# Everything the extension needs at runtime, and nothing else.
$include = @(
    'manifest.json',
    'background.js',
    'content.js',
    'popup.html',
    'popup.css',
    'popup.js',
    'icons',
    'fonts'
)

$manifest = Get-Content (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version
if (-not $version) { throw 'manifest.json has no version' }

$missing = $include | Where-Object { -not (Test-Path (Join-Path $src $_)) }
if ($missing) { throw "missing from the package: $($missing -join ', ')" }

# A shipped privacy link that 404s is worse than none: the store listing points
# at the same policy, and a reviewer will click it.
$popup = Get-Content (Join-Path $src 'popup.html') -Raw
if ($popup -match 'PRIVACY_URL_PLACEHOLDER') {
    throw ("popup.html still has PRIVACY_URL_PLACEHOLDER. Set the hosted policy " +
           "URL on #privacy-link (e.g. https://<user>.github.io/<repo>/privacy.html) " +
           "before building.")
}
if ($popup -notmatch 'id="privacy-link"[^>]*href="https://') {
    throw 'popup.html: #privacy-link must point at an https URL.'
}

# Flatten the allow-list into (absolute path -> entry name) pairs.
$files = @()
foreach ($item in $include) {
    $full = Join-Path $src $item
    if (Test-Path $full -PathType Container) {
        Get-ChildItem $full -Recurse -File | ForEach-Object {
            $rel = $_.FullName.Substring($src.Length + 1) -replace '\\', '/'
            $files += [pscustomobject]@{ Path = $_.FullName; Name = $rel }
        }
    }
    else {
        $files += [pscustomobject]@{ Path = $full; Name = $item }
    }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$zip = Join-Path $OutDir "vault-dweller-$version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$stream = [IO.File]::Open($zip, [IO.FileMode]::Create)
try {
    $archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($f in $files) {
            $entry = $archive.CreateEntry($f.Name, [IO.Compression.CompressionLevel]::Optimal)
            $out = $entry.Open()
            try {
                $bytes = [IO.File]::ReadAllBytes($f.Path)
                $out.Write($bytes, 0, $bytes.Length)
            }
            finally { $out.Dispose() }
        }
    }
    finally { $archive.Dispose() }
}
finally { $stream.Dispose() }

# Verify the artifact rather than trusting the build.
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
    $entries = $archive.Entries | ForEach-Object { $_.FullName }

    if ($entries -notcontains 'manifest.json') {
        throw 'manifest.json is not at the zip root'
    }
    $backslashed = $entries | Where-Object { $_ -match '\\' }
    if ($backslashed) {
        throw "entries use backslashes: $($backslashed -join ', ')"
    }
    $stowaways = $entries | Where-Object { $_ -match '^(\.git|android|ios|web|dist)/' }
    if ($stowaways) {
        throw "package contains excluded paths: $($stowaways -join ', ')"
    }
    $count = $entries.Count
}
finally {
    $archive.Dispose()
}

$size = (Get-Item $zip).Length
Write-Host "built  $zip"
Write-Host "       $count files, $([math]::Round($size / 1KB, 1)) KB, version $version"
Write-Host ''
Write-Host 'Next: load the unpacked folder in chrome://extensions and test the overlay'
Write-Host 'on a real Vault page before uploading.'
