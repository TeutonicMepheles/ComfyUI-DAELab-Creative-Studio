param(
    [Parameter(Mandatory = $true)]
    [string]$InputDirectory
)
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'assets'
$inputRoot = (Resolve-Path -LiteralPath $InputDirectory).Path
$destination = Join-Path $inputRoot 'CreativeStudioShowcase'
$files = @(Get-ChildItem -LiteralPath $source -File)
foreach ($file in $files) {
    $target = Join-Path $destination $file.Name
    if ((Test-Path -LiteralPath $target) -and
        ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $target).Hash)) {
        throw "Existing file differs; nothing copied: $target"
    }
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($file in $files) {
    $target = Join-Path $destination $file.Name
    if (-not (Test-Path -LiteralPath $target)) {
        Copy-Item -LiteralPath $file.FullName -Destination $target
    }
}
Write-Output "Showcase assets ready: $destination"
