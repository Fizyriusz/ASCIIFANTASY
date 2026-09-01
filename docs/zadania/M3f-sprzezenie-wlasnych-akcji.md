# M3f — sprzężenie własnych akcji i celowanie

**Cel:** M3b dał sprzężenie z **cudzych** akcji: widać zamach goblina, widać trafienie,
widać wyczerpanie. Brakuje drugiej połowy — własnego ciała. Gracz nie widzi swojego
zamachu, nie odróżnia bloku od uniku i poza napisem przy pasku wytrzymałości nie ma
nic, co potwierdzałoby, że jego wejście w ogóle zostało przyjęte.

Blok, unik i cios to **trzy różne decyzje** i mają wyglądać jak trzy różne rzeczy.
Dziś wyglądają jak nic.

Do tego dochodzi **celowanie**: trafienie zaczyna zależeć od tego, gdzie gracz patrzy,
także w pionie. Jedno i drugie jest w tym samym zleceniu, bo celowanie bez celownika
nie ma sensu — gracz musi widzieć, gdzie mierzy, zanim zacznie to mieć znaczenie.

Poza celowaniem model walki z M3/M3b zostaje bez zmian: żadnych stref ciała, żadnej
bryły ciosu, te same czasy i ten sam rzut na trafienie.

Przeczytaj wcześniej: `CLAUDE.md` §Siedem zasad (4), `docs/architektura.md` §3.4, §6, §7,
zlecenie M3b.

---

## Stan wejściowy

Co gracz widzi dziś, gdy sam działa:

| akcja | sygnał w kadrze | sygnał w HUD |
|---|---|---|
| zamach | **brak** | etykieta „zamach" przy pasku |
| odbicie po ciosie | **brak** | etykieta „odbicie" |
| blok | **brak** | etykieta „blok" |
| unik | **brak** | etykieta „unik" |
| odmowa akcji | brak | wpis w dzienniku |

Etykieta przy pasku wytrzymałości jest jedynym kanałem — czyli informacja o tym, co
robi własne ciało, leży w rogu ekranu, poza miejscem, w które gracz patrzy w walce.

---

## Zakres

### Wolno dotykać
```
packages/ui/                      ← rysowanie własnych akcji do bufora znaków
packages/content/src/items.ts     ← rysunek broni w kadrze, per broń
packages/content/src/feedback.ts  ← czasy i amplitudy
apps/game/src/main.ts             ← wywołanie, kolejność rysowania
tools/harness/src/*.test.ts
docs/architektura.md              ← §7
```

```
packages/rules/src/ai.ts          ← wyłącznie reguła celowania w `serviceSwing`
packages/rules/src/being.ts       ← bryła bytu potrzebna do okna pionowego
```

### Nie dotykać
Postawy, czasy broni, wzór trafienia i wzór obrażeń (M3/M3b) — celowanie zmienia
**warunek dojścia ciosu**, a nie to, co się dzieje po jego dojściu.
`packages/core`, renderer, generacja świata.

---

## Co ma powstać

### 0. Celowanie: kierunek patrzenia musi przecinać pudełko celu

Dziś trafienie czyta wyłącznie odległość poziomą i kąt w poziomie. Pion nie występuje
w kodzie w ogóle — celowanie nad głowę przeciwnika trafia tak samo jak w brzuch,
a goblin stojący na przęśle mostu jest trafialny z dołu i sam trafia w dół.

Nowa zasada, bez modelu trafień w części ciała:

- **Pion.** Cel jest trafiony, gdy kąt elewacji patrzenia mieści się w kącie, jaki
  zajmuje sylwetka celu, powiększonym o margines. Przy 2 m i sylwetce goblina okno
  wychodzi od **−9°** (głowa) do **−40°** (stopy), czyli 31° — hojnie, ale wymusza
  patrzenie **na** przeciwnika, a nie nad niego. Wysokość bytu zaczyna mieć znaczenie:
  na wilka trzeba spojrzeć niżej niż na trolla, i to jest zamierzone.
- **Poziom.** Łuk ciosu schodzi z ±0,9 rad do najwyżej **±0,55 rad (~31°)**. Dziś łuk
  jest **szerszy niż pole widzenia** (±37°), czyli można trafić coś, czego nie widać —
  a tego nie wolno.
- **AI.** Ta sama reguła pionowa obowiązuje symetrycznie: goblin z przęsła mostu nie
  może trafić kogoś pod spodem. Byt celuje w środek sylwetki celu, więc po jego stronie
  rozstrzyga **pionowy zasięg ciosu**, a nie kąt patrzenia.
