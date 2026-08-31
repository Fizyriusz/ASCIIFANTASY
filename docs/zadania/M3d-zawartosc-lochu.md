# M3d — zawartość lochu: mieszkańcy i światło

**Cel:** loch ma być miejscem, do którego się schodzi po coś, a nie korytarzem
z geometrii. Dziś jest pusty w dwóch znaczeniach naraz: nie stoi w nim **nikt**
i nie pali się w nim **nic**. Renderowanie bytów i oświetlenie działają — brakuje
reguły, która je pod ziemią rozstawia.

To jest zadanie na **generację świata**, nie na prezentację. Dlatego jest osobne
od M3b: tamto dotykało contentu, reguł i warstwy gry, a tu wchodzimy w `dungeon.ts`
i w to, co warstwa gry karmi do zestawu świateł.

Przeczytaj wcześniej: `docs/architektura.md` §2.2, §3.3, §10.6, `CLAUDE.md`.

---

## Diagnoza (pomiar, nie podejrzenie)

Najbliższy loch od punktu startu (`seed=4242`, POI `516557154`, wejście `-174, -427`,
dziewięć komór). Dla trzech pierwszych komór:

| komora | rozmiar | podłoga | teren nad nią | komórek do stania | bytów wystawionych |
|---|---|---|---|---|---|
| 0 | 3×6 | 18,4 m | 18,4 m | **18 z 18** | **0** |
| 1 | 8×4 | 18,4 m | 28,2 m (9,8 m wyżej) | **32 z 32** | **0** |
| 2 | 7×4 | 18,4 m | 28,6 m | **28 z 28** | **0** |

**Miejsce nie jest problemem.** Każda komórka każdej komory nadaje się do postawienia
bytu: `surfaceHeight(x, y, podłoga + 3)` znajduje podłogę komory, a `blocks` nie
odrzuca żadnej — poprawka pułapu z M3 działa. Problem jest w regule, która w ogóle
decyduje, gdzie stawiać, i składa się z trzech niezależnych przyczyn:

1. **Klaster jest za duży i losowany po XY.** Bok klastra to 16 komórek, zamieszkany
   jest co ósmy (`WILD_SPAWN.oneInClusters`), a każda z trzech komór mieści się
   w **jednym** klastrze. Wszystkie trzy przegrały losowanie: `hash % 8 ≠ 0`, więc
   kandydatów było zero.
2. **Nawet wygrany klaster trafia obok.** Pozycja bytu jest losowana z całego klastra
   (256 komórek), a komora zajmuje z tego 18–32, czyli 7–12%. Trafienie w komorę jest
   przypadkiem, nie regułą.
3. **Klastry zużywają się na powierzchni.** W pierścieniu wokół wejścia jest 49
   klastrów, z czego 6 zamieszkanych — i wszystkie zostają oznaczone jako rozpatrzone,
   **zanim** gracz zejdzie pod ziemię, bo `spawnAround` biegnie co klatkę na
   powierzchni. Po zejściu nie ma już czego rozpatrywać.

Łączna szansa na potwora w danej komorze wychodzi poniżej jednego procentu. Stąd
obserwacja z gry: na zewnątrz gobliny biegają, w lochu nie ma nikogo.

**Światła:** `addSource` nie jest w kodzie gry wywoływane **ani razu** — jedyne
użycia są w `tools/harness/src/scene.ts`, czyli w scenie testowej. `packages/world`
nie zna pojęcia żagwi (zero trafień na `torch`/`brazier` w generatorze). Parametry
w contencie są (`wildPack.light.sourceRadius = 7`, `sourcePower = 0,85`) i czekają
od M2.

---

## Zakres

### Wolno dotykać
```
packages/world/src/dungeon.ts        ← pozycje mieszkańców i żagwi w grafie
packages/world/src/index.ts
packages/content/src/packs/wild/     ← tablice liczebności i świateł
packages/content/src/creatures.ts    ← ewentualne nowe byty podziemne
apps/game/src/entities.ts, main.ts   ← karmienie zestawu świateł, rozmnażanie
tools/harness/src/*.test.ts
docs/architektura.md
```

