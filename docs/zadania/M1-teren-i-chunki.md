# M1 — Teren, biomy, chunki, streaming

**Cel:** świat większy niż ekran. Dzikie pustkowie — lasy, wzgórza, rzeki — generowane
proceduralnie, streamowane w tle, deterministyczne. Po tym zadaniu da się iść w jedną
stronę przez dziesięć minut i nie natrafić na koniec świata ani na zająknięcie.

Przy okazji rozdzielamy silnik od settingu: cyberpunkowe miasto z M0 przenosimy do
paczki contentu i odkładamy na bok. To nie sentyment — jeśli oba settingi działają na
tym samym rdzeniu, mamy dowód, że rozdział silnik/dane faktycznie istnieje, a nie tylko
jest zadeklarowany w dokumencie.

Przeczytaj wcześniej: `CLAUDE.md`, `docs/architektura.md` §2.2 i §4.

---

## Zakres

### Wolno dotykać
```
packages/content/                     ← nowa paczka
packages/world/src/terrain.ts         ← nowy
packages/world/src/hydro.ts           ← nowy
packages/world/src/biome.ts           ← nowy
packages/world/src/props.ts           ← nowy
packages/world/src/chunk.ts           ← nowy
packages/world/src/streaming.ts       ← nowy
packages/world/src/grid.ts            ← usunięcie buildTestCity
packages/world/src/index.ts
packages/core/src/materials.ts        ← paleta fantasy + wsparcie paczek
tools/harness/src/fixtures/           ← nowy katalog
tools/harness/src/*.test.ts
apps/game/src/main.ts
docs/zadania/M1-teren-i-chunki.md     ← jeśli znajdziesz w nim błąd, popraw go
```

### Nie dotykać
`raymarch.ts`, `screen.ts`, `blit.ts`, `color.ts`, `metrics.ts`, `hash.ts` — rdzeń
renderera jest zamknięty i przetestowany. M1 dostarcza mu danych, nie zmienia go.
Jeśli renderer wymaga zmiany, żeby M1 był wykonalny — napisz to w podsumowaniu
i zatrzymaj się, zamiast go modyfikować.

---

## Co ma powstać

### 1. `packages/content` — setting jako dane

Nowa paczka, zero logiki, same tabele i definicje:

```
packages/content/src/
├─ packs/
│  ├─ wild/          ← fantasy: materiały, biomy, roślinność  (aktywny)
│  └─ neon/          ← cyberpunk z M0: materiały + generator miasta (odłożony)
├─ types.ts          ← ContentPack, BiomeDef, MaterialDef, PropDef
└─ index.ts
```

```ts
interface ContentPack {
  id: string;
  materials: MaterialDef[];
  biomes: BiomeDef[];
  props: PropDef[];
}
```

**Paczka `neon`** to przeniesione `buildTestCity` plus jego materiały. Nie jest podpięta
do gry, ale **musi się budować i mieć własny snapshot** — inaczej po trzech milestone'ach
cicho zgnije. Traktuj ją jako test regresji na tezę „setting to dane".

**Paczka `wild`** — materiały: ziemia, trawa, mech, kamień, skała, piasek, żwir, woda,
kora, listowie, iglaki, martwe drewno, śnieg. Palety ziemiste i przygaszone; jaskrawy
neon z M0 jest tu wrogiem czytelności.

### 2. `terrain.ts` — wysokość

```ts
function terrainHeight(seed: number, wx: number, wy: number): number;  // metry
function terrainSlope(seed: number, wx: number, wy: number): number;   // 0..1
```

Czysta funkcja współrzędnych świata. To gwarantuje brak szwów **z konstrukcji** —
nie da się mieć niezgodności na granicy chunka, jeśli wysokość nigdy nie pyta o sąsiada.

- baza: `fbm` 5–6 oktaw, skala ~600 m na cechę
- grzbiety: `1 - |2*noise - 1|` (ridged) mieszane wagą z wysokości, żeby góry
  miały ostre granie, a niziny łagodne fałdy
