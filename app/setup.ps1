# PROJECT NOMAD — setup
# Puts every program NOMAD needs on the SSD (NOMAD\tools), so NOMAD works fully offline afterwards.
# Safe to run again: anything already there is skipped.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Root  = Split-Path -Parent $PSScriptRoot
$Tools = Join-Path $Root "tools"
$DL    = Join-Path $Root "downloads"
$AI    = Join-Path $Root "ai\models"
$Geo   = Join-Path $Root "data\search"
# old Dutch folder names (renamed automatically by NOMAD; kept working until then)
if (-not (Test-Path $AI) -and (Test-Path (Join-Path $Root "ai\modellen"))) { $AI = Join-Path $Root "ai\modellen" }
if (-not (Test-Path $Geo) -and (Test-Path (Join-Path $Root "data\zoeken"))) { $Geo = Join-Path $Root "data\zoeken" }
New-Item -ItemType Directory -Force -Path $Tools, $DL, $AI, $Geo | Out-Null

$cfg = Get-Content (Join-Path $PSScriptRoot "config.json") -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
$Model = if ($cfg -and $cfg.ai_model) { $cfg.ai_model } else { "llama3.2:3b" }

function Say($t, $c = "Green") { Write-Host "  $t" -ForegroundColor $c }
function Step($t) { Write-Host ""; Write-Host "  ▸ $t" -ForegroundColor Cyan }
function Get-File($url, $out) {
  & curl.exe -L --fail --retry 5 --retry-delay 5 -C - -o "$out" "$url"
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
}
function Latest-Asset($repo, $pattern) {
  $rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "NOMAD" }
  $a = $rel.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
  if (-not $a) { throw "No file in $repo matches $pattern" }
  return $a
}

Write-Host ""
Write-Host "  ███ PROJECT NOMAD — SETUP ███" -ForegroundColor Green
Write-Host "  SSD folder: $Root"

# 1 ─ Portable Python + libzim
Step "Python (portable) + libzim"
$py = Join-Path $Tools "python\python.exe"
if (-not (Test-Path $py)) {
  $a = Latest-Asset "astral-sh/python-build-standalone" '^cpython-3\.12\.\d+\+\d+-x86_64-pc-windows-msvc-install_only\.tar\.gz$'
  $f = Join-Path $DL $a.name
  Get-File $a.browser_download_url $f
  tar -xzf "$f" -C "$Tools"
  Say "Python installed in tools\python"
} else { Say "Python already installed" }
& $py -m pip install --upgrade --quiet pip libzim
Say "libzim ready"

# 2 ─ Ollama + AI-model
Step "Local AI (Ollama) + model $Model"
$ol = Join-Path $Tools "ollama\ollama.exe"
if (-not (Test-Path $ol)) {
  $f = Join-Path $DL "ollama-windows-amd64.zip"
  Get-File "https://github.com/ollama/ollama/releases/latest/download/ollama-windows-amd64.zip" $f
  Expand-Archive -Force $f (Join-Path $Tools "ollama")
  Say "Ollama installed in tools\ollama"
} else { Say "Ollama already installed" }
$env:OLLAMA_MODELS = $AI
$env:OLLAMA_HOST = "127.0.0.1:11434"
$srv = $null
try { Invoke-RestMethod "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 | Out-Null } catch {
  $srv = Start-Process -FilePath $ol -ArgumentList "serve" -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 4
}
& $ol pull $Model
if ($srv) { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue }
Say "Model $Model is in ai\models"

# 3 ─ Java + Photon (address search)
Step "Address search (Java + Photon)"
$java = Join-Path $Tools "java\bin\java.exe"
if (-not (Test-Path $java)) {
  $f = Join-Path $DL "jre21.zip"
  Get-File "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse" $f
  $tmp = Join-Path $Tools "_java"
  Expand-Archive -Force $f $tmp
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  Move-Item $inner.FullName (Join-Path $Tools "java")
  Remove-Item $tmp -Recurse -Force
  Say "Java installed in tools\java"
} else { Say "Java already installed" }
$pdir = Join-Path $Tools "photon"
New-Item -ItemType Directory -Force -Path $pdir | Out-Null
if (-not (Get-ChildItem $pdir -Filter "photon*.jar" -ErrorAction SilentlyContinue)) {
  try { $a = Latest-Asset "komoot/photon" '^photon-\d[\d.]*\.jar$' } catch { $a = Latest-Asset "komoot/photon" '^photon.*\.jar$' }
  Get-File $a.browser_download_url (Join-Path $pdir $a.name)
  Say "Photon $($a.name) installed"
} else { Say "Photon already installed" }

$dump = Get-ChildItem $DL -Filter "photon-db-*.tar.bz2" -ErrorAction SilentlyContinue | Select-Object -First 1
$hasDb = Test-Path (Join-Path $Geo "photon_data")
if ($dump -and -not $hasDb) {
  Say "Photon database found: $($dump.Name)" "Yellow"
  $a = Read-Host "  Extract to data\search now? This can take hours and needs ~95 GB. (y/n)"
  if ($a -eq "y" -or $a -eq "j") {
    tar -xjf "$($dump.FullName)" -C "$Geo"
    Say "Database extracted. You can delete $($dump.Name) now."
  }
} elseif ($hasDb) { Say "Address database already there" }
else { Say "No address database yet. Put photon-db-planet-...tar.bz2 in downloads\ and run setup again." "Yellow" }

# 4 ─ summary
Step "Done"
$zims = (Get-ChildItem (Join-Path $Root "data\library") -Filter *.zim -ErrorAction SilentlyContinue).Count
$world = Test-Path (Join-Path $Root "data\maps\world\world.pmtiles")
$terr  = Test-Path (Join-Path $Root "data\maps\terrain\terrain.pmtiles")
Say ("Library: {0} .zim file(s)" -f $zims)
Say ("World map: " + ($(if ($world) { "yes" } else { "no (data\maps\world\world.pmtiles)" })))
Say ("Elevation map: " + ($(if ($terr) { "yes" } else { "no (data\maps\terrain\terrain.pmtiles)" })))
Write-Host ""
Say "Start NOMAD with NOMAD.exe." "Cyan"
Write-Host ""
