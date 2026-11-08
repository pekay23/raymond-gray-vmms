param([switch]$Initial)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    if (Test-Path -LiteralPath (Join-Path $projectRoot '.codegraph')) {
        & codegraph sync
    } else {
        & codegraph init --yes $projectRoot
    }
    if ($LASTEXITCODE -ne 0) { throw 'CodeGraph refresh failed.' }
    if ($Initial -or -not (Test-Path -LiteralPath (Join-Path $projectRoot 'graphify-out'))) {
        & graphify extract $projectRoot --code-only --no-cluster --max-workers 2
    } else {
        & graphify update $projectRoot --no-cluster
    }
    if ($LASTEXITCODE -ne 0) { throw 'Graphify refresh failed.' }
} finally {
    Pop-Location
}
