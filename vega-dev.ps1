param([switch]$BuildOnly, [switch]$Release)

$ErrorActionPreference = 'Stop'

$vsRoot = 'C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools'
Import-Module "$vsRoot\Common7\Tools\Microsoft.VisualStudio.DevShell.dll"
Enter-VsDevShell -VsInstallPath $vsRoot -SkipAutomaticLocation `
    -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null

# Rust and winget's user-scope NASM are not visible to a shell that predates
# their install, so both go on PATH here rather than relying on a reload.
$env:PATH = @(
    "$env:USERPROFILE\.cargo\bin",
    "$env:LOCALAPPDATA\bin\NASM",
    'C:\Program Files\CMake\bin',
    $env:PATH
) -join ';'

# The repo lives on F: which only has a few GB free; cargo's target/ grows to
# several GB during a Tauri build, so it is redirected to C:.
$env:CARGO_TARGET_DIR = 'C:\vega-target'
if (-not (Test-Path $env:CARGO_TARGET_DIR)) { New-Item -ItemType Directory -Force -Path $env:CARGO_TARGET_DIR | Out-Null }

# bindgen (pulled by the dev feature set's TLS crates) needs libclang. The LLVM
# installer is machine-wide only, so the DLL from the pip `libclang` wheel is
# kept in a stable folder instead.
$env:LIBCLANG_PATH = "$env:USERPROFILE\.cargo\libclang"
if (-not (Test-Path "$env:LIBCLANG_PATH\libclang.dll")) { Write-Error "libclang.dll missing in $env:LIBCLANG_PATH" }

Set-Location 'F:\vega-desktop'

foreach ($tool in 'cl.exe', 'cargo', 'cmake', 'nasm') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Write-Error "$tool not found in dev shell" }
}
"cl.exe : $((Get-Command cl.exe).Source)"
"cargo  : $((Get-Command cargo).Source)"
"cmake  : $((Get-Command cmake).Source)"
"nasm   : $((Get-Command nasm).Source)"
"target : $env:CARGO_TARGET_DIR"

if ($Release) {
    # The updater signs each installer with a minisign key that stays out of the
    # repo; tauri reads the key and its passphrase from the environment.
    $signDir = "$env:USERPROFILE\.cinepix-signing"
    $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "$signDir\cinepix-updater.key" -Raw).Trim()
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content "$signDir\password.txt" -Raw).Trim()
    npm run tauri build
} elseif ($BuildOnly) { cargo build --manifest-path src-tauri/Cargo.toml } else { npm run tauri dev }
