# PROJECT NOMAD

Mijn eigen offline kennis- en wereldserver op een 2 TB SSD. Werkt volledig zonder internet.

| Module | Inhoud | Bron |
|---|---|---|
| 📚 Bibliotheek | Wikipedia (EN, maxi), Gutenberg, iFixit, Wikibooks, LibreTexts, mdwiki… | Kiwix `.zim` |
| 🗺️ Wereldkaart | Straten, gebouwen, plaatsnamen | Protomaps `.pmtiles` (OpenStreetMap) |
| ⛰️ Hoogte | Reliëf + 3D-terrein | JAXA AW3D30 terrarium `.pmtiles` |
| 🛰️ Satelliet | (nog te bepalen) | `.pmtiles` |
| 📍 Adres zoeken | Wereldwijd zoeken op adres/plaats | Photon (OSM) |
| 🤖 AI | Lokale chat, met Wikipedia als bron | Ollama |

## Installatie op de SSD

```
git clone https://github.com/mikeey77/nomad.git X:\NOMAD
```
(of download de zip en pak uit naar `X:\NOMAD`)

1. Download de data: zie **LINKS.txt** en de `_WAT_HOORT_HIER.txt` in elke map.
2. Dubbelklik **Setup NOMAD.bat**: zet portable Python, Ollama + AI-model, Java en Photon in `tools\`.
3. Dubbelklik **Start NOMAD.bat** → http://localhost:8090
   `Start NOMAD (iPad en netwerk).bat` maakt hem ook bereikbaar op je thuisnetwerk.

## Mappen

```
NOMAD\
├─ app\                 de app (deze repo)
├─ data\bibliotheek\    *.zim
├─ data\kaart\basis\    world.pmtiles
├─ data\kaart\hoogte\   terrain.pmtiles
├─ data\kaart\satelliet satellite.pmtiles
├─ data\zoeken\         photon_data\
├─ ai\modellen\         Ollama-modellen
├─ tools\               python, ollama, java, photon
└─ downloads\           tijdelijke/oude bestanden
```

## Updates

Als er internet is, kijkt NOMAD elke 30 min of er nieuwere versies zijn van je `.zim`-collecties,
het AI-model en de app (als NOMAD een git-clone is). Je krijgt een melding bij **Update**;
er wordt nooit iets gedownload zonder dat je zelf op *Updaten* klikt.

## Sneltoetsen

`Ctrl+K` / `/` zoeken in alles · `Shift+Enter` zoeken in alle tekst · `R` willekeurig artikel · `Alt+←/→` terug/vooruit
