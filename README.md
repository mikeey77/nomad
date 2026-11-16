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
   Op je telefoon/iPad (zelfde wifi): scan de QR-code op het dashboard en kies *Zet op beginscherm*.
   Windows vraagt de eerste keer of Python op het netwerk mag: kies **Privénetwerken → Toegang toestaan**.

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

- **App**: `Start NOMAD.bat` haalt bij elke start automatisch de nieuwste app-code van GitHub
  (alleen `app\`, je data en tools blijven staan). Setup hoeft nooit opnieuw.
- **Data** (`.zim`-collecties, AI-model): als er internet is kijkt NOMAD elke 30 min of er
  nieuwere versies zijn. Je krijgt een melding bij **Update** en downloadt pas als je zelf klikt.

## Sneltoetsen

`Ctrl+K` / `/` zoeken in alles · `Shift+Enter` zoeken in alle tekst · `R` willekeurig artikel · `Alt+←/→` terug/vooruit
