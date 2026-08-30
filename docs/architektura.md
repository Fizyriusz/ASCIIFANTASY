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
├─ CLAUDE.md                  # kontrakt dla Claude Code (patrz §12)
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

Jedna pętla obsługuje teren, budynki, wnętrza, lochy i bryły wiszące. Kolumna ekranu
ma **jeden stan: maskę pokrycia** — bajt na wiersz, „zamalowany albo nie".

```
dla każdej kolumny ekranu:
  cover[] = 0                                  # jedyny stan kolumny
  DDA po siatce; komórka kamery jest pierwszym krokiem, z dEnter = 0

  dla każdej komórki, od najbliższej:
    dEnter, dExit = dystanse wejścia i wyjścia promienia z tej komórki
    dla każdego spanu w komórce:
      jeśli materiał przezroczysty: pomiń (otwór nie maluje się i nie zasłania)

      # 1. lico boczne — pionowa ściana bryły, widziana z dEnter
      rzutuj [bottom, top] na wiersze; maluj te, które nie są jeszcze pokryte

      # 2. czapka — poziomy szczyt, gdy oko jest wyżej niż top
      floor-cast na wysokości top, ale TYLKO w wierszach, których rzut
      wypada na odcinku [dEnter, dExit] wewnątrz tej komórki

      # 3. spód — poziomy dół, gdy oko jest niżej niż bottom
      lustrzane odbicie czapki, ten sam warunek odcinka

    jeśli maska pełna: koniec kolumny

  wiersze bez pokrycia dostają niebo
```

To jest render voxel-space (Comanche) uogólniony na spany. Zalety: teren, mosty,
sufity i korony z jednego kodu; naturalne zasłanianie wynika z kolejności marszu
i maski, bez osobnej logiki.

**Dlaczego płaszczyzna należy do komórki.** Czapka i spód to floor-cast, czyli
rzut płaszczyzny poziomej. Wolno ją malować wyłącznie w wierszach, których rzut
wypada między dystansem wejścia a wyjścia promienia z **tej** komórki. Bez tego
warunku spód korony drzewa stojącego dwieście metrów dalej rozlewa się na cały
górny kadr jako nieskończony strop — komórka odległa o 254 m rzutowała swój spód
na wiersze odległe o 25–43 m. Sufit pomieszczenia wychodzi z tej samej reguły bez
wyjątku: sąsiednie komórki pokrywają swoje pasy i składają się w ciągłą płaszczyznę.

**Dlaczego lico maluje się w całości.** Do M2b zakres lica liczyło się od
„poprzedniej powierzchni w kolumnie", żeby uskok terenu dostał lico grubości
uskoku. To samo wychodzi z maski za darmo: dolna część lica jest już przykryta
czapką bliższej komórki, więc wystarczy pomalować całość i pozwolić masce odrzucić
to, czego nie widać. Jeden stan zamiast dwóch, jedna reguła zamiast dwóch.

**Czego tu nie ma i dlaczego.** Do M2b kolumna miała **dwa fronty wypełniania**
(`loRow` rosnący od dołu, `hiRow` od góry) i przechodziła na maskę tylko wtedy, gdy
trafiła na otwór. Była to optymalizacja z M0 dla świata bez otworów i brył wiszących.
Fronty opisują kolumnę dwiema liczbami, więc zakładają, że pokrycie jest **spójne** —
zamalowane od dołu i od góry, z jedną dziurą pośrodku. Świat z drzwiami, oknami,
koronami drzew i przęsłami mostów tego założenia nie spełnia, a każda próba
załatania kończyła się tym samym: fronty i maska rozjeżdżały się i trzeba było
poprawiać dwa razy. Trzy rundy zgłoszeń z M2b (łaty nieba na koronach, fałszywy
strop w niebie, korona gasnąca nad pniem) to jeden błąd modelu w trzech przebraniach.

Optymalizacje zostają, ale są optymalizacjami **jednej** ścieżki, a nie drugą
implementacją: okno niezamalowanych wierszy zawęża zakres malowania, a pełna maska
kończy kolumnę natychmiast. Koszt zmiany: sceny pustkowia +79–197%, sceny miejskie
+20–32% (pomiar w `vitest`, w przeglądarce około trzykrotnie mniej — patrz §3.5).

