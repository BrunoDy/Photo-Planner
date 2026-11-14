# 📷 Fotospot Planner

Eén overzicht voor landschapsfotografen. De app combineert:

1. **Locaties spotten en bewaren.** Je bewaart plekken via de kaart (OSM, satelliet of topo), via zoeken of met je GPS-positie, met labels, notities en een kijkrichting.
2. **Afstand en reistijd.** De app rekent vanaf je huidige positie of een vast vertrekpunt, geeft een vertrektijd en een routeknop naar Google Maps.
3. **Zon en maan, zoals de PhotoPills-planner.** Voor elke datum zie je het blauwe uur, het gouden uur, zonsopkomst en -ondergang met hun richting, de maanfase en maanopkomst. Op de kaart staan lijnen voor de opkomst- en ondergangsrichting. Er is ook een check of de zon in je kijkrichting staat ("achter het kerkje").
4. **Weer, zoals Clear Outside.** De app haalt per uur de verwachting op via Open-Meteo: dauwpunt, vochtigheid, wind, zicht en lage, middelhoge en hoge bewolking.
5. **De match.** Het tabblad **Kansen** zet elke gelabelde locatie tegenover het weer van de komende dagen. Een voorbeeld: *"Morgen 07:58 – Mist · Kluisbos – score 86 – vertrek 06:50"*.

## Condities en hoe ze gescoord worden

| Label | Moment | Wat telt |
|---|---|---|
| 🌫️ Mist | zonsopkomst | kleine dauwpuntspreiding (T − Td), windstil, heldere nacht (afkoeling), laag zicht, geen regen |
| 🌅 Zonsopkomst / 🌇 Zonsondergang | zon op/onder | 30–70 % middelhoge of hoge wolken (kleur), weinig lage bewolking (die blokkeert de zon), geen regen, bonus als de zon in je kijkrichting staat |
| ✨ Sterren | beste uur van de echt donkere nacht | weinig bewolking, maan onder de horizon of een smalle sikkel, niet te vochtig |
| ☁️ Zacht licht | beste uur overdag | egale bewolking voor bos, watervallen en portret, zonder regen of veel wind |

De scores (0–100) zijn een inschatting op basis van de verwachting, geen garantie. De formules staan in `js/scoring.js` en zijn makkelijk bij te stellen.

## Gebruiken

Het is een PWA zonder build-stap. Serveer de map via http(s) en open ze op je telefoon. Daarna kun je ze via *Toevoegen aan beginscherm* installeren.

```bash
cd photo-planner
python3 -m http.server 8080   # open http://localhost:8080
npm test                      # unit tests (Node 18+)
```

Voor gebruik op je telefoon moet de app via **https** bereikbaar zijn (nodig voor GPS en installatie). Bijvoorbeeld via GitHub Pages (Settings → Pages → Deploy from branch, map `/ (root)`), Netlify of Cloudflare Pages.

- **Toevoegen:** tik op ＋ op de kaart en dan op de plek, of druk lang op de kaart. Je kunt ook "＋ Nieuw" gebruiken (huidige positie) of zoeken.
- **Kijkrichting:** vul de graden in of tik op 🧭 *Meet* en richt je telefoon naar het onderwerp.
- **Import:** eigen back-up (JSON), GeoJSON (Google Takeout → Maps → *Opgeslagen plaatsen*), GPX-waypoints, KML-placemarks.
- **Back-up:** de locaties staan in de browser van je toestel. Exporteer ze geregeld via Instellingen.

## Structuur

```
index.html            UI-skelet (4 tabbladen + locatiedialoog)
css/app.css           donker thema, mobiel eerst
js/app.js             UI, kaart, dialogen
js/planner.js         locatie × zon/maan × weer → kansen
js/scoring.js         scoremodellen (puur, getest)
js/weather.js         Open-Meteo ophalen + cache (1 u)
js/geo.js             afstand, richting, reistijd
js/store.js           opslag, import/export
sw.js                 offline app-shell
vendor/               Leaflet 1.9.4, SunCalc 1.9.0 (BSD-2)
tests/                node:test unit tests
```

Bronnen: weer © [Open-Meteo](https://open-meteo.com) (CC BY 4.0), kaart © OpenStreetMap-bijdragers, satelliet © Esri, topo © OpenTopoMap.
