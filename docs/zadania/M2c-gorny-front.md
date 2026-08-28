# M2c — Górny front: bryła wisząca to nie sufit

**Cel:** renderer ma poprawnie pokazywać geometrię **nad okiem, która nie jest
sufitem** — korony drzew, przęsła mostów, wystające skały, a od M3 sprite'y
potworów i łupu.

**Termin: przed M3.** Sprite'y są dokładnie bryłami wiszącymi i wejdą w ten sam kod.
Wchodzenie w M3 z tym błędem znaczy, że każdy potwór dostanie ten sam objaw, tylko
że wtedy będzie się ruszał.

Przeczytaj wcześniej: `CLAUDE.md`, `docs/architektura.md` §3.1 i §10.4.

---

## Co jest źle w modelu

`renderColumn` ma dwa fronty wypełniania. Front górny (`hiRow`) obsługuje spany,
których spód jest nad okiem, i **traktuje każdy z nich jak sufit**:

1. spód spanu rzutuje floor-castem jako **płaszczyznę poziomą ciągnącą się nad
   graczem** — tak jak strop pomieszczenia,
2. `hiRow` przesuwa się na wiersz rzutu spodu, czyli **wszystkie wiersze powyżej
   zostają zapisane jako zamalowane**.

Dla wnętrza oba założenia są prawdziwe. Dla korony drzewa oba są fałszywe: korona
zasłania własny pas wierszy i nic poza tym, a nad nią może stać drugie drzewo,
grzbiet albo niebo.

Do M2b nie było tego widać, bo niebo nie było malowane: brakująca geometria
wychodziła czarna na czarnym i wyglądała jak cień.

### Trzy objawy, jeden błąd

Wszystkie trzy zgłoszone z gry w trakcie odbioru M2b:

- **prostokątne łaty nieba na koronach, rosnące, gdy oko opada.** Pomiar: kamera
  nieruchoma w lesie, oko od 3,4 m do 1,0 m nad gruntem, komórek nieba nad
  horyzontem **1216 → 1905**. Odległość i jasność drzewa bez zmian — rośnie sam
  kąt, jaki korona zajmuje nad okiem, a z nim liczba wierszy błędnie zamkniętych;
- **„ciemna szachownica" zamiast tafli nieba**, gdy kolumny weszły na maskę
  pokrycia. Ślad: komórka 254 m od kamery rzutuje swój spód floor-castem na
  wiersze odległe o **25–43 m**, czyli spód korony rozlewa się na cały górny kadr
  jako fałszywy strop. Szybka ścieżka ograniczała to przypadkiem przez `hiRow`;
- **pień, który wpada w górny front**, gdy oko zejdzie poniżej jego spodu,
  przesuwa `hiRow` poniżej wierszy własnej korony — i korona przestaje się malować.

---

## Cztery próby, które zawiodły

Zapisane, żeby nie powtarzać. Każda usuwa jeden objaw i odsłania następny; to jest
sygnał, że brakuje elementu modelu, a nie warunku brzegowego.

| próba | usuwa | psuje |
|---|---|---|
| ograniczenie czapki górnego frontu wierszem `hiRow + 1` | fałszywy strop w niebie | korona nad pniem przestaje się malować (jej czapka zaczyna się poniżej własnych wierszy) |
| pominięcie w masce spanów zakrytych w całości | identyczność ścieżek | niebo znów rośnie przy opadaniu oka (+29 komórek) — zakryty span bywa potrzebny dla płaszczyzny widocznej nad nim |
| księgowanie „poprzedniej powierzchni" po froncie zamiast po pokryciu | identyczność ścieżek | zostaje ubytek 27 komórek geometrii |
| warunek „wiersz nie może rzutować się bliżej niż komórka, do której należy" | fałszywy strop, poprawnie i fizycznie | psuje identyczność ścieżek, bo szybka ścieżka i maska rozważają inne zakresy wierszy |

Czwarta próba jest najbliżej sedna i warto od niej zacząć: **spód bryły jest
płaszczyzną tej komórki, a nie nieskończonym stropem**. Brakuje jej drugiej połowy —
reguły, która mówi, ile wierszy taka bryła w ogóle zamyka.

Wycofany commit z tą serią: `33166c9` (rewert `feefc89`), do obejrzenia jako materiał,
nie jako punkt wyjścia.

---

## Zakres

