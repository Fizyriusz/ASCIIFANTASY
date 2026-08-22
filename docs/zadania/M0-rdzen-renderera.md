# M0 — Rdzeń renderera: marsz kolumnowy po spanach

**Cel:** zastąpić parę „DDA + floor-casting" z prototypu jedną pętlą, która renderuje
teren, budynki, mosty i wnętrza z modelu spanów. Po tym zadaniu silnik potrafi to samo
co prototyp, ale na strukturze, która uniesie resztę gry.

Przeczytaj wcześniej: `CLAUDE.md`, `docs/architektura.md` §2.1 i §3.
Prototyp odniesienia: `docs/prototyp/ascii-city.html` (otwórz w przeglądarce, pochodź).

---

## Zakres

### Wolno dotykać

```
packages/core/src/raymarch.ts       ← główna implementacja
packages/core/src/materials.ts      ← nowy plik
packages/core/src/index.ts          ← eksporty
packages/world/src/grid.ts          ← nowy: prosta siatka spanów w pamięci
packages/world/src/index.ts         ← eksporty
tools/harness/src/scene.ts          ← nowy: scena referencyjna
tools/harness/src/raymarch.test.ts  ← nowy: snapshoty
apps/game/src/main.ts               ← podmiana drawPlaceholder na render
```

### Nie dotykać

`screen.ts`, `blit.ts`, `color.ts`, `metrics.ts`, `rng.ts` — są gotowe i przetestowane.
Jeśli uważasz, że któryś wymaga zmiany, napisz to w podsumowaniu zamiast zmieniać.

---

## Co ma powstać

### 1. `world/grid.ts` — siatka spanów

Prosty, nieproceduralny magazyn na potrzeby M0 (generacja to M1):

```ts
class SpanGrid implements RenderTarget {
  constructor(width: number, height: number);
  setColumn(cx: number, cy: number, spans: Span[]): void;
  // + implementacja RenderTarget z core/raymarch.ts
}
```

Zawijanie współrzędnych maską (rozmiar = potęga dwójki), tak jak w prototypie — dzięki
temu świat testowy jest nieskończony i nie ma warunków brzegowych w rendererze.

Dodatkowo funkcja `buildTestCity(seed): SpanGrid` odtwarzająca układ z prototypu:
siatka ulic co 8 komórek, aleje co 32, kwartały budynków 1–3 komórek, wysokości z szumu.
To jest **tymczasowe** i w M1 zniknie — nie inwestuj w jakość tej generacji.

### 2. `core/materials.ts` — materiały

```ts
interface Material {
  glyphsBright: readonly number[];
  glyphsMid: readonly number[];
  glyphsDark: readonly number[];
  r: number; g: number; b: number;
  roughness: number;   // 0..1, ile szumu w doborze glifu
  emissive: number;    // 0..1
}
```

Tablica materiałów indeksowana przez `MaterialId`, na start ~10 sztuk (kamień, tynk,
szkło, asfalt, chodnik, trawa, woda, drewno, metal, latarnia).

**Dobór glifu:** `luminancja → rampa → hash(pozycja ŚWIATA) → konkretny glif`.
Hash liczysz z zaokrąglonych współrzędnych świata i wysokości, nigdy z pozycji na ekranie
— inaczej tekstura pływa przy chodzeniu i wygląda to jak błąd, którym jest.

### 3. `core/raymarch.ts` — marsz kolumnowy

Sygnatury i bufory są już w pliku. Zaimplementuj:

```ts
function renderColumn(
  target: RenderTarget, cam: Camera, screen: Screen,
  col: number, hits: ColumnHits, ctx: RenderContext,
): void;

function renderWorld(
  target: RenderTarget, cam: Camera, screen: Screen, ctx: RenderContext,
): void;
```

Algorytm w komentarzu na górze pliku. Punkty krytyczne:

- **Projekcja:** `Kh = (cols/2) / tan(fov/2)`, `Kv = Kh * (cellW/cellH)`.
  Wiersz dla wysokości `z` w odległości `d`: `row = horizon - (z - eyeZ) * Kv / d`.
  Horyzont: `rows/2 + tan(pitch) * Kv`.
- **Odległość prostopadła**, nie euklidesowa — inaczej dostaniesz rybie oko.
- **Dwa fronty wypełniania, nie jeden.** Pierwotny szkic tego zlecenia mówił
  o pojedynczym `minRow` rosnącym w górę. To renderuje poprawnie wszystko, na co
  patrzymy z góry, ale **gubi każdą powierzchnię nad okiem** — spód mostu i sufit
  wnętrza, czyli dokładnie te dwa przypadki, dla których w ogóle wprowadzamy spany.
  Poprawna wersja trzyma dwa fronty:

  ```
  loRow = rows      // najwyższy wiersz zamalowany od dołu
  hiRow = -1        // najniższy wiersz zamalowany od góry
  dla każdej komórki na trasie DDA:
    spany z bottom < eyeZ, od góry:      → front dolny, wypełnia w górę do loRow-1
    spany z bottom >= eyeZ, od dołu:     → front górny, wypełnia w dół do hiRow+1
    jeśli hiRow + 1 >= loRow: przerwij   // fronty się spotkały, kolumna pełna
  ```

  Fronty są swoimi lustrzanymi odbiciami i spotykają się w okolicach horyzontu.
  Warunkiem końca kolumny jest ich zetknięcie, a nie `minRow <= 0`.
