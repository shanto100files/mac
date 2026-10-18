param(
    [Parameter(Mandatory = $true)][string]$InputDirectory,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [string]$MakeAppxPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Read the package manifests rather than trusting artifact names.
$packages = @(Get-ChildItem -LiteralPath $InputDirectory -Recurse -File -Filter '*.msix')
if ($packages.Count -ne 2) {
    throw "Expected exactly two MSIX packages (x64 and arm64), found $($packages.Count)."
}
$identities = @()
foreach ($package in $packages) {
    $archive = [IO.Compression.ZipFile]::OpenRead($package.FullName)
    try {
        $entry = $archive.GetEntry('AppxManifest.xml')
        if ($null -eq $entry) { throw "Missing manifest: $($package.Name)" }
        $reader = [IO.StreamReader]::new($entry.Open())
        try { [xml]$manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
        $identities += $manifest.Package.Identity
    } finally { $archive.Dispose() }
}
$architectures = @($identities | ForEach-Object { $_.ProcessorArchitecture } | Sort-Object)
if (($architectures -join ',') -ne 'arm64,x64') {
    throw "Expected arm64 and x64 packages, received: $($architectures -join ',')."
}
foreach ($field in @('Name', 'Publisher', 'Version')) {
    if ([string]::IsNullOrWhiteSpace($identities[0].$field) -or
        $identities[0].$field -cne $identities[1].$field) {
        throw "MSIX package identities must have the same $field."
    }
}

if (!$MakeAppxPath) {
    $sdkBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
    $sdkTools = @(Get-ChildItem -Path "$sdkBin/*/x64/makeappx.exe" |
        Sort-Object { [version]$_.Directory.Parent.Name })
    if (!$sdkTools.Count) { throw 'MakeAppx.exe not found. Install the Windows SDK.' }
    $MakeAppxPath = $sdkTools[-1].FullName
}

$destination = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
$staging = Join-Path ([IO.Path]::GetTempPath()) ("vega-msix-bundle-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $staging | Out-Null
try {
    for ($index = 0; $index -lt $packages.Count; $index++) {
        Copy-Item -LiteralPath $packages[$index].FullName -Destination (
            Join-Path $staging "$($identities[$index].ProcessorArchitecture).msix")
    }
    & $MakeAppxPath bundle /o /d $staging /p $destination /bv $identities[0].Version
    if ($LASTEXITCODE -ne 0) { throw "MakeAppx bundle failed with exit code $LASTEXITCODE." }
    if (!(Test-Path -LiteralPath $destination -PathType Leaf)) { throw 'No MSIX bundle was created.' }
    Write-Host "Created Store bundle: $destination"
} finally {
    # Only remove the uniquely named staging directory created by this invocation.
    $resolvedStaging = [IO.Path]::GetFullPath($staging)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
    if ([IO.Path]::GetDirectoryName($resolvedStaging) -ne $tempRoot -or
        [IO.Path]::GetFileName($resolvedStaging) -notmatch '^vega-msix-bundle-[0-9a-f-]+$') {
        throw 'Refusing to remove an unexpected MSIX staging directory.'
    }
    Remove-Item -LiteralPath $staging -Recurse -Force
}