### Wolno dotykać
```
packages/core/src/raymarch.ts       ← górny front, maska pokrycia
tools/harness/src/*.test.ts
tools/harness/golden/*              ← po opisaniu diffu
docs/architektura.md                ← §3.1 i §10.4 po naprawie
```

### Nie dotykać
`packages/world`, `packages/content` — to jest błąd renderera i geometria świata
nie ma się do niego dopasowywać. Jeśli okaże się, że musi, zgłoś to zamiast obchodzić.

---

## Co ma powstać

Rozstrzygnięcie należy do wykonawcy; dwie ścieżki, które widać z dzisiaj:

**A. Rozróżnienie sufit / bryła wisząca w górnym froncie.** Span dostaje odpowiedź
na pytanie „czy nad tobą jest jeszcze coś w tej kolumnie". Sufit rzutuje płaszczyznę
i zamyka wiersze powyżej; bryła wisząca maluje wyłącznie własny pas i **nie rusza
`hiRow`** — a wtedy kolumna musi umieć zapamiętać więcej niż dwa fronty, czyli
przechodzi na maskę pokrycia.

**B. Maska jako ścieżka domyślna.** Zamiast dwóch reguł jedna: kolumna zawsze
liczy pokrycie per wiersz. Prosto i bez wyjątków, ale trzeba zmierzyć koszt —
pomiar z M2b: wymuszona maska na wszystkich kolumnach to +32% czasu klatki
w lesie i +36% na wzgórzach (12,3 → 16,1 ms i 9,0 → 12,2 ms w vitest, czyli
około 3–4 ms w przeglądarce przy budżecie 8 ms). Okno niezamalowanych wierszy
odzyskuje z tego mniej więcej połowę.

**Uwaga do tych liczb: to koszt maski przy OBECNYM, błędnym modelu.** Maska maluje
dziś między innymi fałszywe stropy, których w poprawionym modelu nie będzie, a spany
zakryte przetwarza bez skrótu, który poprawiony model może dopuścić. Poprawiona
wersja może kosztować mniej albo więcej. Te liczby są **przesłanką, nie prognozą**,
i nie mogą same rozstrzygnąć wyboru ścieżki — decyduje pomiar na naprawionym
kodzie, zrobiony przed wyborem, a nie po.

Jeśli wyjdzie ścieżka B, §3.1 architektury trzeba przepisać, a nie dopisać do niej
akapit: „szybka ścieżka dwóch frontów" przestaje być domyślna i cała sekcja o tym
mówi inaczej.

---

## Definicja ukończenia

Poza standardem z `CLAUDE.md`:

1. **Niezmiennik identyczności ścieżek.** Dla tej samej kamery i sceny render
   szybką ścieżką i render z wymuszoną maską (`RenderContext.forceMask`) dają
   **identyczny bufor znaków i kolorów**, na wszystkich 22 scenach repo. To jest
   kryterium odbioru, nie test pomocniczy: maska przestaje być punktem odniesienia,
   a staje się drugą implementacją tej samej specyfikacji, i każda różnica znaczy,
   że któraś ścieżka kłamie — bez potrzeby wiedzieć która.
   *(Jeśli wyjdzie ścieżka B, ten niezmiennik znika razem ze szybką ścieżką i wtedy
   trzeba go zastąpić czymś równie mocnym. Sam fakt, że nie ma dwóch implementacji,
   nie jest argumentem za brakiem testu.)*
2. **Niezmiennik opadającego oka.** Im niżej oko, tym wyżej rzutują się bryły nad
   nim, więc komórek nieba nad horyzontem może tylko ubyć. Test już istnieje
   w `tools/harness/src/invariants.test.ts` w wersji z M2b — po naprawie ma przejść
   dla sekwencji, na której dziś się czerwieni.
3. **Scena kontrolna z bryłą wiszącą i geometrią za nią.** Krzak, za nim drzewo,
   za nim grzbiet; snapshot plus asercja, że wszystkie trzy są w kadrze.
4. **Budżet.** `renderWorld` na scenach pustkowia w przeglądarce poniżej 8 ms.
   Jeśli wybrana ścieżka kosztuje więcej niż +20% względem stanu z `feefc89`,
   podaj liczby i uzasadnij, dlaczego to opłacalne.
