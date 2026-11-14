# 📷 Fotospot Planner

Eén overzicht voor landschapsfotografen. De app combineert:

0. **Thuislocatie eerst.** Bij de eerste start kies je je thuis via GPS, een adres of de kaart. Daarvandaan rekent de app afstand, rijtijd en vertrekuur.
1. **Locaties spotten en bewaren.** Je bewaart plekken via de kaart (OSM, satelliet of topo), via zoeken of met je GPS-positie, met labels, notities en een kijkrichting.
2. **Afstand en reistijd.** De app rekent vanaf je huidige positie of een vast vertrekpunt, geeft een vertrektijd en een routeknop naar Google Maps.
3. **Zon en maan, zoals de PhotoPills-planner.** Voor elke datum zie je het blauwe uur, het gouden uur, zonsopkomst en -ondergang met hun richting, de maanfase en maanopkomst. Tik je op de kaart op een locatie, dan verschijnen lijnen voor zonsopkomst, zonsondergang, maanopkomst, maanondergang en de **melkwegkern** (op haar hoogste stand), telkens met het tijdstip op de lijn. Je kunt de datum kiezen. Er is ook een check of de zon in je kijkrichting staat ("achter het kerkje").
4. **Weer, zoals Clear Outside.** De app haalt per uur de verwachting op via Open-Meteo: dauwpunt, vochtigheid, wind, zicht en lage, middelhoge en hoge bewolking.
5. **Weerkaart van België** (🌦️ op de kaart), met twee modi:
   - **📡 Radar live:** geanimeerde neerslagradar van de laatste ±2 uur (RainViewer, beelden om de 10 minuten).
   - **☁️ Verwachting:** vloeiende kaart van bewolking en neerslag per uur, tot 48 uur vooruit (Open-Meteo), met een afspeelknop.
6. **Lichtvervuiling** (🌃 of via de lagenknop). Een laag met de nachtelijke lichtuitstoot (NASA VIIRS Black Marble), om donkere plekken voor sterrenfoto's te vinden.
7. **Bibliotheek** (tabblad 📚). Bij elke locatie, ook zonder labels, zie je:
   - het **weer van nu** (helder, bewolkt, neerslag of mist, plus temperatuur en wind);
   - de **mistkans** voor de komende 7 ochtenden (*grote kans*, *goede kans* of *kans*);
   - het **eerstvolgende goede moment** voor zonsopkomst, zonsondergang, sterren, melkweg en zacht licht.

   In het locatievenster staat een **vooruitzicht van 7 dagen**: een tabel met de score per conditie per dag.

   Verder bewaar je per locatie een voorbeeldfoto (eigen foto of van Commons), collecties (bv. "Ardennen", "Bucketlist"), een status (wil ik bezoeken / bezocht), een ⭐ favoriet en een bronlink. Je kunt filteren op collectie, status, favoriet en label.
8. **Plekken overnemen van andere sites.**
   - **📋 Plak link:** plak een link uit Google Maps, Apple Maps of OpenStreetMap, coördinaten (decimaal of 50°46'33"N 3°37'58"E), of een naam en adres. Op Locationscout en vergelijkbare sites kopieer je de kaartlink of de coördinaten van een spot.
   - **Delen naar de app** (Android, als de app geïnstalleerd is): in Google Maps of de browser tik je op *Delen → Fotospot Planner*.
   - **🖼️ Ontdek** op de kaart: foto's met locatie van Wikimedia Commons in de buurt. Tik op een foto → *Bewaar in bibliotheek*. De naam van de fotograaf en de licentie worden mee bewaard.
9. **De match.** Het tabblad **Kansen** zet elke gelabelde locatie tegenover het weer van de komende dagen. Een voorbeeld: *"Morgen 07:58 – Mist · Kluisbos – score 86 – vertrek 06:50"*.

## Condities en hoe ze gescoord worden

| Label | Moment | Wat telt |
|---|---|---|
| 🌫️ Mist | zonsopkomst | kleine dauwpuntspreiding (T − Td), windstil, heldere nacht (afkoeling), laag zicht, geen regen |
| 🌅 Zonsopkomst / 🌇 Zonsondergang | zon op/onder | 30–70 % middelhoge of hoge wolken (kleur), weinig lage bewolking (die blokkeert de zon), geen regen, bonus als de zon in je kijkrichting staat |
| ✨ Sterren | beste uur van de echt donkere nacht | weinig bewolking, maan onder de horizon of een smalle sikkel, niet te vochtig |
| 🌌 Melkweg | hoogste stand van de kern, binnen het donkere venster | kern boven de horizon terwijl het donker is (in België ±maart–september, maximaal ~10° hoog in het zuiden), weinig bewolking, geen maan, bonus als de kern in je kijkrichting staat |
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
- **Back-up:** de locaties en eigen foto's staan in de browser van je toestel. Exporteer ze geregeld via Instellingen; de eigen foto's zitten mee in het back-upbestand.

## Structuur

```
index.html            UI-skelet (4 tabbladen + locatiedialoog)
css/app.css           donker thema, mobiel eerst
js/app.js             UI, kaart, dialogen
js/planner.js         locatie × zon/maan × weer → kansen
js/scoring.js         scoremodellen (puur, getest)
js/weather.js         Open-Meteo ophalen + cache (1 u)
js/belgium.js         omtrek België + weerraster
js/linkparse.js       links/coördinaten herkennen
js/commons.js         Wikimedia Commons (Ontdek)
js/photos.js          eigen foto's (IndexedDB)
js/astro.js           melkwegkern (positie, zichtbaarheidsvenster)
js/radar.js           live neerslagradar (RainViewer)
js/wxrender.js        vloeiende weerkaart
js/geo.js             afstand, richting, reistijd
js/store.js           opslag, import/export
sw.js                 offline app-shell
vendor/               Leaflet 1.9.4, SunCalc 1.9.0 (BSD-2)
tests/                node:test unit tests
```

Bronnen: weer © [Open-Meteo](https://open-meteo.com) (CC BY 4.0), radar © [RainViewer](https://www.rainviewer.com), kaart © OpenStreetMap-bijdragers, satelliet © Esri, topo © OpenTopoMap, nachtlicht © NASA Black Marble (GIBS).