### Nie dotykać
`terrain.ts`, `hydro.ts`, `biome.ts`, `chunk.ts`, `raymarch.ts`, `light.ts`, `blit.ts`.
**W szczególności: pozycje żagwi i mieszkańców nie mogą trafić do danych chunka.**
Hash zawartości chunka jest testem determinizmu i wejściem do zapisu; treść lochu
ma być **funkcją grafu**, liczoną z POI, a nie polem w chunku.

---

## Co ma powstać

### 1. Mieszkańcy związani z komorą, nie z siatką powierzchni

```ts
// packages/world/src/dungeon.ts
export interface DungeonDweller {
  roomIndex: number;
  x: number; y: number;   // komórki świata
  z: number;              // metry: podłoga komory
  kind: number;           // indeks w wildCreatures
}
export function dungeonDwellers(seed: number, graph: DungeonGraph): DungeonDweller[];
```

- deterministyczne z `(seed, poiId, roomIndex)`, jak wszystko inne;
- liczebność z contentu (patrz §3), **osobna dla komory z wejściem** — pierwsza komora
  ma być rzadziej zamieszkana, żeby wejście do lochu nie było natychmiastową walką;
- pozycja losowana **wewnątrz obrysu komory**, z pominięciem komórek zajętych przez
  geometrię (ten sam warunek co dziś: `surfaceHeight` w granicach podłogi i `blocks`
  na wysokość sylwetki);
- głębsze poziomy (`room.level`) mogą być gęstsze — to jedyna nagroda za schodzenie
  niżej, jaką M3d wprowadza.

Reguła klastrowa z powierzchni **zostaje bez zmian dla powierzchni** i przestaje
dotyczyć podziemi: `spawnAround` ma pomijać klastry, gdy gracz jest pod stropem
(warunek do ustalenia pomiarem — najprościej: kiedy nad graczem jest bryła).

### 2. Żagwie jako zawartość lochu

```ts
export interface DungeonLight {
  roomIndex: number;
  x: number; y: number; z: number;   // metry dla z: wysokość zawieszenia
}
export function dungeonLights(seed: number, graph: DungeonGraph): DungeonLight[];
```

- deterministyczne tak samo jak mieszkańcy;
- **nie w każdej komorze** — loch bez pochodni musi zostać ciemny. Test ciemności
  z M2 (`w lochu bez źródła światła nie widać nic`) obowiązuje dalej i jest granicą
  tego punktu: oświetlone mają być pojedyncze komory, nie korytarze;
- warstwa gry wybiera **najbliższe** źródła i karmi nimi zestaw: `createLightRig`
  ma twardy limit `max = 8`, a `addSource` zwraca `false`, gdy zestaw jest pełny.
  Wybór najbliższych po kwadracie odległości, przeliczany przy zmianie komory,
  a nie co klatkę.

### 3. Liczby w contencie

```ts
export const DUNGEON_SPAWN = {
  /** szansa, że komora jest zamieszkana, osobno dla komory wejściowej */
  roomChance: 0.45,
  entryRoomChance: 0.15,
  packMin: 1,
  packMax: 3,
  /** ile dokłada każdy poziom w dół */
  perLevel: 0.1,
};
export const DUNGEON_LIGHT = {
  roomChance: 0.3,
  perRoomMin: 1,
  perRoomMax: 2,
  heightM: 2.2,
};
```

Wartości są propozycją; ostateczne mają wyjść z pomiaru z §5, nie z tej tabeli.

### 4. Zapis

Byty w zapisie już są (`EntitySave`). Do rozstrzygnięcia jest to, co §10.6 architektury
zapisało jako dług: **skąd byt pochodzi**. Przy mieszkańcach lochu odtwarzanie tego
z pozycji przestaje działać, bo potwór, który wyszedł z komory, po wczytaniu odrodzi
swoją komorę. Do zrobienia: `origin` (id POI + indeks komory) w `EntitySave`
i podbicie `SAVE_VERSION`. To jest właściwy moment, żeby ten dług spłacić.

### 5. Miary

- **Zaludnienie:** dla 50 lochów z różnych seedów — mediana liczby mieszkańców na loch
  i odsetek lochów z zerem. Zero ma być rzadkie (< 5%), bo pusty loch to dziś stan
  domyślny i to jest cały problem.
- **Światło:** odsetek komór z żagwią, mediana źródeł na loch, i **sprawdzenie, że limit
  ośmiu źródeł nigdy nie jest przekroczony** w karmieniu zestawu.