- pustkowie ma być **chodliwe**: mediana nachylenia poniżej 15°, klify rzadkie
  i lokalne. Wzgórza mają zasłaniać widok, nie blokować ruch

### 3. `hydro.ts` — rzeki i woda

Rzeka potrzebuje wiedzy o sąsiedztwie, a chunk nie może pytać sąsiadów. Rozwiązanie:
**warstwa zgrubna**. Szkielet rzek generowany na siatce regionu (co 16 chunków),
deterministycznie z seeda; chunk pyta o segmenty przecinające jego prostokąt
z marginesem jednego chunka.

```ts
function riverSegments(seed: number, cx: number, cy: number): RiverSegment[];
function waterLevelAt(seed: number, wx: number, wy: number): number | null;
```

Rzeka wcina koryto w teren (obniżenie + wygładzenie w promieniu), poziom wody spada
wzdłuż biegu. Jeziora tam, gdzie spadek zanika. Morze poniżej wysokości 0.

**To jest najbardziej ryzykowna część M1** — jeśli koryto liczysz z lokalnego terenu,
a segment wchodzi z sąsiedniego chunka, dostajesz uskok dokładnie na granicy.

### 4. `biome.ts` — biomy

```ts
function biomeAt(seed: number, wx: number, wy: number): BiomeId;
```

Wejście: temperatura (funkcja szerokości i wysokości n.p.m.), wilgotność (`fbm`),
nachylenie, bliskość wody. Biomy na start: łąka, las liściasty, bór iglasty, wrzosowisko,
bagno, skalisty grzbiet, brzeg rzeki, plaża.

Biom wybiera materiały gruntu i tabelę roślinności. **Przejścia mają być rozmyte** —
dwie sąsiednie komórki różnych biomów nie mogą dać ostrej krawędzi koloru, bo w ASCII
wygląda to jak błąd renderowania.

### 5. `props.ts` — roślinność

Czysty hash pozycji, zero pamięci. Drzewo to **dwa spany**: pień (wąski, kora) i korona
(szersza, listowie) — jeden span daje słupek i wygląda jak latarnia, co już widzieliśmy.

Uwaga na budżet: las z dwuspanowymi drzewami szybko przebije limit 1.3 spanu na komórkę.
Zmierz i zaraportuj. Jeśli nie da się zejść — zaproponuj zmianę limitu z uzasadnieniem,
zamiast po cichu go przekroczyć.

### 6. `chunk.ts` i `streaming.ts`

```ts
function generateChunk(seed: number, cx: number, cy: number, pack: ContentPack): Chunk;

class ChunkStore implements RenderTarget {
  update(camera: { x: number; y: number }): void;   // ładuje/wyrzuca pierścień
  applyDeltas(deltas: Record<DeltaKey, Partial<Cell>>): void;
}
```

- pierścień 5×5 chunków wokół kamery, reszta wyrzucana
- **generacja amortyzowana: maksymalnie jeden chunk na klatkę**, nigdy blokująco.
  Lepiej mieć chwilowo pustą krawędź świata niż zacinkę
- delty nakładane **po** generacji, przy każdym załadowaniu chunka
- `contentHash` liczony przy generacji — podstawa testu determinizmu

### 7. Pomiar zasięgu widzenia (przygotowanie pod LOD)

Miasto zasłania widok po dwóch przecznicach; pustkowie nie zasłania nic. `maxDepth = 62`
komórek to 124 m — na otwartym terenie to zdecydowanie za mało, świat będzie się urywał
tuż przed nosem.

Nie implementuj LOD w M1. **Zmierz i zaraportuj**, ile kosztuje wydłużenie zasięgu:

| Scena | maxDepth 62 | 120 | 200 |
|---|---|---|---|
| łąka (pusto) | ? | ? | ? |
| las gęsty | ? | ? | ? |
| grzbiet z widokiem na dolinę | ? | ? | ? |