- **Margines** zaczyna od ~8°, ale ma być **dobrany pomiarem** — patrz DoD 6.

### 1. Własny zamach widoczny w kadrze

Broń **wchodzi w kadr od dołu** przez czas `windupMs` swojej broni i **znika
w chwili rozstrzygnięcia** — czyli dokładnie wtedy, gdy `serviceSwing` zwraca wynik.
Dzięki temu gracz uczy się rytmu własnej broni tak samo, jak uczy się rytmu goblina:
patrząc, a nie licząc.

- rysunek broni jest **daną w contencie**, osobną dla sztyletu, miecza i maczugi —
  różnica długości i masy ma być widoczna, bo to ona odróżnia te trzy bronie
  w mechanice (180 / 320 / 460 ms zamachu),
- pozycja pionowa wynika z postępu zamachu: `1 − stanceMs / windupMs`,
- w fazie `Recover` broni **nie ma** w kadrze; odbicie jest karą i ma wyglądać
  jak bezbronność, a nie jak druga faza animacji.

### 2. Blok jako znak, unik jako ruch

- **Blok** trwa tak długo, jak długo gracz go trzyma — więc jego znak jest **stały**
  w kadrze: zasłona przy dolnej krawędzi, wyraźnie inna od wchodzącej broni.
- **Unik przesuwa postać.** Nie dostaje żadnego znacznika: sygnałem jest to, że świat
  jedzie w drugą stronę. Dziś unik jest oknem nietykalności ze znaczkiem obok — czyli
  mechaniką schowaną pod symbolem; po zmianie jest ruchem, który widać.

Zasady uniku:

- przesunięcie o **około metr** w kierunku wynikającym z klawiszy ruchu (bok albo tył);
  **bez klawisza — w tył**,
- rozłożone na czas okna uniku, z przyspieszeniem: szarpnięcie na starcie, wyhamowanie
  na końcu,
- ruch idzie przez **tę samą kolizję co chodzenie**. Unik w ścianę ma nie działać,
  a nie przenikać — i to jest osobny punkt do sprawdzenia, bo to najłatwiejsze miejsce
  na przypadkowe wyjście poza geometrię.

Znacznik uniku z pierwszej wersji tego zlecenia **wypada**. Razem z nim znika pułapka
miary „efekt globalny przejdzie każdy test różnicy" — bo nie ma już czego rysować.

### 3. Wszystko w buforze znaków

Żadnego widżetu, żadnej warstwy HTML, żadnego drugiego canvasu — ta sama zasada co
przy linii zdarzeń i panelach. Rysowanie idzie do `packages/ui` jako kolejny element
wzorca z `panel.ts`, a nie jako kod w pętli gry.

Kolejność rysowania: świat → sprite'y → **własne akcje** → przyciemnienie → HUD.
Własna broń jest bliżej niż wszystko inne, więc rysuje się na wierzchu geometrii,
ale pod wskaźnikami.

### 4. Decyzja do podjęcia pomiarem: własna broń w ciemności

Czy własny zamach ma być widoczny bez pochodni? Konsekwentnie — nie, bo w ciemności
nie widać niczego i to jest mechanika z M2. Ale wtedy gracz walczący po ciemku traci
jedyny sygnał o własnych akcjach.

Zmierz obie wersje (broń oświetlona jak reszta kadru vs broń z własną podłogą jasności)
i **wybierz na podstawie czytelności**, opisując wybór. Czego nie wolno: podnosić
minimalnego oświetlenia otoczenia — to zabija mechanikę ciemności i test z M2.

### 5. Celownik

Skoro pion zaczyna mieć znaczenie, gracz musi widzieć, gdzie celuje — dziś nie ma
w kadrze nic, co by to pokazywało. Minimalny znacznik w środku kadru, w buforze znaków,
**przygaszony**: ma być punktem odniesienia, a nie elementem, na który się patrzy.

**Do rozważenia, nie do wykonania bez zgody:** czy znacznik ma zmieniać wygląd, gdy cel
jest w zasięgu i w łuku. Pomaga, ale zabiera część decyzji — do obejrzenia w grze,
zanim zapadnie decyzja. W tym zleceniu powstaje **wyłącznie wersja stała**; wariant
reagujący opisz w podsumowaniu jako propozycję, razem z tym, jak wyglądałby w kadrze.

---

## Definicja ukończenia