- **Ciemność nadal działa:** test z M2 bez zmian; dodatkowo snapshot komory z żagwią
  (`dungeon-room-brazier`) i tej samej komory bez pochodni gracza.
- **Determinizm:** `dungeonDwellers` i `dungeonLights` wywołane 1000 razy dają
  identyczny wynik; różne seedy dają różny.
- **Nikt w skale:** żaden mieszkaniec nie stoi w komórce, w której `blocks` odrzuca
  jego sylwetkę — 50 lochów, wszystkie komory.
- **Koszt wejścia:** czas policzenia zawartości lochu przy zejściu (ma być jednorazowy,
  nie na klatkę).
- **Wyludnianie powierzchni — pomiar, nie naprawa.** Trzecia przyczyna z diagnozy
  (klastry zużywane na powierzchni) nie dotyczy wyłącznie lochu: skoro klaster raz
  rozpatrzony nigdy nie wraca, a lista bytów ma twardy sufit, to po dłuższej grze
  pustkowie też powinno pustoszeć. Zmierz, ile bytów żyje w pierścieniu wokół gracza
  po **5, 30 i 120 minutach** chodzenia po powierzchni. Jeśli liczba spada — **nie
  naprawiaj tego w tym zadaniu**. Opisz w podsumowaniu: liczby, mechanizm i propozycja
  osobnego zlecenia.

---

## Definicja ukończenia

1. `pnpm typecheck`, `pnpm test`, `pnpm test:snap`, `pnpm bench` — zielone.
2. Nowy snapshot komory z żagwią; złote pliki lochów opisane, jeśli się ruszą.
3. Liczby z §5 w raporcie.
4. Test ciemności z M2 przechodzi bez zmian w progach.
5. **Weryfikacja w grze, nie w teście**: zejść do lochu i spotkać potwora **przy
   świetle żagwi** — czyli zobaczyć go, zanim wejdzie w krąg własnej pochodni.
   Tego nie zastąpi żaden test, tak jak nie zastąpił przy telegrafie w M3b. Opis
   z gry idzie do podsumowania.
6. Historia podzielona na moduły: `content` → `world` → `apps` → `harness` → `docs`.

---

## Czego świadomie NIE robimy

- respawnu w czasie (loch wyczyszczony zostaje wyczyszczony do końca partii),
- łupów, skrzyń i kluczy — `hasKey` i `locked` są w grafie od M2 i zostają nietknięte,
- nowych gatunków potworów; goblin wystarcza do sprawdzenia reguły,
- oświetlenia dynamicznego innego niż punktowe źródła, które już mamy,
- pułapek i sekretów.

---

## Pułapki

1. **Pozycje w danych chunka.** Zmieniłyby hash zawartości i wywróciły test
   determinizmu oraz zapis. Treść lochu jest funkcją grafu.
2. **Limit ośmiu źródeł w `LightRig`.** `addSource` po cichu zwraca `false`;
   loch z dziesięcioma żagwiami zgaśnie w połowie bez żadnego komunikatu.
3. **Zbyt dużo światła.** Loch ma być ciemny — żagwie są wyjątkiem, który tę ciemność
   podkreśla. Jeśli test ciemności z M2 zacznie wymagać zmiany progu, to znaczy,
   że światła jest za dużo.
4. **Rozmnażanie liczone co klatkę.** Zawartość lochu liczy się raz, przy wejściu
   w jego zasięg, i trzyma w pamięci — inaczej wracamy do kosztu z §5.
5. **Klastry powierzchniowe pod ziemią.** Dopóki `spawnAround` biegnie pod stropem,
   będzie zużywać klastry i stawiać byty na łące nad lochem.
6. **Determinizm a kolejność.** Lista mieszkańców musi być niezależna od kolejności
   odwiedzania komór — liczona z `(seed, poiId, roomIndex)`, nigdy z licznika.

---

## Warunek zatrzymania

Jeśli po dwóch próbach oświetlenie komór i test ciemności z M2 wykluczają się
nawzajem — przerwij i wróć z liczbami: ile źródeł, jaka jasność, który próg testu
pęka. Nie obniżaj progu z M2, żeby przepuścić żagwie.
