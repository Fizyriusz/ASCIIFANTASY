# ASCII RPG — architektura projektu

Dokument referencyjny do pracy z Claude Code. Rozwinięcie prototypu `ascii-city.html`
w otwarty świat RPG w duchu Daggerfalla, renderowany w całości znakami.

Setting docelowy: **high fantasy**. Silnik jest jednak agnostyczny — setting to paczka
danych (`content/`), nie kod. Shadowrun = druga paczka na tym samym rdzeniu.

---

## 0. Zasady, od których nie odchodzimy

1. **Determinizm.** Wszystko wynika z `(seed, współrzędne)`. Świat nie jest zapisany, tylko obliczany.
2. **Zapis = delty.** Stan gry to seed + słownik nadpisań. Nigdy nie serializujemy wygenerowanego świata.
3. **Leniwa symulacja.** Stan NPC to funkcja `(harmonogram, czas)`. Liczymy go dopiero, gdy ktoś patrzy.
4. **Jeden bufor znaków.** Świat, UI, mapa, dialogi — wszystko trafia do tej samej siatki glifów.
5. **Budżet klatki jest święty.** ≤ 15 000 komórek, ≤ 16 ms. Każda funkcja rendera ma limit.
6. **Pionowy wycinek przed skalą.** Jedna dolina musi być grywalna, zanim powstanie kontynent.

---

## 1. Stack i układ repo

TypeScript, Vite, pnpm, zero zależności runtime w rdzeniu (Canvas 2D + własna matematyka).
Backend niepotrzebny — gra jest w pełni lokalna. Opcjonalnie później Cloudflare Workers + D1
na leaderboardy / seed sharing, ale poza MVP.

```
ascii-rpg/
├─ CLAUDE.md                  # kontrakt dla Claude Code (patrz §11)
├─ package.json               # pnpm workspace
├─ apps/
│  └─ game/                   # Vite app, entry point, pętla, input
├─ packages/
│  ├─ core/                   # renderer znakowy, bufor, blit, kolory, glify
│  ├─ world/                  # generacja, chunki, streaming, delty, zapis
│  ├─ sim/                    # agenci, harmonogramy, ekonomia, plotki, czas
│  ├─ rules/                  # walka, statystyki, ekwipunek, czary, rzuty
│  ├─ quest/                  # szablony, sloty, binding, dziennik
│  ├─ ui/                     # panele, dialogi, mapa, HUD — do bufora znaków
│  └─ content/                # dane settingu: JSON + tabele, zero logiki
└─ tools/
   ├─ harness/                # headless render → snapshot ASCII (testy złote)
   └─ mapdump/                # podgląd wygenerowanego regionu z góry
```

Zasada zależności: `content → rules → sim → quest → ui → game`, a `core` i `world` nie
importują niczego z góry. Renderer nigdy nie wie, że istnieje quest.

---

## 2. Model świata

### 2.1 Komórka i spany

Rezygnujemy z „jedna wysokość na komórkę". Komórka to lista **spanów** (pionowych brył).
Teren zewnętrzny to zwykle 1 span, więc szybka ścieżka zostaje szybka; jaskinie, mosty,
piętra i piwnice dostają 2–3.

```ts
interface Span {
  bottom: number;      // metry, świat
  top: number;
  mat: MaterialId;     // materiał ścian bocznych
  capMat: MaterialId;  // materiał górnej powierzchni (po czym się chodzi)
  flags: number;       // SOLID | WATER | DOOR | STAIRS | TRANSPARENT | LIT
}

interface Cell {
  spans: Span[];       // posortowane po bottom
  light: number;       // 0..15, propagowane światło statyczne
  region: RegionId;
}
```

Chunk: 64×64 komórek, komórka = **2 m**. Świat mierzymy w chunkach, nie w komórkach.
Pierścień 5×5 chunków w pamięci (~20 tys. komórek), reszta wyrzucana i odtwarzana z seeda.

### 2.2 Warstwy generacji (deterministyczne, kolejność ma znaczenie)

