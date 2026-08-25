# CLAUDE.md

Kontrakt pracy nad tym repozytorium. Czytasz to przed każdym zadaniem.
Pełna architektura: `docs/architektura.md`. Aktualne zlecenie: `docs/zadania/`.

---

## Czym jest ten projekt

RPG z otwartym światem w duchu Daggerfalla, renderowane w całości znakami ASCII
w Canvas 2D. Świat jest proceduralny i deterministyczny — nie jest zapisywany, tylko
obliczany z seeda. Setting docelowy: high fantasy. Setting to dane w `content/`,
nigdy kod.

Punkt wyjścia i dowód, że podejście działa: `docs/prototyp/ascii-city.html`
(cyberpunkowe miasto, raycasting DDA, jeden plik, bez bibliotek).

---

## Siedem zasad, od których nie odchodzimy

1. **Determinizm.** Wszystko wynika z `(seed, współrzędne)`. Ta sama para = ten sam wynik, zawsze.
2. **Zapis to delty.** Stan gry = seed + słownik nadpisań. Nigdy nie serializujemy świata.
3. **Leniwa symulacja.** Stan NPC to czysta funkcja `(harmonogram, zegar)`. Liczymy przy zapytaniu.
4. **Jeden bufor znaków.** Świat, UI, mapa, dialogi — ta sama siatka glifów. Zero HTML overlay.
5. **Budżet klatki jest twardy.** Patrz §Budżety. Przekroczenie = zadanie nieukończone.
6. **Zero alokacji w hot path.** W pętli renderu nie powstaje żaden obiekt, tablica ani string.
7. **Zero zależności runtime.** DevDependencies wolno. Runtime — tylko po wpisie w tym pliku.

---

## Budżety (mierzalne, nie orientacyjne)

| Metryka | Limit | Jak mierzyć |
|---|---|---|
| komórki znakowe na klatkę | 15 000 | `cols * rows` po `resize()` |
| czas klatki, scena referencyjna | 16 ms (p95) | `pnpm bench` |
| wywołania `fillText` na klatkę | 2 500 | licznik w blicie |
| alokacje w pętli renderu | 0 | brak `{}`, `[]`, `new`, konkatenacji w hot path |
| spany na komórkę, teren otwarty | średnio ≤ 1.3 | `pnpm test world` |
| rozmiar zapisu po 200 h gry | < 2 MB | test syntetyczny |
| czas generacji chunka | < 8 ms | `pnpm bench world` |

Scena referencyjna: `seed=1337`, kamera `(33.0, 32.5)`, azymut 90°, 150×48 znaków.

Limit spanów dotyczy **terenu otwartego** — tam decyduje o kosztach pamięci i generacji.
Zabudowa ma prawo być gęstsza: miasto testowe z M0 daje 1.339 spanu na komórkę
(1389 komórek wielospanowych na 4096) i to jest w porządku. Realny pomiar tego
budżetu ma sens dopiero przy generacji proceduralnej w M1.

**Próg przejścia na WebGL.** Canvas 2D wystarcza, dopóki run-length trzyma serie długie —
scena referencyjna to siatka 7 200 komórek, z czego 6 741 zamalowanych, i wychodzi z tego
978 wywołań `fillText` przy **0,24 ms** na sam blit (`renderWorld` to osobne 0,84 ms).
Rozważamy atlas glifów na GPU dopiero, gdy p95 samego blitu przekroczy **6 ms** — czyli
25× obecnej wartości. Wcześniej to optymalizacja bez problemu do rozwiązania, a kosztuje
przepisanie warstwy rysującej i utratę headless testów snapshotowych w obecnej formie.

---

## Układ repo i kierunek zależności

```
apps/game          → pętla, input, sklejenie całości
packages/ui        → panele do bufora znaków
packages/quest     → szablony, sloty, dziennik
packages/sim       → agenci, harmonogramy, ekonomia, plotki
packages/rules     → walka, statystyki, ekwipunek
packages/world     → generacja, chunki, delty, RNG
packages/core      → bufor znaków, blit, kolory, raymarch
packages/content   → dane settingu (JSON), zero logiki
tools/harness      → headless render → snapshot ASCII
tools/mapdump      → podgląd regionu z góry
```

Zależności idą **wyłącznie w dół** tej listy. `core` i `world` nie importują niczego
z góry. Renderer nie ma prawa wiedzieć, że istnieją questy. Jeśli potrzebujesz odwrotnej
zależności — projekt jest zły, zgłoś to zamiast obchodzić.

---

