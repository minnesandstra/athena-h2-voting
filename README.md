# AthenA H2-O Match Awards

Mobiele stemsite voor AthenA H2-O met drie prijzen:

- 🏆 Man of the Match
- 💩 Dick of the Day
- 🔥 Sexy Moment

De frontend draait op GitHub Pages. Stemmen worden via Google Apps Script opgeslagen in de Google Sheet **AthenA H2-O Match Awards**.

## Bestanden

- `index.html` — mobiele stempagina
- `styles.css` — styling
- `app.js` — stemlogica
- `config.js` — publieke Apps Script Web App URL
- `apps-script/Code.gs` — Google Apps Script-backend
- `players.txt` — huidige selectie

## Huidige status

De site staat in GitHub en draait voorlopig in demo-modus totdat de Google Apps Script Web App URL in `config.js` is ingevuld.

## Google Sheet

De Google Sheet is al aangemaakt en bevat:

- `Matches`
- `Players`
- `Moments`
- `Votes`
- `Results`
- `Receipts`
- `VoterCodes`

## Apps Script koppelen

1. Open de Google Sheet **AthenA H2-O Match Awards**.
2. Kies **Extensies → Apps Script**.
3. Verwijder de standaardcode.
4. Kopieer de inhoud van `apps-script/Code.gs` uit deze repository naar Apps Script.
5. Sla op.
6. Kies **Implementeren → Nieuwe implementatie**.
7. Selecteer **Web-app**.
8. Uitvoeren als: **Ik**.
9. Toegang: **Iedereen**.
10. Klik **Implementeren** en kopieer de URL die eindigt op `/exec`.
11. Zet die URL in `config.js` bij `API_URL`.

De URL in `config.js` is geen geheime sleutel. De validatie en schrijflogica blijven in Apps Script.

## GitHub Pages inschakelen

Open in deze repository:

**Settings → Pages**

Kies daarna:

- Source: **Deploy from a branch**
- Branch: **main**
- Folder: **/ (root)**

De site wordt daarna gepubliceerd op:

`https://minnesandstra.github.io/athena-h2-voting/`

## Stemvenster

Bij wedstrijden met een bekende begintijd opent stemmen automatisch 90 minuten na de begintijd en sluit 30 uur na de begintijd.

In het tabblad `Matches` kun je `status` ook handmatig op `open`, `closed` of `scheduled` zetten.

## Eén stem per browser

Versie 1 blokkeert server-side één stem per browser per wedstrijd. Voor strengere controle kan `REQUIRE_VOTER_CODE` in `Code.gs` op `true` worden gezet en kunnen unieke stemcodes worden gegenereerd.