Jeśli którykolwiek wynik przy zasięgu dającym sensowny widok przekracza 8 ms —
uruchamiamy `M1b-lod-sylwetkowy.md`. Jeśli mieści się w budżecie, LOD odpada
i oszczędzamy tydzień. Decyzja z liczb, nie z przeczucia.

### 8. `apps/game/src/main.ts`

Kamera trzyma się powierzchni terenu (`surfaceHeight` + wzrost), chodzenie po zboczu,
wchodzenie na progi do 0.6 m, brak wchodzenia w wodę głębszą niż 1 m. Start w miejscu
wybranym deterministycznie: łąka blisko rzeki, żeby pierwszy widok pokazywał trzy rzeczy
naraz — wysokość, wodę i las.

---

## Definicja ukończenia

1. `pnpm typecheck`, `pnpm test`, `pnpm test:snap`, `pnpm bench` — zielone.
2. Snapshoty: `wild-hills`, `wild-forest`, `wild-river`, `wild-ridge`, `wild-seam`,
   `neon-city` (paczka odłożona, dowód że wciąż działa).
3. **Test szwów** — najważniejszy w tym zadaniu. Kamera dokładnie na granicy czterech
   chunków, w czterech kierunkach; dodatkowo test jednostkowy: wysokość i materiał
   w 10 000 punktów przy granicy liczone raz bezpośrednio, raz przez `ChunkStore`,
   różnica zero.
4. **Test determinizmu** — `generateChunk` × 1000 dla tych samych argumentów daje ten
   sam `contentHash`; kolejność ładowania chunków nie wpływa na wynik.
5. Budżety: `generateChunk` < 8 ms, spadek fps przy marszu **nigdy poniżej 55**,
   pamięć stała po 1000 chunkach (test na wyciek), spany/komórkę zmierzone i opisane.
   Do tego tabela zasięgu z §7 — wypełniona liczbami i z rekomendacją, czy M1b jest potrzebny.
6. `pnpm dev`: dziesięć minut marszu w jedną stronę bez zacinki i bez artefaktów
   na granicach. Napisz w podsumowaniu, którą trasą szedłeś.
7. Podsumowanie w formacie z `CLAUDE.md`.

---

## Czego świadomie NIE robimy

- osad, budynków, NPC (M4)
- lochów i wnętrz (M2)
- światła dynamicznego i pory dnia (M2)
- dróg i POI (M6)
- erozji, symulacji klimatu, tektoniki — kuszące i kosztowne, a gracz nie zobaczy
- **LOD sylwetkowego** — osobne, warunkowe zlecenie `M1b`, uruchamiane tylko jeśli
  pomiar z §7 tego wymaga

---

## Pułapki

1. **Cokolwiek pytającego o sąsiedni chunk = szew.** Wszystko, co potrzebuje sąsiedztwa
   (rzeki, drogi, duże formacje), liczymy na warstwie zgrubnej, nie z sąsiadów.
2. **`Math.random()` w generacji** — świat przestaje być odtwarzalny, a zapis gry traci
   sens. Test to wyłapie, ale lepiej nie pisać.
3. **Drzewo jako jeden span** wygląda jak słup. Pień + korona.
4. **Ostre granice biomów** czytają się jak glitch. Rozmywaj.
5. **Streaming blokujący klatkę** — jeden chunk na klatkę, nigdy pętla „doładuj wszystko".
6. **Materiały gruntu zbyt kontrastowe** — w ASCII czytelność bierze się z rampy znaku,
   nie z koloru. Trawa i mech mają się różnić glifem, nie tylko odcieniem zieleni.
7. **Rzeka płynąca pod górę.** Test: wzdłuż każdego segmentu poziom wody monotonicznie
   opada. Brzmi absurdalnie, zdarza się przy mieszaniu warstw.