**Znane ograniczenie: jedna liczba światła na kolumnę.** Bajt światła należy do
komórki `(x, y)`, a nie do spanu, więc kolumna z korytarzem pięć metrów pod łąką ma
jedną wartość dla obu. Rozdzielenie na dwie połówki (jasność powierzchni i dostęp
do nieba) plus wybór połówki po tym, czy oko jest pod stropem, to heurystyka na jeden
poziom, nie model. **Termin spłaty i powód są w §10.1 — to jest dług blokujący M4.**

**Znane ograniczenie: zasięg marszu.** `maxSteps` musi wystarczyć na cały `maxDepth`:
jeden krok to jedna granica komórki, a promień pod 45° przecina dwie granice na
komórkę odległości. Za mała wartość ucina marsz i widać to jako niebo w miejscu
dalekiego grzbietu — przy 192 krokach i zasięgu 200 komórek bryły z 273–360 m
znikały z kadru. Pilnuje tego niezmiennik nadmiarowego nieba (§9).

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

**Stabilność tekstury przy ruchu (wnioski z M1).** Hash po współrzędnych świata usuwa
pływanie, ale nie usuwa **aliasingu**: jedna komórka ekranu pokrywa tym większy kawałek
świata, im dalej patrzy, więc przy 50 m punkt próbkowania przeskakuje przy ruchu przez
dziesiątki kratek hasha i glif losuje się od nowa co klatkę. Pod horyzontem daje to pas
migotania.

W M1 stłumiono to obniżeniem `roughness` w paczce contentu i wygładzeniem wysokości
kamery. Wygładzenie kamery było poprawką właściwą — skok oka o 0,2 m przepróbkowywał
57,8% komórek naraz. Obniżenie `roughness` **nie było naprawą próbkowania** i warto to
zapisać wprost, bo pierwotny raport zawierał skrót logiczny: „przy `roughness = 0`
migotanie znika, więc kwantyzacja nie jest wąskim gardłem". Kwantyzacja i `roughness`
to nie dwie niezależne przyczyny, tylko ten sam kanał — hash decyduje, *który* glif,
a `roughness` decyduje, *jak mocno* hash wpływa na wybór. Wyzerowanie `roughness` nie
testuje kwantyzacji, tylko wyłącza teksturę; aliasing znika, bo znika sygnał, który się
aliasował. Daleka trawa jest spokojna, **ponieważ jest jednorodna**, a nie dlatego, że
próbkowanie zostało naprawione.

Cena jest odroczona i płatna w M2: ściana lochu stoi metr od oka i to właśnie `roughness`
daje jej strukturę. Właściwe rozwiązanie — krok hasha i `roughness` zależne od rzutowanego
rozmiaru komórki, czyli jedyny odpowiednik mipmapy dostępny w rendererze znakowym —
jest zakresem `docs/zadania/M1c-stabilnosc-tekstury.md`.

**Asymetria footprintu: dlaczego wygaszanie omija ściany.** Rzutowany rozmiar komórki
znakowej zależy nie tylko od odległości, ale przede wszystkim od **kąta padania**.
Grunt oglądany pod ostrym kątem rozciąga się w głąb kilkadziesiąt razy mocniej niż
w poprzek: z 5 m jedna komórka pokrywa **0,23–0,6 m** terenu, a przy horyzoncie idzie
w setki metrów. Ściana z tej samej odległości 5 m ma footprint **0,03–0,13 m**, bo
patrzymy na nią prostopadle i wiersz ekranu odpowiada wysokości, a nie głębi.

Konsekwencja jest praktyczna i M2 może się na niej oprzeć jako na fakcie: wygaszanie
faktury oparte na footprincie trafia w **grunt przy horyzoncie**, a ściany **z definicji
omija** — żeby wygasić ścianę, trzeba by ją oddalić o kilkadziesiąt metrów. Wnętrza,
lochy i korytarze, gdzie powierzchnie stoją prostopadle w odległości metrów, zachowują
pełną fakturę materiału bez żadnego wyjątku w kodzie. To nie jest szczęśliwy zbieg
okoliczności, tylko geometria rzutowania.