5. **Weryfikacja w grze, nie tylko w harnessie.** Cztery poprzednie rundy miały
   zielone snapshoty i widoczny błąd na ekranie; snapshot pokazuje tylko tę scenę,
   którą ktoś wcześniej wybrał.

   Procedura, wąwóz wejściowy do jaskini z seeda 4242 — drzewa stoją tam kilkanaście
   metrów na południe od rynny, a rampa daje płynną zmianę wysokości oka:

   1. `G` — lądujesz w wąwozie na `(-177,5, -426,5)`, twarzą do wylotu tunelu
      (na wschód, w stronę rosnącego `x`).
   2. Obróć się **na południe** — tak, żeby `y` malało, gdy idziesz do przodu.
      HUD podaje `x` i `y`, więc kierunek sprawdzasz jednym krokiem.
   3. Idź na północ (`S` tyłem albo obrót i `W`) do `y ≈ -419`. HUD pokaże
      wysokość **26,7 m n.p.m.**
   4. Wróć na południe klawiszem `W` do `y ≈ -423`, czyli wysokość **24,5 m**.
      To jest dokładnie sekwencja opadającego oka ze zgłoszenia.
   5. Przez cały czas patrz na korony drzew 12–14 komórek przed sobą
      (24–28 m; najbliższe to `(-180,-439)` z koroną 27,4–32,8 m oraz
      `(-182,-439)`). **Na żadnej wysokości oka nie może pojawić się prostokątna
      łata nieba na koronie, ani żadna łata nie może rosnąć w trakcie marszu.**

   Wysokości do kontroli w HUD: y=-419 → 26,7 m, y=-421 → 25,6 m, y=-423 → 24,5 m,
   y=-425 → 23,4 m.

   Jeśli wykonawca nie może sprawdzić wizualnie (brak kompozycji klatek
   w środowisku), to **procedura wyżej jest częścią zgłoszenia do odbioru**
   i człowiek wykonuje ją przed przyjęciem zlecenia. Zielony harness bez tego
   kroku nie wystarcza.

6. **Podsumowanie zawiera, która ścieżka wybrana i dlaczego** — a jeśli żadna
   z dwóch powyżej, to co zamiast i co obaliło tamte.

---

## Czego świadomie NIE robimy

- nie ruszamy generacji świata, żeby obejść błąd renderera,
- nie dodajemy przełącznika „stary/nowy front" — jedna ścieżka, jeden obraz,
- nie zostawiamy trybu maski jako wyjątku bez testu identyczności; to on złapał
  wszystkie trzy warianty i bez niego naprawa jest nieweryfikowalna.

---

## Warunek zatrzymania

**Po dwóch nieudanych próbach przerywasz i wracasz z opisem.** Nie próbujesz trzeciej.

Próba nieudana to taka, po której **oba niezmienniki nadal się wykluczają** — jeden
przechodzi kosztem drugiego. Wtedy raport zawiera: co konkretnie się wyklucza (który
warunek w którym miejscu), dlaczego jedno wymusza drugie, i czego brakuje w modelu,
żeby dało się mieć oba naraz.

Powód jest policzony, nie ostrożnościowy: cztery łatki w poprzedniej rundzie
kosztowały więcej niż jedna rozmowa o modelu, a skończyły się i tak wycofaniem
commita. Rozmowa o modelu jest tańsza od piątej łatki i to jest jedyne, co ten
warunek mówi.

---

## Pułapki

1. **Łatanie objawu zamiast modelu.** Cztery próby z tabeli wyżej były dokładnie
   tym. Jeśli poprawka ma postać „dodaj warunek w jednej pętli" — sprawdź oba
   niezmienniki, zanim uznasz ją za działającą.
2. **Maska bez okna niezamalowanych wierszy** maluje każdy span przez cały ekran.
   Przy masce domyślnej to jest różnica rzędu 30% czasu klatki.
3. **`ceilZ` jako stan kolumny.** Dziś jedna liczba opisuje „poprzedni sufit",
   a przy bryłach wiszących sufitów jest kilka na różnych wysokościach. To jest ta
   sama pułapka co światło per komórka z §10.1 — jedna liczba na kolumnę tam,
   gdzie potrzeba wielu.
4. **Snapshoty przesuną się szeroko.** To poprawka odzyskująca geometrię, więc
   diff będzie duży (w M2b samo częściowe podejście ruszyło `wild-hills` o 44%).
   Obejrzyj każdy złoty plik i opisz, co wróciło do kadru.