1. `pnpm typecheck`, `pnpm test`, `pnpm test:snap`, `pnpm bench` — zielone.
2. Snapshoty: `self-idle`, `self-windup-dagger`, `self-windup-club`, `self-block`.
   **Każda para różni się co najmniej 20 komórkami** — porównywane między sobą,
   nie tylko ze wzorcem. Unik snapshotu nie ma, bo nie rysuje niczego własnego.
3. Test czasu: broń jest w kadrze przez `windupMs` swojej broni ±1 klatka i znika
   w klatce rozstrzygnięcia. Sprawdzone dla wszystkich trzech broni.
4. **Unik jako ruch**: test, że pozycja gracza po uniku zmieniła się o zadany dystans
   (±20%) i w zadanym kierunku, oraz że unik w ścianę **nie przesuwa** — ta sama
   kolizja co przy chodzeniu, żadnego przenikania.
5. Budżet klatki bez zmian: rysowanie własnych akcji poniżej 0,1 ms.
6. **Koszt celowania zmierzony:** ile procent ciosów, które trafiają dziś, przestaje
   trafiać po wprowadzeniu reguły — w normalnej walce na płaskim, przy graczu
   celującym w przeciwnika. **Powyżej 20% margines jest za wąski** i trzeba go dobrać
   pomiarem, nie na oko. Podaj wynik dla marginesu 8° i dla wartości wybranej.
7. **Test pionu w obie strony:** byt na przęśle mostu ani nie trafia w dół, ani nie jest
   trafiany z dołu, przy tej samej odległości poziomej, która na płaskim daje trafienie.
8. **Łuk mieści się w kadrze:** cel poza polem widzenia nie może zostać trafiony.
9. Weryfikacja w grze: wykonać wszystkie trzy akcje i opisać, czy da się je odróżnić
   bez patrzenia na HUD; osobno — czy celowanie w pionie czyta się jako umiejętność,
   a nie jako utrudnienie.
10. Historia podzielona na moduły: `content` → `rules` → `ui` → `apps` → `harness` → `docs`.

---

## Czego świadomie NIE robimy

- animacji ciała innej niż broń (ręce, tarcza, sylwetka),
- zmian w regułach walki: czasy, zasięgi i wynik ciosu zostają,
- osobnego widoku trzecioosobowego,
- efektów cząsteczkowych i dźwięku.

---

## Pułapki

1. **Efekt globalny jako miara.** Patrz §2 — kryterium 20 komórek musi mierzyć część
   lokalną.
2. **Broń zasłaniająca przeciwnika w zwarciu.** Przy 1,4 m widać 18% sylwetki goblina
   (pomiar z M3b); broń wchodząca w kadr może zasłonić resztę. Zmierz, ile komórek
   sylwetki przeciwnika zostaje zakrytych w szczycie zamachu, i trzymaj to poniżej
   jednej trzeciej.
3. **Rysunek broni w kodzie.** To jest content, jak rysunek goblina.
4. **Znak bloku mylony z zamachem.** Blok jest stanem, zamach ruchem — jeśli oba
   są „czymś przy dolnej krawędzi", gracz ich nie odróżni. Kryterium z §DoD 2 to
   wychwyci, ale projektować trzeba od razu z tą różnicą.
5. **Rysowanie przy otwartym panelu.** Ekwipunek i karta postaci zasłaniają kadr;
   własne akcje nie mają się spod nich wysypywać.
5a. **Unik omijający kolizję.** Przesunięcie „bo to tylko efekt" jest najprostszym
   sposobem na wyjście gracza za geometrię — ma iść dokładnie tą samą drogą co krok.
6. **Okno pionowe liczone od nóg zamiast od bryły.** Sylwetka zajmuje przedział kątów,
   a nie punkt — warunek musi porównywać przedział z przedziałem, inaczej trafienie
   w tors będzie działać, a w głowę nie.
7. **Zwężenie łuku bez zmiany AI.** Jeśli byt nadal będzie zaczynał zamach w łuku
   szerszym niż ten, w którym cios dochodzi, wróci błąd z M3b: zamachy kończące się
   niczym. `reachOf` i łuk mają mieć jedną definicję dla obu stron.

---

## Warunek zatrzymania

Jeśli po dwóch próbach nie da się pogodzić widoczności własnej broni z czytelnością
przeciwnika w zwarciu (pułapka 2) — przerwij i wróć z liczbami: ile komórek sylwetki
zasłania broń w każdej z prób. Nie zmniejszaj rysunku poniżej czytelności, żeby zmieścić
oba naraz.