### 3.3 Światło = mechanika

- **statyczne**: flood fill po komórkach przy generacji chunka, 0..15, jak w Minecrafcie
- **dynamiczne**: do 8 najbliższych źródeł liczone analitycznie na piksel-znak
- **pochodnia gracza**: zawsze, z lekkim migotaniem (sinus + szum)
- luminancja końcowa steruje wyborem rampy znaku, nie tylko kolorem

**Jak to się składa (M2).** Światła statyczne są dwa i wchodzą w różny sposób:

```
lum = (ambient + (1 - ambient) * jasnośćPowierzchni/15)   # cień koron, jak w M1
    * poraDnia                                            # mnożnik, 1 = południe
    * dostępDoNieba/15                                    # mnożnik, 0 = głęboki loch
    + Σ źródła(odległość, moc) + pochodnia
```

Obie pory dnia i dostęp do nieba są **mnożnikami**, nie składnikami, i to nie jest
kosmetyka. Gdyby noc była składnikiem, znaczyłaby tylko „mniejszy kontrast" —
pustkowie o północy świeciłoby pełną jasnością trawy, bo jasność powierzchni sama
z siebie wysyca wzór. Gdyby dostęp do nieba był składnikiem, jaskinia oglądana
z zewnątrz w południe byłaby jasna, bo `ambient` należy do obserwatora, a nie
do miejsca. Przy porze dnia = 1 i dostępie = 15 wzór sprowadza się bajt w bajt
do wersji z M1 i dlatego złote pliki M0 i M1 przetrwały M2 bez zmiany.

**Lico ściany oświetla pustka, która na nie patrzy**, a nie bryła, do której należy.
Ściana korytarza to bok litej skały sięgającej powierzchni; gdyby liczyło się jej
własne światło, korytarz szesnaście metrów pod ziemią byłby jasny jak łąka. Renderer
bierze dostęp do nieba z komórki, **z której promień przyszedł**. Czapka pozioma
działa tak samo, gdy jest przedłużeniem poprzedniej powierzchni.

