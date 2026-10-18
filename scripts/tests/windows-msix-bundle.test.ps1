$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Join-Path ([IO.Path]::GetTempPath()) ("vega-msix-test-" + [guid]::NewGuid())
$sdkBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$makeAppx = (Get-ChildItem -Path "$sdkBin/*/x64/makeappx.exe" |
    Sort-Object { [version]$_.Directory.Parent.Name } | Select-Object -Last 1).FullName
if (!$makeAppx) { throw 'Windows SDK is required for this test.' }
$bundler = Join-Path $PSScriptRoot '../bundle-windows-msix.ps1'
try {
    $packages = Join-Path $root 'packages'
    New-Item -ItemType Directory -Path $packages -Force | Out-Null
    foreach ($arch in @('x64', 'arm64')) {
        $content = Join-Path $root $arch
        New-Item -ItemType Directory -Path $content | Out-Null
        @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
 xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
 xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
 IgnorableNamespaces="uap rescap">
 <Identity Name="Vega.BundleTest" Publisher="CN=VegaTest" Version="1.2.3.0" ProcessorArchitecture="$arch" />
 <Properties><DisplayName>Vega Test</DisplayName><PublisherDisplayName>Vega</PublisherDisplayName><Logo>logo.png</Logo></Properties>
 <Resources><Resource Language="en-us" /></Resources>
 <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" /></Dependencies>
 <Applications><Application Id="App" Executable="test.exe" EntryPoint="Windows.FullTrustApplication">
 <uap:VisualElements DisplayName="Vega Test" Description="Bundle test" BackgroundColor="transparent" Square150x150Logo="logo.png" Square44x44Logo="logo.png" />
 </Application></Applications>
 <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
</Package>
"@ | Set-Content -LiteralPath (Join-Path $content 'AppxManifest.xml') -Encoding utf8
        Set-Content -LiteralPath (Join-Path $content 'test.exe') -Value 'fixture only'
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../../src-tauri/icons/128x128.png') -Destination (Join-Path $content 'logo.png')
        & $makeAppx pack /o /d $content /p (Join-Path $packages "$arch.msix") | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Fixture packaging failed.' }
    }
    $output = Join-Path $root 'test.msixbundle'
    & $bundler -InputDirectory $packages -OutputPath $output -MakeAppxPath $makeAppx
    $archive = [IO.Compression.ZipFile]::OpenRead($output)
    try {
        $entry = $archive.GetEntry('AppxMetadata/AppxBundleManifest.xml')
        $reader = [IO.StreamReader]::new($entry.Open())
        try { [xml]$manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
        $architectures = @($manifest.Bundle.Packages.Package | ForEach-Object { $_.Architecture } | Sort-Object)
        if (($architectures -join ',') -ne 'arm64,x64') { throw 'Bundle did not contain both architectures.' }
        if ($manifest.Bundle.Identity.Version -ne '1.2.3.0') { throw 'Bundle version mismatch.' }
    } finally { $archive.Dispose() }

    $armManifest = Join-Path $root 'arm64/AppxManifest.xml'
    (Get-Content -LiteralPath $armManifest -Raw).Replace('Version="1.2.3.0"', 'Version="1.2.4.0"') |
        Set-Content -LiteralPath $armManifest -Encoding utf8
    & $makeAppx pack /o /d (Join-Path $root 'arm64') /p (Join-Path $packages 'arm64.msix') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Mismatched version fixture packaging failed.' }
    $rejected = $false
    try { & $bundler -InputDirectory $packages -OutputPath $output -MakeAppxPath $makeAppx }
    catch { $rejected = $_.Exception.Message -like '*same Version*' }
    if (!$rejected) { throw 'Mismatched versions were not rejected.' }

    # A duplicated architecture must fail before invoking MakeAppx.
    Copy-Item -LiteralPath (Join-Path $packages 'x64.msix') -Destination (Join-Path $packages 'arm64.msix') -Force
    $rejected = $false
    try { & $bundler -InputDirectory $packages -OutputPath $output -MakeAppxPath $makeAppx }
    catch { $rejected = $_.Exception.Message -like 'Expected arm64 and x64*' }
    if (!$rejected) { throw 'Duplicate architectures were not rejected.' }
    Write-Host 'PASS: combined x64/arm64 bundle, version mismatch and duplicate architecture rejection.'
} finally {
    $resolved = [IO.Path]::GetFullPath($root)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
    if ([IO.Path]::GetDirectoryName($resolved) -ne $tempRoot -or
        [IO.Path]::GetFileName($resolved) -notmatch '^vega-msix-test-[0-9a-f-]+$') {
        throw 'Refusing to remove an unexpected test directory.'
    }
    Remove-Item -LiteralPath $root -Recurse -Force
}
