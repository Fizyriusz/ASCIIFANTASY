# M3 — Postacie, walka, ekwipunek, zapis

**Cel:** świat przestaje być zwiedzany, a zaczyna być rozgrywany. Po tym zadaniu da się
zginąć w lochu z powodu własnego błędu — i wrócić do zapisu.

To pierwszy milestone, w którym powstaje `packages/rules` i `packages/ui`. Oba mają być
**małe**. Największym ryzykiem M3 nie jest trudność, tylko apetyt.

Przeczytaj wcześniej: `CLAUDE.md`, `docs/architektura.md` §2.3, §3.4 i §6.

---

## Zakres

### Wolno dotykać
```
packages/core/src/sprites.ts        ← nowy: billboardy znakowe
packages/rules/                     ← nowa paczka
packages/ui/                        ← nowa paczka
packages/world/src/save.ts          ← nowy: delty, zapis, wczytanie
packages/content/src/packs/wild/    ← potwory, przedmioty, tabele obrażeń
tools/harness/src/*.test.ts
apps/game/src/main.ts
```

### Nie dotykać
`terrain.ts`, `hydro.ts`, `biome.ts`, `dungeon.ts`, `blit.ts`, `color.ts`, `metrics.ts`,
`hash.ts`.

`raymarch.ts` i `screen.ts` wolno zmienić **wyłącznie** po to, żeby powstał bufor głębi
(patrz §1a). Każda inna zmiana w marszu jest poza zakresem — jeśli okaże się potrzebna,
zatrzymaj się i opisz to w podsumowaniu.

---

## Co ma powstać

### 1. `sprites.ts` — billboardy

Sprite to siatka znaków, nie bitmapa:

```ts
interface SpriteFrames {
  w: number; h: number;
  frames: Uint16Array[];   // kody znaków, 0 = przezroczyste
  palette: number;
}
```

- klatki: `idle`, `walk0`, `walk1`, `attack`, `hit`, `death`
- **cztery kierunki** (przód / tył / bok lewy / bok prawy), wybierane z kąta między
  zwrotem bytu a kierunkiem patrzenia kamery — jak w Doomie. Kosztuje tyle, co więcej
  danych w paczce contentu, a bez tego NPC czyta się jak naklejka obracająca się razem
  z graczem. To jest najtańsza rzecz w całym M3, która daje wrażenie bryły