- **Odrzucanie zasłoniętych:** span, którego krawędź wypada na `loRow` lub niżej
  (odpowiednio: na `hiRow` lub wyżej), jest niewidoczny w całości. To poprawne,
  bo bliższa geometria ma zawsze niższy dolny wiersz.
- **Podział na czapkę i ścianę wynika z poprzedniej powierzchni w kolumnie,
  nie z dolnej krawędzi spanu.** Drugi błąd pierwotnego szkicu: reguła
  „czapka: `rowTop .. min(rowBot, minRow-1)`" maluje fasadę wieżowca materiałem
  dachu, bo dla wysokiego spanu `rowBot` wypada poniżej dotychczasowego frontu
  i cały pasek idzie jako czapka. Poprawnie:

  ```
  capZ  = min(poprzednia_powierzchnia, span.top)     // niższa z dwóch wygrywa
  ściana: od rzutu span.top do rzutu max(capZ, span.bottom)   → mat
  czapka: reszta paska do loRow-1, floor-cast na płaszczyźnie capZ → capMat
  ```

  Dla płaskiego terenu obie wysokości są równe, ściana wychodzi pusta i zostaje
  sama czapka. Dla budynku ściana to fasada, a czapka to pasek ulicy u jej stóp.
  Ograniczenie ściany także **własnym spodem spanu** jest konieczne: bez niego
  przęsło mostu oglądane z dołu zamalowuje całe niebo nad sobą.
- **Czapka spanu** (górna powierzchnia) i **ściana boczna** to dwa różne materiały
  i dwa różne sposoby próbkowania: czapka po pozycji XY, ściana po `wallU` i wysokości.
- **Mgła:** `exp(-d / fogDist)` mnoży luminancję. `fogDist` w `RenderContext`.
- **Cieniowanie boków:** ściany prostopadłe do Y mnożymy przez 0.7. To jedyne, co daje
  czytelność brył w monochromatycznym renderze — bez tego wszystko się zlewa.

### 4. Scena referencyjna i snapshoty

`tools/harness/src/scene.ts`:

```ts
export const REFERENCE = {
  seed: 1337,
  camera: { x: 33.0, y: 32.5, eyeZ: 0.9, yaw: Math.PI / 2, pitch: 0.06, fov: (74 * Math.PI) / 180 },
  cols: 150, rows: 48,
} as const;
```

Snapshoty do zrobienia (każdy jako osobny plik złoty):

| Nazwa | Co sprawdza |
|---|---|
| `ref-street` | scena referencyjna, kamera domyślna |
| `ref-turned` | ta sama scena, `yaw + 0.7` — łapie błędy projekcji poza osią |
| `ref-pitch-up` | `pitch = 0.4` — łapie błędy horyzontu |
| `bridge` | ręczna komórka z dwoma spanami — most nad ulicą |
| `interior` | komórka ze spanem sufitu — kamera pod nim |
| `empty` | pusta siatka — musi dać czysty ekran, nie śmieci |

Snapshot `bridge` i `interior` są ważniejsze niż ładny widok ulicy: to one dowodzą,
że model spanów działa, i to one są powodem całego tego zadania.

---

## Definicja ukończenia

1. `pnpm typecheck`, `pnpm test`, `pnpm test:snap` — zielone.
2. Wszystkie 6 snapshotów istnieje i jest stabilne (dwa uruchomienia = ten sam wynik).
3. `pnpm bench` — `renderWorld` dla sceny referencyjnej **< 8 ms** (p95).
4. Zero alokacji w `renderWorld` i `renderColumn`. Udowodnij: bench mierzący
   `performance.memory` albo licznik alokacji w teście — wystarczy prosty test,
   który po 1000 klatkach sprawdza, że nie ma wzrostu tablic w `ColumnHits`.
5. `pnpm dev` pokazuje miasto, po którym da się chodzić (WASD + mysz), 60 fps na desktopie.
6. Podsumowanie w formacie z `CLAUDE.md`.

---

## Czego świadomie NIE robimy w M0

- generacji proceduralnej terenu (M1)
- streamingu chunków (M1)
- światła dynamicznego i pochodni (M2)
- sprite'ów, NPC, kolizji innych niż „nie wchodź w ścianę"
- UI, menu, ekwipunku

Jeśli kończysz wcześniej — nie dobieraj sobie zakresu. Napisz w podsumowaniu, co
proponujesz jako następne, i czekaj na kolejne zlecenie.

---

## Pułapki specyficzne dla tego zadania

1. **`wallU` liczony po zaokrągleniu odległości** → tekstura skacze co komórkę.
   Licz z dokładnej pozycji trafienia.
2. **Zapominanie o `perpDist` przy czapkach spanów** — czapka jest powierzchnią poziomą,
   więc jej wiersze wynikają z wysokości i odległości, nie z interpolacji między spanami.
3. **Front aktualizowany przed narysowaniem** → dziura o jeden wiersz na styku brył.
4. **Zmienne pętli deklarowane w środku bloku** w hot pathcie → V8 czasem alokuje.
   Deklaracje na górze funkcji, `let`, typy liczbowe stałe.
5. **Kolumna bez trafień** musi zostawić czyste tło, a nie poprzednią klatkę —
   `screen.clear()` jest w `renderWorld`, nie w pętli kolumn.