## Konwencje kodu

- TypeScript, `strict: true`, `noUncheckedIndexedAccess: true`. Bez `any`. Bez `!`
  poza kodem, gdzie sam bezpośrednio wcześniej sprawdziłeś warunek.
- Nazwy identyfikatorów po angielsku. Komentarze i dokumentacja po polsku.
- Hot path (render, marsz kolumnowy, blit): styl proceduralny, `TypedArray`, bufory
  prealokowane, brak metod tablicowych wyższego rzędu, brak destrukturyzacji w pętli.
- Poza hot path: normalny, czytelny TS. Nie optymalizuj tego, co nie jest w budżecie.
- Wszystkie liczby balansu (obrażenia, ceny, czasy) w `packages/content`. Zmiana
  balansu nie może wymagać dotknięcia kodu.
- Funkcje generujące świat są **czyste**. Żadnego `Math.random()` w `packages/world`
  — wyłącznie `h32` / `mulberry32` z `@rpg/world/rng`. To jest sprawdzane testem.
- Hash tekstury liczysz z **współrzędnych świata**, nigdy ekranu. Inaczej tekstura pływa.
- **Wariacja glifów w rampie idzie w kształt, nie w ciężar.** Glify jednego pasma
  mają mieć zbliżone pokrycie atramentem (tabela `INK_COVERAGE` w `packages/content`).
  Skok wagi — na przykład `&` (0,45) wymienione na `@` (0,62) — oko czyta jako
  migotanie, nawet gdy liczba zmienionych komórek jest niska. Pomiar z M1c: podmiana
  jednego takiego glifu w rampie mchu zbiła metrykę ważoną z 0,55 na 0,34, podczas gdy
  przemiatanie `roughness` koron w zakresie 0,35–0,7 nie ruszyło jej wcale. Ten
  składnik migotania okazał się większy niż `roughness` i krok kratki hasza razem.

---

## Komendy

```bash
pnpm install
pnpm dev             # apps/game na vite
pnpm build
pnpm typecheck       # tsc --noEmit we wszystkich paczkach
pnpm test            # vitest run
pnpm test:snap       # render headless + porównanie ze złotymi plikami
pnpm snap:update     # regeneracja złotych plików (tylko świadomie!)
pnpm bench           # budżety wydajności
```

---

## Rytm commitów, gałęzie i tagi

**Commituj po każdym module, który przechodzi `pnpm typecheck` i `pnpm test` — nie
na końcu zlecenia.** Jeden moduł = jeden commit, nawet gdy zlecenie jest jednym
zadaniem i nawet gdy moduł sam w sobie niczego jeszcze nie robi.

Powód jest jeden i jest praktyczny: przegląd sześciu kawałków jest wykonalny, przegląd
2800 linii nie jest. M2 poszło jednym commitem (`edd3a42`, 25 plików, +2831/-128)
i przez to cała ścieżka dojścia — maska pokrycia, pole światła, generator lochu,
poprawki wejścia, dwie optymalizacje — jest sklejona w jedną zmianę, a komunikat
opisuje wyłącznie ostatni krok. Rozbijanie tego po fakcie odpada: produkowałoby
historię, która nie odpowiada temu, jak praca przebiegała, a force-push na zielony
`main` to ryzyko bez korzyści.

Podział idzie **w dół grafu zależności** z §Układ repo, żeby każdy commit był zielony
osobno: `content` → `core` → `world` → `harness`/`apps` → `docs`. Eksperymenty,
pomiary i ślepe uliczki nie są modułami i nie zostają w historii — zostaje wniosek
z nich, w komentarzu albo w dokumentacji.

`git push` robisz **wyłącznie na wyraźną prośbę**. Commit lokalny to zapis postępu,
push to publikacja i decyzja należy do człowieka.

### Gałąź na milestone (od M3)

Praca idzie na `milestone/mN`, merge do `main` **po odbiorze**, nie w trakcie.
Powód nie jest ceremonialny: `main` jest tym, co Vercel wystawia jako produkcyjny
deploy, a więc tym, z czego robi się nagrania i pokazy. Milestone w trakcie robót
ma stan, w którym coś działa w połowie — na `main` to znaczy, że nie ma z czego
nagrywać, dopóki zlecenie się nie skończy.

Vercel buduje każdą gałąź osobno, więc `milestone/mN` dostaje własny preview URL
i to on służy do oglądania postępów. Nic nie trzeba w tym celu konfigurować.

### Tag na stan nagrywalny