- skalowanie próbkowaniem najbliższego sąsiada
- **test głębi** przeciwko buforowi z §1a — sprite za ścianą ma zniknąć, sprite
  w drzwiach ma być widoczny (i to jest test, że maska pokrycia z M2 współpracuje
  ze sprite'ami)
- oświetlenie sprite'a bierze luminancję z komórki, na której stoi — potwór w ciemności
  jest niewidoczny, i to jest zamierzone

### 1a. Bufor głębi

`ColumnHits` **nie nadaje się** na z-bufor sprite'ów, wbrew temu, co mogłoby wynikać
z jego nazwy: `renderWorld` używa jednego bufora dla wszystkich kolumn i zeruje
`count` na wejściu do każdej, więc po klatce zostają trafienia wyłącznie ostatniej
kolumny. Struktura służy diagnostyce i przyszłym zastosowaniom per kolumna, nie
całej klatce.

Skalarny `zbuf[cols]` — jedna odległość na kolumnę, jak w prototypie — też nie
wystarczy. Po M2 kolumna może mieć **otwór**: wiersze nad drzwiami, w ich świetle
i pod nimi mają trzy różne głębokości. Jedna liczba na kolumnę wycięłaby sprite'a
stojącego w przejściu albo pokazała go przez ścianę.

Dlatego bufor głębi ma rozmiar **`cols * rows`**:

```ts
depth: Float32Array;   // prealokowany razem z buforem znaków, przy Screen.resize
```

Zapisywany w tym samym miejscu, w którym renderer maluje znak — czyli jedno
przypisanie na komórkę, bez osobnego przebiegu. To jedyny powód, dla którego M3
w ogóle dotyka `raymarch.ts` i `screen.ts`.

Koszt: 4 bajty na komórkę, przy budżecie 15 000 komórek to 60 kB. Zapis w hot pathcie
zmierz i zaraportuj — jeśli `renderWorld` urośnie o więcej niż 10%, wróć z liczbami,
zanim zaczniesz optymalizować.

### 2. `packages/rules` — reguły, minimum

```ts
interface Actor {
  hp: number; stamina: number;
  attrs: Int8Array;          // SIŁ ZRĘ KON INT WOL CHA
  skills: Uint8Array;        // 0..100
  equipped: { weapon: ItemId | null; armor: ItemId | null };
}
```

- **walka real-time**: zamach ma czas trwania zależny od broni, blok i unik działają
  na timing, wytrzymałość jest zasobem — bez niej nie ma decyzji, jest klikanie
- **trafienie**: jeden rzut, `skill + atrybut + modyfikatory vs obrona`. Bez tabel
- **obrażenia**: broń + siła, redukcja przez pancerz, zużycie sprzętu
- **ekwipunek**: waga, sloty, brak automatycznej regeneracji
- **rozwój przez użycie**: skill rośnie od udanych zastosowań, logarytmicznie

Wszystkie liczby w `packages/content`. Jeśli balans wymaga zmiany kodu — model danych
jest zły.

### 3. Percepcja i AI

```ts
function canSee(observer: Actor, target: Actor, world: RenderTarget): boolean;
```

Stożek widzenia + linia wzroku po siatce + **poziom światła celu**. Do tego hałas:
bieg słychać dalej niż skradanie. Maszyna stanów: `idle → suspicious → hunting →
fighting → fleeing`. Ucieczka przy niskim hp jest ważniejsza niż wyrafinowany
pathfinding — potwór, który walczy do śmierci, jest nudny i nierealistyczny.

Skradanie wychodzi z tego za darmo, bo światło już policzyliśmy w M2.

### 4. `packages/ui` — panele w buforze znaków

Ekwipunek, karta postaci, ekran śmierci. Ramki `│ ─ ┌ ┐`, ta sama czcionka, ten sam
bufor. **Zero HTML.** Pierwszy panel jest wzorcem dla wszystkich następnych, więc
wydziel z niego wspólne rysowanie ramki, listy i kursora.

### 5. `save.ts` — zapis

Struktura `SaveFile` istnieje w typach od M0. Teraz ma zacząć działać:

- zapis: seed + zegar + gracz + delty komórek + delty bytów + flagi
- wczytanie: regeneracja świata z seeda, nałożenie delt
- **zapis do `localStorage` z eksportem do pliku** — na Vercelu nie ma backendu
- śmierć: ekran, powrót do ostatniego zapisu

---

## Definicja ukończenia

1. `pnpm typecheck`, `pnpm test`, `pnpm test:snap`, `pnpm bench` — zielone.
2. Snapshoty: `sprite-near`, `sprite-far`, `sprite-occluded` (za ścianą — niewidoczny),
   `sprite-in-doorway` (widoczny przez otwór), `sprite-in-darkness` (niewidoczny),
   `sprite-facing-away` (ten sam byt odwrócony tyłem — inny zestaw znaków),
   `inventory-panel`, `death-screen`.
3. **Test zapisu**: zapisz → wczytaj → porównaj 10 000 losowych komórek i pełny stan
   gracza. Zero różnic. Powtórz po 200 symulowanych godzinach gry.
4. **Rozmiar zapisu** po 200 h syntetycznej gry < 2 MB (limit z `CLAUDE.md`).
5. **Test walki**: 10 000 symulowanych starć — brak `NaN`, brak ujemnego hp poza śmiercią,
   brak nieskończonych pętli, mediana czasu starcia w zadanym przedziale.
6. Budżety: render + sprite'y + blit < 12 ms przy 60 widocznych bytach.
7. `pnpm dev`: zejdź do lochu z pochodnią, spotkaj potwora, zabij go albo zgiń.
   Opisz, co się stało — to jest właściwy raport z tego zadania.
8. Podsumowanie w formacie z `CLAUDE.md`.

---

## Czego świadomie NIE robimy

- magii i czarów (osobne zadanie po M3, konstruktor zaklęć jest projektem sam w sobie)
- dialogów i handlu (M4)
- questów (M5)
- ECS-a, systemu zdarzeń, frameworka AI. Tablice bytów i `switch` po stanie wystarczą
  na 200 bytów, a tyle nigdy nie będzie widocznych naraz

---

## Pułapki

1. **Apetyt.** M3 kusi, żeby zrobić „całą grę". Trzymaj się listy.
2. **Sprite bez testu głębi** — potwory przenikające ściany widać natychmiast i psuje
   to zaufanie do całego renderu.
3. **Regeneracja hp z czasem** — usuwa napięcie i zamienia wytrzymałość w dekorację.
4. **Zapis serializujący świat** zamiast delt: 400 MB i koniec projektu. Limit jest
   w `CLAUDE.md` i jest twardy.
5. **Walka bez wytrzymałości** to klikanie. Zasób wymusza decyzję.
6. **AI bez ucieczki** — każdy przeciwnik walczący do śmierci sprawia, że świat wydaje
   się mechaniczny.
7. **Panel UI rysowany poza buforem** (canvas, HTML) — łamie zasadę 4 z `CLAUDE.md`
   i po trzech panelach masz dwa systemy interfejsu.
