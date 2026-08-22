# M2 — Wnętrza, lochy, światło

**Cel:** świat pod ziemią i pod dachem, oraz światło jako mechanika. Po tym zadaniu
ciemność jest realną przeszkodą, pochodnia realnym przedmiotem, a wejście do jaskini
nie wymaga ekranu ładowania.

To także zadanie, w którym spłacamy dług z M0: renderer nie umie pokazać geometrii
widocznej przez otwór w środku kolumny — a drzwi i okna to dokładnie ten przypadek.

Przeczytaj wcześniej: `CLAUDE.md`, `docs/architektura.md` §3.1 i §3.3.

---

## Zakres

### Wolno dotykać
```
packages/core/src/raymarch.ts       ← ścieżka maski pokrycia (patrz §1)
packages/core/src/light.ts          ← nowy
packages/world/src/dungeon.ts       ← nowy
packages/world/src/structure.ts     ← nowy: wnętrza naziemne
packages/world/src/chunk.ts         ← wpięcie lochów i światła
packages/content/src/packs/wild/    ← materiały podziemi, źródła światła
tools/harness/src/*.test.ts
apps/game/src/main.ts
docs/                               ← aktualizacja §3.1 po zmianie renderera
```

### Nie dotykać
`terrain.ts`, `hydro.ts`, `biome.ts` — teren z M1 jest zamknięty. Loch ma się dopasować
do terenu, nie odwrotnie.

---

## Co ma powstać

### 1. Otwór w środku kolumny — drzwi i okna

Obecny renderer trzyma dwa fronty wypełniania (`loRow` startuje na `rows` i idzie
w górę, `hiRow` startuje na `-1` i idzie w dół) i kończy kolumnę, gdy się spotkają.
To wystarcza dla sufitów i mostów, ale nie dla przejścia, przez które widać dalszą
geometrię **w środku** obrazu.

Rozwiązanie, zgodnie z zapisem w architekturze:

- **szybka ścieżka zostaje domyślna** — dwa fronty, bez zmian, dla kolumn bez otworów
- kolumna, która trafi na span z flagą `Door` lub `Transparent`, **przechodzi na maskę
  pokrycia**: bitmapa wierszy już zamalowanych, marsz kontynuowany aż maska pełna
- przełączenie jest per kolumna i per klatka, nie globalne

**Okno to ten sam mechanizm co drzwi** i warto go od razu tak potraktować: span
z flagą `Transparent`, przez który widać żywą geometrię na zewnątrz — te same drzewa,
ten sam teren, ta sama pora dnia. Stanie w chacie i patrzenie przez okno na las jest
efektem nieproporcjonalnie mocnym do kosztu, bo cała maszyneria i tak powstaje
na potrzeby drzwi. Okno różni się od otwartych drzwi wyłącznie tym, że nie da się
przez nie przejść — a to reguła kolizji, nie renderowania.

**Zmierz koszt obu ścieżek osobno i zaraportuj.** Jeśli maska okazuje się tańsza, niż
zakładamy, rozważ ujednolicenie — ale decyzję podejmij na podstawie liczb, nie estetyki.
Jeśli droższa: udokumentuj, ile kosztuje kolumna z otworem, żeby dało się to uwzględnić
przy projektowaniu wnętrz (osiem drzwi w polu widzenia to nie to samo co jedne).

### 2. `light.ts` — światło

**Statyczne** — flood fill po komórkach przy generacji chunka, wartości 0..15, propagacja
z tłumieniem przez spany nieprzezroczyste. Wynik trafia do `Cell.light`. Musi być
deterministyczny i niezależny od kolejności ładowania chunków, co przy flood fillu
przekraczającym granicę chunka **jest pułapką** — rozwiąż to jawnie (np. propagacja
ograniczona do chunka plus wartości brzegowe liczone z warstwy zgrubnej) i opisz wybór.

**Dynamiczne** — do 8 najbliższych źródeł liczonych analitycznie na komórkę znakową:
```ts
luminancja = ambient(poraDnia) + światłoStatyczne + Σ źródła(odległość, moc)
```

**Pochodnia gracza** — zawsze obecna, z migotaniem (sinus + szum), zasięg ~8 m.