| Warstwa | Zakres | Produkuje |
|---|---|---|
| `climate` | kontynent | wysokość bazowa, wilgotność, temperatura (fBm z seeda) |
| `hydro` | region | rzeki, jeziora, poziom wody, doliny |
| `biome` | region | biom → paleta materiałów, gęstość roślin, tabela potworów |
| `roads` | region | drogi między POI (A* po koszcie terenu) |
| `poi` | punkt | miasteczko / ruiny / wieża / kopalnia / obóz |
| `settlement` | POI | działki, budynki, wnętrza, mieszkańcy |
| `dungeon` | POI | graf pomieszczeń → spany, zamknięcia, łupy |
| `props` | komórka | drzewa, kamienie, ogniska — czysty hash, bez pamięci |

Każda warstwa jest czystą funkcją. Warstwa N może czytać wynik N−1, nigdy odwrotnie.
Testowalność: `generateChunk(seed, cx, cy)` musi dawać identyczny wynik przy 1000 wywołaniach.

### 2.3 Delty i zapis

```ts
type DeltaKey = `${number}:${number}:${number}`;   // cx:cy:cellIndex
interface SaveFile {
  seed: number;
  version: number;
  clock: number;                   // minuty gry od startu
  player: PlayerState;
  cellDeltas: Record<DeltaKey, Partial<Cell>>;   // wykopane, zburzone, otwarte
  entityDeltas: Record<EntityId, Partial<Entity>>; // zabici, przekupieni, przeniesieni
  factions: Record<FactionId, FactionState>;
  quests: QuestState[];
  flags: Record<string, number>;
}
```

Zapis po 200 h gry powinien mieć < 2 MB. Jeśli rośnie szybciej — coś zapisujemy niepotrzebnie.

---

## 3. Renderer (`packages/core`)

### 3.1 Marsz kolumnowy

Zastępuje obecny „DDA + floor-casting". Jedna pętla obsługuje teren, budynki, wnętrza.

```
dla każdej kolumny ekranu:
  minRow = rows                    # najwyższy zamalowany wiersz
  DDA po siatce, krok po komórce:
    dla każdego spanu w komórce (od góry):
      rowTop = project(span.top, dist)
      rowBot = project(span.bottom, dist)
      jeśli rowTop >= minRow: pomiń (zasłonięty)
      maluj czapkę spanu: rowTop .. min(rowBot, minRow-1)  → capMat
      maluj ścianę boczną poniżej, jeśli widoczna       → mat
      minRow = rowTop
    jeśli minRow <= 0: przerwij kolumnę
```

To jest render voxel-space (Comanche) uogólniony na spany. Zalety: teren, mosty i sufity
z jednego kodu; brak osobnego floor-castingu; naturalne zasłanianie.

**Wnętrza**: gracz wewnątrz = zwykły przypadek — nad nim jest span sufitu, więc kolumna
kończy się na nim. Portale (drzwi) to flaga na spanie, nie osobny system.

**Uwaga do szkicu powyżej**: implementacja z M0 trzyma **dwa** fronty wypełniania —
`loRow` rosnący w górę i `hiRow` schodzący w dół — bo pojedynczy `minRow` gubi
powierzchnie nad okiem. Szczegóły i poprawiony podział na czapkę i ścianę:
`docs/zadania/M0-rdzen-renderera.md` §3 oraz komentarz na górze `packages/core/src/raymarch.ts`.

**Znane ograniczenie: otwór w środku kolumny.** Dwa fronty opisują stan kolumny
dwiema liczbami, więc kolumna jest zawsze *spójna* — zamalowana od dołu i od góry,
z jedną dziurą pośrodku. To wystarcza dla terenu, budynków, mostów i wnętrz, ale
nie wyraża geometrii widocznej **przez otwór w środku widoku**: okna, arkady,
bramy przejazdowej, dziury w murze. Przez taki otwór widać dalszą geometrię
*między* dwoma zamalowanymi obszarami, czego para `(loRow, hiRow)` nie potrafi
zapisać.

Planowane rozwiązanie, **do decyzji w M2**: szybka ścieżka dwóch frontów zostaje
domyślną, a kolumna, która trafi na span z flagą `Door` lub `Transparent`,
przełącza się na maskę pokrycia wierszy (bitmapa `rows` bitów albo lista
przedziałów). Koszt trzeba **zmierzyć**, nie założyć: interesuje nas czas kolumny
z maską względem kolumny szybkiej ścieżki i udział takich kolumn w typowej scenie
miejskiej. Jeśli maska okaże się droższa, niż wynosi zysk wizualny, alternatywą
jest ograniczenie otworów do osobnego przebiegu tylko dla spanów przezroczystych.

