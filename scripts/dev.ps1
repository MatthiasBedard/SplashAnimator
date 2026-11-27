$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $nodeVersion = [version]((& $nodeCommand.Source --version).TrimStart('v')) }
if (-not $nodeCommand -or $nodeVersion -lt [version]'20.19.0') {
    if (Test-Path -LiteralPath $bundledNode) { $env:PATH = (Split-Path -Parent $bundledNode) + ';' + $env:PATH }
    else { throw 'Node 20.19+ is required. Install Node 22 LTS or use the Codex bundled runtime.' }
}
Push-Location $repoRoot
try { & pnpm dev @args; exit $LASTEXITCODE }
finally { Pop-Location }
