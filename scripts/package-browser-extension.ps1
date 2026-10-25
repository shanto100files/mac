$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $desktopRoot 'browser-extension'
$manifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'manifest.json') -Raw | ConvertFrom-Json
$outputRoot = Join-Path $desktopRoot 'dist-extension'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$outputPath = Join-Path $outputRoot ("vega-browser-host-{0}.zip" -f $manifest.version)
$files = @('manifest.json', 'background.mjs', 'app-policy.mjs', 'access.mjs', 'policy.mjs', 'http.mjs', 'media.mjs', 'verification.mjs', 'networkPolicy.mjs', 'network-guard.mjs', 'cookieRules.mjs', 'THIRD_PARTY_NOTICES.txt', 'page-bridge.js', 'content.js', 'popup.html', 'popup.css', 'popup.js', 'icons') | ForEach-Object {Join-Path $extensionRoot $_}
Compress-Archive -LiteralPath $files -DestinationPath $outputPath -Force
Write-Output "Built $outputPath"