Luminancja steruje **doborem rampy znaku**, nie tylko jasnością koloru. W lochu bez
źródła światła gracz ma widzieć nic — dosłownie pusty ekran poza najbliższymi komórkami.
To jest cała mechanika eksploracji podziemi i nie wolno jej rozwodnić „minimalnym
oświetleniem otoczenia dla wygody".

### 3. `dungeon.ts` — lochy

Loch to **spany poniżej terenu w tych samych chunkach** — nie osobna scena, nie osobny
tryb. Przejście z powierzchni do jaskini jest ciągłe i nie ma ekranu ładowania.

```ts
function dungeonAt(seed: number, poiId: number): DungeonGraph;
function carveDungeon(chunk: Chunk, graph: DungeonGraph): void;
```

- graf: pokoje + korytarze, generowany deterministycznie z seeda POI
- głębokość: 2–4 poziomy połączone schodami (`SpanFlags.Stairs`)
- **klucz i zamek**: część gałęzi zamknięta, klucz w innej gałęzi — to jedyna struktura,
  która zamienia loch w łamigłówkę zamiast korytarza. Bez tego eksploracja jest pusta
- wejścia: otwór jaskini na zboczu, ruiny na powierzchni, właz
- pokoje mają mieć **różne wysokości stropu** — inaczej model spanów niczego nie wnosi
  względem płaskiego raycastera

### 4. `structure.ts` — wnętrza naziemne

Minimalna wersja pod M4: chata / wieża / ruina jako spany ze ścianami, stropem i drzwiami.
Bez mieszkańców i mebli. Chodzi o to, żeby wejść przez drzwi, stanąć w środku i zobaczyć,
że renderer sobie z tym radzi.

---

## Definicja ukończenia

1. `pnpm typecheck`, `pnpm test`, `pnpm test:snap`, `pnpm bench` — zielone.
2. Snapshoty: `dungeon-corridor`, `dungeon-room-lit`, `doorway-through` (widok przez
   otwarte drzwi na geometrię za nimi — **dowód, że maska pokrycia działa**),
   `torch-falloff`, `night-outdoor`, `cave-mouth` (przejście powierzchnia → podziemie
   w jednym kadrze), `window-portal` (widok z wnętrza chaty przez okno na teren zewnętrzny —
   ten sam las, ta sama pora dnia).
3. **Test ciemności**: w lochu bez źródła światła, dalej niż 10 m od pochodni,
   liczba niepustych komórek znakowych = 0.
4. **Test determinizmu światła**: te same chunki ładowane w losowej kolejności × 100
   dają identyczne wartości `Cell.light`.
5. **Test spójności lochu**: każdy pokój osiągalny z wejścia; każdy zamek ma klucz
   osiągalny bez przechodzenia przez ten zamek. 10 000 wygenerowanych lochów, zero wyjątków.
6. Budżety: `renderWorld` w lochu < 8 ms; flood fill < 4 ms na chunk; koszt kolumny
   z maską zmierzony i zapisany w podsumowaniu.
7. `pnpm dev`: da się wejść do jaskini, zgubić się w niej i wyjść. Napisz, ile Ci to zajęło.
8. Podsumowanie w formacie z `CLAUDE.md`.

---

## Czego świadomie NIE robimy

- potworów, łupu, pułapek (M3)
- interakcji z drzwiami poza „są otwarte albo zamknięte na klucz"
- oświetlenia dynamicznego rzucającego cienie — liczymy tłumienie, nie geometrię cieni
- wody w lochach, pływania

---

## Pułapki

1. **Flood fill przez granicę chunka** zależny od kolejności ładowania → światło różne
   przy każdym wejściu do tej samej jaskini. Rozwiąż jawnie, przetestuj losową kolejnością.
2. **„Trochę światła dla wygody"** — zabija całą mechanikę. Ciemność ma boleć.
3. **Loch jako osobna scena** — kusi, bo prostsze, ale wprowadza ekran ładowania
   i drugi kod renderujący. Spany pod terenem, jeden świat.
4. **Maska pokrycia włączona globalnie** — płacisz jej koszt na każdej kolumnie
   otwartego terenu, gdzie nigdy nie ma otworów.
5. **Stropy na jednej wysokości** — po co w takim razie spany.
6. **Klucz za zamkiem, który otwiera** — klasyk generatorów lochów, wykrywalny testem
   osiągalności i tylko testem.