**Próg malowania jest per materiał, nie globalny.** Blit kwantyzuje kolor do 15 bitów,
więc kanał poniżej ósemki wychodzi zerem: przy luminancji 0,04 kamień o barwie 112 jest
malowany **czarny na czarnym**. Globalny próg 0,035 leżał poniżej tej granicy i dawał
w lochu „brak ściany" zamiast ciemnej ściany. `Material.minLum` to `8 / najjaśniejszy
kanał` — materiał ciemny gaśnie wcześniej niż jasny, bo faktycznie wcześniej znika.

**Zasięg pochodni to miejsce, w którym tłumienie dochodzi do zera, a nie zasięg
użyteczny.** Przy `(1-d²/r²)²` ostatnia trzecia zasięgu leży poniżej progu widoczności:
promień 8 m dawał czytelne 6 m i czerń w dwóch krokach. Szesnaście metrów przy mocy 0,8
daje pasmo jasne do 4,5 m, średnie do 11 m i najsłabsze glify do 13,5 m. To są liczby
z paczki contentu, nie z kodu — dobiera się je pomiarem, nie na oko (tabela w M2).

**Dostęp do nieba propaguje się wyłącznie przez pustki.** Pierwsza wersja pola
traktowała litą skałę obok korytarza jak teren pod otwartym niebem i światło
przeciekało przez ścianę. Komórka bez pustki dostaje wartość pełną, nie zerową —
zero znaczyłoby „nic tu nie dochodzi", a lita skała po prostu nie ma wnętrza,
i ta sama liczba jest czytana dla licowania ściany z sąsiedniej komórki.

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

**Niezmienniki obrazu** (`tools/harness/src/invariants.test.ts`) — sprawdzane na
wszystkich scenach naraz, bo pojedynczy snapshot łapie tylko tę scenę, którą ktoś
wcześniej wybrał, a błąd renderera z M0 przeszedł przez trzy milestone'y niezauważony:

- **brak nadmiarowego nieba.** Dla każdej komórki oznaczonej przez renderer jako
  niebo puszczamy **marsz referencyjny bez żadnych optymalizacji** — próbkowanie
  promienia co 0,2 komórki aż do zasięgu — i sprawdzamy, czy nie przechodzi przez
  bryłę. Referencja jest wolna z premedytacją; jest niezależną implementacją tego
  jednego pytania i dlatego łapie błędy, których obie „szybkie" ścieżki nie widziały.
- **opadanie oka nie odsłania nieba.** Im niżej oko, tym wyżej rzutują się bryły nad
  nim, więc komórek nieba nad horyzontem może tylko ubyć. Przyrost = zgubiona
  geometria.

## 10. Długi techniczne (z terminem spłaty)

Rzeczy, o których **wiemy**, że są tymczasowe, wraz z milestone'em, przed którym
muszą zniknąć. Dług bez terminu przestaje być długiem, a staje się architekturą.

### 10.1 Światło należy do komórki, nie do spanu — spłata **przed M4**

Bajt światła jest indeksowany `(x, y)`. M2 rozdzielił go na dwie połówki (jasność
powierzchni i dostęp do nieba) i wybiera połówkę heurystyką „czy oko jest pod stropem
komórki, z której patrzy" (§3.1, §3.3). To wystarcza na **jeden** poziom pustki
w kolumnie i nic więcej.

Blokuje to nie tylko loch pod lochem — to byłby problem contentu, dający się obejść
regułą generatora (i tak właśnie jest obchodzony: `layoutOk` w `dungeon.ts` odrzuca
układy z pustkami leżącymi nad sobą). Blokuje **wielopiętrowe wnętrza**, czyli
karczmę z izbą na dole i pokojami na górze, wieżę ze schodami, ratusz. To jest
zakres M4 i tam obejścia nie ma: budynek z jednym piętrem jest osobliwością, nie
settingiem. Parter i piętro tej samej chaty dostają dziś jedną wartość światła,
więc albo oba są ciemne, albo oba jasne.

Spłata: światło per span (bajt obok `mat`/`capMat` w tablicach chunka) i propagacja
w pionie między spanami tej samej komórki. Koszt pamięci: jeden bajt na span,
czyli przy budżecie 1,3 spanu na komórkę mniej niż dzisiejsze `lights`. Zrobić
**przed** M4, nie „przy okazji" M4 — inaczej wnętrza powstaną wokół ograniczenia.

### 10.4 Górny front modeluje spód bryły jako nieskończony strop — **spłacone w M2c**

Zostawione jako zapis, bo diagnoza kosztowała trzy rundy i warto ją mieć w historii.

`renderColumn` traktował każdy span nad okiem jak sufit: rzutował jego spód jako
płaszczyznę ciągnącą się nad graczem i zapisywał wszystkie wiersze powyżej jako
zamalowane. Dla wnętrza prawda, dla korony drzewa fałsz w obu punktach. Objawy:
łaty nieba na koronach rosnące przy opadaniu oka (1216 → 1905 komórek nieba),
„ciemna szachownica" zamiast tafli nieba, korona gasnąca po wejściu pnia w górny
front.

Spłata: **ścieżka B z M2c** — dwa fronty zniknęły, została maska pokrycia, a czapka
i spód są płaszczyznami komórki ograniczonymi do odcinka promienia w niej (§3.1).
Pilnują tego dwa niezmienniki opisane w §9.

### 10.5 `ctx.skyMask` — hak testowy w kodzie produkcyjnym

`RenderContext.skyMask` to opcjonalny bufor „ta komórka to niebo", jeden bajt na znak
ekranu. W grze jest `null` i nie kosztuje nic poza jednym porównaniem na komórkę nieba.
Istnieje wyłącznie po to, żeby niezmiennik nadmiarowego nieba (§9) wiedział **dokładnie**,
które komórki są niebem.

Dlaczego nie da się inaczej, dziś: rozpoznanie po barwie daje fałszywe trafienia po
kwantyzacji — skała o luminancji 0,09 i niebo o 0,06 lądują po `pack15` w tym samym
kolorze, co dawało 474 fałszywe zgłoszenia w jednej scenie lochu. Porównanie z renderem
bez materiału nieba też nie działa, odkąd mgła miesza barwę powierzchni z barwą nieba:
zamalowana mgłą skała wygląda wtedy jak komórka, która istnieje tylko dzięki niebu.

Do usunięcia, jeśli bufor ekranu kiedykolwiek dostanie **osobny kanał na źródło
piksela** (materiał albo klasa powierzchni). Wtedy test czyta ten kanał, a renderer
nie musi wiedzieć, że jest testowany. Dopóki bufor ma tylko znak i barwę, hak zostaje —
z tym wpisem, żeby nie udawał, że jest częścią modelu.

### 10.2 Kolizja nie zna `SpanFlags.Stairs` — spłata w **M3**, razem z fizyką

Ruch gracza zna jeden próg: `STEP_UP = 0,6 m`. Schodów nie rozpoznaje, mimo że
flaga `Stairs` istnieje i generator ją ustawia. Skutek jest odwrotny do zamierzonego
kierunku zależności: **generator lochu dopasowuje nachylenie biegów do progu kolizji**
(`MAX_CLIMB` w `dungeon.ts`, minimalna długość biegu liczona z `LEVEL_DROP / MAX_CLIMB`,
rampa wejściowa kończąca zjazd przed komorą). Reguła gry rządzi geometrią świata —
odwrotnie niż mówi §0, gdzie świat jest funkcją seeda, a nie ustawień gracza.

Widać to gołym okiem: każdy bieg schodów w lochu ma nachylenie tuż poniżej 0,55 m
na komórkę, bo tyle wolno. Kręte, strome zejście jest dziś niewyrażalne.

Spłata: kolizja pytająca o flagę spanu — na `Stairs` obowiązuje inny próg (albo
brak progu, z ograniczeniem prędkości). Wtedy `MAX_CLIMB` znika z generatora
i długość biegu wraca do bycia decyzją kompozycyjną. Robimy to w M3, bo to ten
sam obszar co reszta fizyki ruchu.

### 10.3 Wejście do jaskini jest kompozycją, nie emergentne — do rewizji w M4

Wcięcie wejściowe ma zapisaną długość ramion, zakręt, nachylenie i pas obrzeża
(`dungeon.ts`). Nie wynika z terenu — jest w niego wcinane. Dwie rzeczy z tego wynikają
i obie są świadome: wejście zawsze wygląda podobnie, a zakręt zawsze jest w tym samym
miejscu łamanej. Alternatywa (wejście wynikające z przecięcia stropu ze zboczem) była
próbowana w M2 i dawała albo brak wejścia, albo odsłonięty cały pokój, bo nachylenie
w miejscu POI jest zbyt małe względem głębokości komory.

Do rewizji przy ruinach i wejściach miejskich w M4, kiedy typów wejścia będzie kilka
i wybór między nimi przestanie być pojedynczą stałą.

---

## 11. Pułapki (z doświadczenia z tym rendererem)

1. Hash tekstury po współrzędnych **ekranu** zamiast świata → fasady „pływają". Klasyk.
2. Brak run-length w blicie → 10 000 `fillText` i 15 fps. To była połowa wydajności prototypu.
3. Alokacje w pętli kolumn → GC zjada klatkę co sekundę. Bufory prealokowane, zero obiektów.
4. Zapisywanie wygenerowanego świata „bo tak prościej" → save 400 MB i koniec projektu.
5. Symulacja wszystkich NPC naraz → 5 fps przy trzeciej wiosce. Leniwe harmonogramy od razu.
6. Generator questów bez ręcznych wątków → gracz odchodzi po godzinie.
7. Portret wysoki na telefonie → 26 tys. komórek. Budżet komórek w `resize()` od pierwszego dnia.

---

## 12. Praca z Claude Code

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

## 13. Gdyby jednak Shadowrun

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