Każdy odebrany milestone dostaje tag `mN-recording` na commicie, którym się kończy:

```bash
git tag -a m3-recording <sha> -m "M3: <co w nim jest>. Stan nagrywalny."
git push --tags
```

Powód: nagranie robi się zwykle później niż kod, a świat jest funkcją seeda **i kodu**.
Ten sam seed po zmianie generatora daje inny teren, więc bez tagu materiał nagrany
z M1 nie daje się odtworzyć po wejściu M2. Istniejące tagi:
`m1-recording` (5224af3), `m2-recording` (edd3a42).

---

## Definicja ukończenia zadania

Zadanie jest gotowe, gdy **wszystkie** punkty są spełnione:

1. `pnpm typecheck` czysto, zero ostrzeżeń.
2. `pnpm test` zielone, w tym testy dopisane w tym zadaniu.
3. `pnpm test:snap` zielone — albo zmiana złotych plików jest **opisana i uzasadniona**
   w podsumowaniu, wraz z diffem tekstowym pokazującym, co się zmieniło wizualnie.
4. `pnpm bench` w budżecie.
5. Publiczne API modułu ma komentarze wyjaśniające *dlaczego*, nie *co*.
6. Podsumowanie zawiera: co zrobione, jakie decyzje podjęte, co świadomie pominięte.
7. Historia zmian jest podzielona na moduły zgodnie z §Rytm commitów, a nie zebrana
   w jeden commit na koniec.

---

## Czego nie robisz bez pytania

- Nie dodajesz zależności runtime.
- Nie zmieniasz plików spoza listy w zleceniu.
- Nie aktualizujesz złotych snapshotów, żeby test przeszedł. Snapshot czerwony oznacza
  albo regresję, albo świadomą zmianę — jedno i drugie wymaga opisu.
- Nie wprowadzasz frameworka UI, ECS-a, silnika fizyki ani systemu zdarzeń „na przyszłość".
- Nie refaktoryzujesz przy okazji. Osobne zadanie.
- Nie generujesz contentu (nazw, dialogów, tabel) w kodzie — to dane w `packages/content`.

---

## Antywzorce zaobserwowane w prototypie

Te błędy już raz kosztowały czas. Nie powtarzamy ich:

1. **Brak run-length w blicie** — 10 000 wywołań `fillText` zamiast 1 500 to różnica
   między 15 a 60 fps. Sklejaj sąsiednie znaki o tym samym kolorze w jeden string.
2. **Kolor per znak bez kwantyzacji** — serie się nie sklejają. Kwantyzujemy do 15 bitów
   (`pack15`), co daje ~5× dłuższe serie przy niezauważalnej stracie jakości.
3. **Alokacja obiektu na trafienie promienia** — 1 200 obiektów na klatkę i GC co sekundę.
   Trafienia trzymamy w prealokowanych `Float64Array` / `Int32Array`.
4. **Brak budżetu komórek** — telefon w orientacji pionowej daje 26 000 komórek i 8 fps.
   `resize()` musi zwiększać rozmiar czcionki, aż zmieści się w budżecie.
5. **Wysokość jako pojedyncza liczba na komórkę** — blokuje mosty, piętra i jaskinie.
   Od początku model spanów (`docs/architektura.md` §2.1).

---

## Testy — czym się różni ten projekt

Render jest tekstem, więc regresja graficzna jest **diffem tekstowym**. To przewaga,
której nie ma żaden silnik 3D — używamy jej agresywnie:

- **Snapshot ASCII** — headless render ustalonej sceny → porównanie z `tools/harness/golden/*.txt`.
  Każda zmiana w rendererze musi mieć snapshot.
- **Determinizm** — `generateChunk(seed, cx, cy)` wywołane 1000 razy daje identyczny hash.
- **Właściwości symulacji** — po 365 dobach: brak ujemnych populacji, brak `NaN` w cenach,
  brak bytów uwięzionych w geometrii.
- **Sanity questów** — 10 000 instancji, żadna z nieosiągalnym slotem.

---

## Jak raportujesz

Krótko i konkretnie. Bez opowiadania, co to jest TypeScript.

```
ZROBIONE:    <lista plików i co w nich>
DECYZJE:     <wybory, które nie wynikały wprost ze zlecenia, z uzasadnieniem>
POMINIĘTE:   <co świadomie zostawione i dlaczego>
BUDŻET:      <liczby z bench, porównane z limitem>
SNAPSHOTY:   <bez zmian | zmienione + diff + powód>
RYZYKA:      <co może boleć w kolejnym module>
```