### 3.2 Materiały zamiast tekstur

```ts
interface Material {
  glyphs: [bright: number[], mid: number[], dark: number[]]; // kody znaków
  color: RGB;
  roughness: number;   // ile szumu w doborze glifu
  emissive: number;    // 0 = kamień, 1 = lawa/latarnia
}
```

Dobór znaku: `luminancja → rampa → hash(pozycja świata) → konkretny glif z zestawu`.
Hash po **współrzędnych świata**, nie ekranu — inaczej tekstura „pływa" przy chodzeniu.
To jest błąd numer jeden w takich rendererach.

### 3.3 Światło = mechanika

- **statyczne**: flood fill po komórkach przy generacji chunka, 0..15, jak w Minecrafcie
- **dynamiczne**: do 8 najbliższych źródeł liczone analitycznie na piksel-znak
- **pochodnia gracza**: zawsze, z lekkim migotaniem (sinus + szum)
- luminancja końcowa steruje wyborem rampy znaku, nie tylko kolorem

Konsekwencje rozgrywkowe za darmo: loch bez światła jest naprawdę nieczytelny, skradanie
= `światło + hałas`, zaklęcie światła jest realnym przedmiotem użytkowym, noc ma znaczenie.

### 3.4 Sprite'y

Sprite to `frames: string[][]` — siatka znaków, nie bitmapa. Skalowanie: próbkowanie
najbliższego sąsiada z maski. Klatki: idle / walk×2 / attack / hit / death.
Kolor z palety frakcji lub materiału. Duże potwory = po prostu większa siatka.

### 3.5 Budżety

| Element | Limit |
|---|---|
| kolumny × kroki DDA | 150 × 48 |
| spany na komórkę (średnio) | ≤ 1.3 |
| sprite'y widoczne | ≤ 60 |
| wywołania `fillText` na klatkę | ≤ 2500 (run-length!) |
| alokacje w pętli render | **0** — bufory prealokowane |

---

## 4. Symulacja (`packages/sim`)

### 4.1 Czas

1 minuta gry = 1 tick. Domyślnie 1 s realny = 6 minut gry (dostrajalne). Pory dnia
sterują harmonogramami, spawnami i światłem. Doba = 1440 ticków.

### 4.2 Trzy poziomy szczegółu

**Bliski (< 40 m, ~30 agentów)** — pełni agenci: pozycja, pathfinding, percepcja
(stożek widzenia + słuch), maszyna stanów (idle → work → alert → flee → fight).

**Średni (ten sam POI)** — **brak agentów**. NPC ma harmonogram:

```ts
interface Schedule {
  entries: { fromMin: number; toMin: number; place: PlaceRef; activity: Activity }[];
}
// pozycja NPC = pure function (schedule, clock, deltas)
```

Nic się nie liczy, dopóki gracz nie zapyta. To jest trik, który u Bethesdy zjadał CPU,
a tutaj kosztuje zero.

**Daleki (region)** — osada to garść liczb, aktualizowanych raz na dobę gry:

```ts
interface SettlementState {
  population: number;
  food: number; goods: number; wealth: number;
  fear: number;        // rośnie od potworów/bandytów w okolicy
  order: number;       // straż vs. przestępczość
  prices: Record<GoodId, number>;   // wynik podaży i popytu, nie tabelka
}
```

Ceny wynikają z łańcucha dostaw. Wyciąć bandytów na trakcie → karawany dochodzą → ceny
w miasteczku spadają. To jest cała „żyjąca ekonomia", 200 linii kodu.

### 4.3 Plotki jako encje

```ts
interface Rumor {
  id: RumorId;
  subject: EntityRef | PlaceRef;
  claim: ClaimType;        // TREASURE_AT | MONSTER_AT | BETRAYAL | DEATH | BOUNTY
  truth: number;           // 0..1 — plotka MOŻE kłamać
  origin: SettlementId;
  spread: Set<SettlementId>;
  decay: number;
}
```

Rozchodzą się wraz z karawanami i podróżnymi. Plotka, która dotrze do gracza, jest gotowym
zaczepieniem questa — a czasem prowadzi w puste miejsce. To najtańszy sposób, żeby świat
sprawiał wrażenie, że istnieje beze mnie.

---

## 5. Questy (`packages/quest`)

