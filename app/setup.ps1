# PROJECT NOMAD — setup
# Zet alle benodigde programma's op de SSD (NOMAD\tools), zodat NOMAD daarna volledig offline werkt.
# Je kunt dit script altijd opnieuw draaien: wat er al staat wordt overgeslagen.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Root  = Split-Path -Parent $PSScriptRoot
$Tools = Join-Path $Root "tools"
$DL    = Join-Path $Root "downloads"
$AI    = Join-Path $Root "ai\modellen"
$Geo   = Join-Path $Root "data\zoeken"
New-Item -ItemType Directory -Force -Path $Tools, $DL, $AI, $Geo | Out-Null

$cfg = Get-Content (Join-Path $PSScriptRoot "config.json") -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
$Model = if ($cfg -and $cfg.ai_model) { $cfg.ai_model } else { "llama3.2:3b" }

function Say($t, $c = "Green") { Write-Host "  $t" -ForegroundColor $c }
function Step($t) { Write-Host ""; Write-Host "  ▸ $t" -ForegroundColor Cyan }
function Get-File($url, $out) {
  & curl.exe -L --fail --retry 5 --retry-delay 5 -C - -o "$out" "$url"
  if ($LASTEXITCODE -ne 0) { throw "Download mislukt: $url" }
}
function Latest-Asset($repo, $pattern) {
  $rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "NOMAD" }
  $a = $rel.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
  if (-not $a) { throw "Geen bestand gevonden in $repo dat past bij $pattern" }
  return $a
}

Write-Host ""
Write-Host "  ███ PROJECT NOMAD — SETUP ███" -ForegroundColor Green
Write-Host "  SSD-map: $Root"

# 1 ─ Portable Python + libzim
Step "Python (portable) + libzim"
$py = Join-Path $Tools "python\python.exe"
if (-not (Test-Path $py)) {
  $a = Latest-Asset "astral-sh/python-build-standalone" '^cpython-3\.12\.\d+\+\d+-x86_64-pc-windows-msvc-install_only\.tar\.gz$'
  $f = Join-Path $DL $a.name
  Get-File $a.browser_download_url $f
  tar -xzf "$f" -C "$Tools"
  Say "Python geïnstalleerd in tools\python"
} else { Say "Python staat er al" }
& $py -m pip install --upgrade --quiet pip libzim
Say "libzim klaar"

# 2 ─ Ollama + AI-model
Step "Lokale AI (Ollama) + model $Model"
$ol = Join-Path $Tools "ollama\ollama.exe"
if (-not (Test-Path $ol)) {
  $f = Join-Path $DL "ollama-windows-amd64.zip"
  Get-File "https://github.com/ollama/ollama/releases/latest/download/ollama-windows-amd64.zip" $f
  Expand-Archive -Force $f (Join-Path $Tools "ollama")
  Say "Ollama geïnstalleerd in tools\ollama"
} else { Say "Ollama staat er al" }
$env:OLLAMA_MODELS = $AI
$env:OLLAMA_HOST = "127.0.0.1:11434"
$srv = $null
try { Invoke-RestMethod "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 | Out-Null } catch {
  $srv = Start-Process -FilePath $ol -ArgumentList "serve" -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 4
}
& $ol pull $Model
if ($srv) { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue }
Say "Model $Model staat in ai\modellen"

# 3 ─ Java + Photon (adres zoeken)
Step "Adres zoeken (Java + Photon)"
$java = Join-Path $Tools "java\bin\java.exe"
if (-not (Test-Path $java)) {
  $f = Join-Path $DL "jre21.zip"
  Get-File "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse" $f
  $tmp = Join-Path $Tools "_java"
  Expand-Archive -Force $f $tmp
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  Move-Item $inner.FullName (Join-Path $Tools "java")
  Remove-Item $tmp -Recurse -Force
  Say "Java geïnstalleerd in tools\java"
} else { Say "Java staat er al" }
$pdir = Join-Path $Tools "photon"
New-Item -ItemType Directory -Force -Path $pdir | Out-Null
if (-not (Get-ChildItem $pdir -Filter "photon*.jar" -ErrorAction SilentlyContinue)) {
  try { $a = Latest-Asset "komoot/photon" '^photon-\d[\d.]*\.jar$' } catch { $a = Latest-Asset "komoot/photon" '^photon.*\.jar$' }
  Get-File $a.browser_download_url (Join-Path $pdir $a.name)
  Say "Photon $($a.name) geïnstalleerd"
} else { Say "Photon staat er al" }

$dump = Get-ChildItem $DL -Filter "photon-db-*.tar.bz2" -ErrorAction SilentlyContinue | Select-Object -First 1
$hasDb = Test-Path (Join-Path $Geo "photon_data")
if ($dump -and -not $hasDb) {
  Say "Photon-database gevonden: $($dump.Name)" "Yellow"
  $a = Read-Host "  Nu uitpakken naar data\zoeken? Dit kan uren duren en vraagt ~95 GB. (j/n)"
  if ($a -eq "j") {
    tar -xjf "$($dump.FullName)" -C "$Geo"
    Say "Database uitgepakt. Je mag $($dump.Name) nu verwijderen."
  }
} elseif ($hasDb) { Say "Adresdatabase staat er al" }
else { Say "Nog geen adresdatabase. Zet photon-db-planet-...tar.bz2 in downloads\ en draai setup opnieuw." "Yellow" }

# 4 ─ overzicht
Step "Klaar"
$zims = (Get-ChildItem (Join-Path $Root "data\bibliotheek") -Filter *.zim -ErrorAction SilentlyContinue).Count
$world = Test-Path (Join-Path $Root "data\kaart\basis\world.pmtiles")
$terr  = Test-Path (Join-Path $Root "data\kaart\hoogte\terrain.pmtiles")
Say ("Bibliotheek: {0} .zim-bestand(en)" -f $zims)
Say ("Wereldkaart: " + ($(if ($world) { "ja" } else { "nee (data\kaart\basis\world.pmtiles)" })))
Say ("Hoogtekaart: " + ($(if ($terr) { "ja" } else { "nee (data\kaart\hoogte\terrain.pmtiles)" })))
Write-Host ""
Say "Start NOMAD nu met 'Start NOMAD.bat'." "Cyan"
Write-Host ""