Szablon + sloty + wiązanie do realnie istniejących bytów. Nigdy nie wymyślamy bytu na
potrzeby questa, jeśli może być prawdziwy.

```ts
interface QuestTemplate {
  id: string;
  need: NeedType;                 // co pcha zleceniodawcę
  slots: SlotSpec[];              // czego wymaga świat
  stages: Stage[];
  rewards: RewardSpec[];
  fail: FailSpec;
}

interface SlotSpec {
  name: string;                   // "target", "place", "rival"
  kind: 'npc' | 'place' | 'item' | 'faction';
  constraints: Constraint[];      // np. { maxDistance: 8_000 }, { hostileTo: giver }
}
```

Pipeline: `potrzeba NPC → dobór szablonu → zapytanie do świata o kandydatów do slotów →
walidacja (osiągalne? nie koliduje z innym questem?) → instancja → wpis do dziennika`.

Kręgosłup: **3–4 ręcznie napisane wątki**. Generowane wypełniają przestrzeń między nimi.
Bez ręcznego szkieletu wszystko brzmi jak Radiant Quest i gracz to wyczuwa po godzinie.

Dziennik: zapisuje *co gracz wie*, nie prawdę. Jeśli plotka kłamała, dziennik kłamie razem z nią.

---

## 6. Reguły gry (`packages/rules`)

Minimum, które musi stać przed dodaniem czegokolwiek:

- **Atrybuty**: 6 sztuk (SIŁ ZRĘ KON INT WOL CHA), skille 0–100, rozwój przez użycie
- **Walka**: real-time, prędkość broni, wytrzymałość (stamina) jako zasób, blok/unik na timing
- **Trafienie**: `skill + atrybut + modyfikatory vs. obrona` — jeden rzut, bez tabelek
- **Ekwipunek**: waga, sloty, zużycie, brak automatycznej regeneracji
- **Magia**: konstruktor zaklęć (efekt × siła × czas × zasięg → koszt), nie lista 200 czarów
- **Postęp**: poziom z sumy skilli, jak w Daggerfallu

Wszystkie liczby w `content/`, żeby balans nie wymagał dotykania kodu.

---

## 7. UI (`packages/ui`)

Panele rysują się do tego samego bufora znaków co świat — ramki z `│ ─ ┌ ┐`, ta sama
czcionka, ten sam bloom. Zero HTML overlay.

Ekrany: ekwipunek, karta postaci, dziennik, mapa lokalna (rzut z góry z bufora komórek),
mapa świata (kafle regionów), dialog, handel, odpoczynek/podróż.

Podróż szybka jak w Daggerfallu: interpolacja po mapie z upływem czasu gry i losowymi
zdarzeniami — i tak masz już symulację dobową, więc to niemal darmowe.

---

## 8. Kamienie milowe

Każdy kończy się **grywalnym buildem**. Nie zaczynamy kolejnego, póki poprzedni nie działa.

- **M0 — Rdzeń renderera (1–2 tyg.)**
  Port `ascii-city.html` do TS, marsz spanowy, płaski teren, wolne chodzenie, testy złote.
  *Kryterium: stara scena wygląda tak samo, 60 fps, snapshot testy przechodzą.*

- **M1 — Teren i chunki**
  Wysokościowy teren, biomy, streaming, pierścień 5×5, delty w pamięci.
  *Kryterium: 10 minut marszu w jedną stronę bez zająknięcia i bez wycieku pamięci.*

- **M2 — Wnętrza i loch**
  Spany wielopoziomowe, drzwi jako portale, światło statyczne + pochodnia, jeden loch z grafu.
  *Kryterium: da się wejść, zgubić i wyjść. Bez światła jest naprawdę ciemno.*

- **M3 — Postacie i walka**
  Sprite'y z klatkami, percepcja, walka real-time, ekwipunek, śmierć i zapis.
  *Kryterium: da się zginąć w lochu z powodu własnego błędu, nie buga.*

- **M4 — Miasteczko żyje**
  30 NPC z harmonogramami, dialog, handel, ceny z podaży i popytu, straż reaguje.
  *Kryterium: NPC są w innych miejscach o 3:00 i o 13:00, a kradzież ma konsekwencje.*

- **M5 — Questy**
  Szablony, sloty, dziennik, plotki, 3 ręczne wątki + generator.
  *Kryterium: 5 questów z rzędu, żaden nie wskazuje na nieistniejący byt.*

- **M6 — Region**
  20–40 POI, drogi, podróż szybka, frakcje, stan świata na osiach.
  *Kryterium: 3 godziny gry bez powtórzenia się tego samego układu.*

Po M6: więcej contentu, nie więcej systemów. To jest moment, w którym takie projekty giną.

---

## 9. Testy

- **Snapshoty ASCII** — headless render sceny z ustalonym seedem i kamerą → porównanie
  z plikiem złotym. Mamy już działający harness w prototypie, wystarczy przenieść.
  Regresje graficzne widać jako diff tekstu, co jest luksusem, którego nie ma nikt w 3D.
- **Determinizm generacji** — ten sam seed × 1000 wywołań = ten sam hash chunka.
- **Właściwości symulacji** — po 365 dobach gry: brak ujemnych populacji, brak NaN w cenach,
  brak NPC uwięzionych w geometrii.
- **Sanity questów** — 10 000 wygenerowanych instancji, żadna z nieosiągalnym slotem.
- **Budżet klatki** — test wydajności w CI, próg twardy.

---

## 10. Pułapki (z doświadczenia z tym rendererem)

1. Hash tekstury po współrzędnych **ekranu** zamiast świata → fasady „pływają". Klasyk.
2. Brak run-length w blicie → 10 000 `fillText` i 15 fps. To była połowa wydajności prototypu.
3. Alokacje w pętli kolumn → GC zjada klatkę co sekundę. Bufory prealokowane, zero obiektów.
4. Zapisywanie wygenerowanego świata „bo tak prościej" → save 400 MB i koniec projektu.
5. Symulacja wszystkich NPC naraz → 5 fps przy trzeciej wiosce. Leniwe harmonogramy od razu.
6. Generator questów bez ręcznych wątków → gracz odchodzi po godzinie.
7. Portret wysoki na telefonie → 26 tys. komórek. Budżet komórek w `resize()` od pierwszego dnia.

---

## 11. Praca z Claude Code

### CLAUDE.md (do repo)

Powinien zawierać: zasady z §0, budżety z §3.5, konwencje (brak alokacji w hot path,
wszystkie liczby balansu w `content/`, każdy moduł ma test determinizmu), oraz zakaz
dodawania zależności runtime bez wpisu w dokumencie.

### Kolejność zadań

Jedno zadanie = jeden moduł = jeden PR. Kolejność jak w milestone'ach — moduły niżej
w grafie zależności najpierw (`core`, potem `world`, dopiero potem `sim`).

### Szablon zlecenia

```
Kontekst: przeczytaj CLAUDE.md i docs/architektura.md §<numer>.
Zadanie: zaimplementuj <moduł> zgodnie z §<numer>.
Wejście: <typy, które już istnieją>
Wyjście: <typy, które mają powstać>
Ograniczenia: zero alokacji w pętli render; zero zależności runtime;
              cała logika czysta i deterministyczna względem seeda.
Definicja ukończenia:
  - testy: <konkretne przypadki>
  - snapshot: <scena, seed, kamera>
  - budżet: <liczba> ms dla <scenariusz>
Nie ruszaj: <lista plików>
```

Twoje podejście z gotowymi dokumentami referencyjnymi zamiast iteracji w czacie sprawdzi
się tu wyjątkowo dobrze — ten projekt ma wąskie, dobrze zdefiniowane interfejsy między
modułami, więc każdy z nich da się zlecić osobno i odebrać po testach.

---

## 12. Gdyby jednak Shadowrun

Zmiany są mniejsze, niż się wydaje, bo miasto już stoi:

- teren płaski → **M1 odpada w całości** (oszczędność ~2 tygodni)
- spany są potrzebne i tak (piętra, kanały, dachy)
- neony to gotowe źródła światła
- Matrix: osobna abstrakcyjna siatka, inna paleta i inne materiały, ten sam renderer —
  w ASCII wygląda to lepiej niż w 3D i jest to szczerze najmocniejszy argument za tym settingiem
- zamiast biomów: dzielnice i strefy kontroli korporacji
- runy zamiast questów: ta sama struktura szablonów, inny słownik

Rdzeń (`core`, `world`, `sim`, `quest`) jest wspólny. Setting to `content/` + paleta materiałów.
Można zacząć od Shadowruna jako pionowego wycinka i przełożyć fantasy na tę samą maszynę.
