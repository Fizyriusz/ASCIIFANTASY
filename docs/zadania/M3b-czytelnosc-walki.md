# M3b — czytelność walki

**Cel:** walka z M3 rozstrzyga się poprawnie, ale nie da się jej **czytać**. Nie widać,
czy cios trafił, czy się oberwało, ani czy przeciwnik się zamierza. Bez sprzężenia
zwrotnego blok i unik są zgadywaniem, więc walka nie jest decyzją — jest klikaniem
z ładnym modelem pod spodem.

To jest zadanie na **dane i prezentację**. Systemy z M3 stoją i nie ruszamy ich
architektury: reguły zostają w `packages/rules`, sprite'y w `packages/core`, liczby
w `packages/content`.

**Kryterium odbioru (człowieka, nie testu):** mam przegrać walkę przez to, że
zaatakowałem w złym momencie — i mam wiedzieć, dlaczego przegrałem.

Przeczytaj wcześniej: `CLAUDE.md`, `docs/architektura.md` §3.4, §6, §7.

---

## Stan wejściowy (zmierzony, nie oszacowany)

Pomiar z `packages/content` na commicie `968b4e9`:

| broń | windup | recover | pełny cykl | koszt wytrzymałości |
|---|---|---|---|---|
| sztylet | 180 ms | 200 ms | 380 ms | 7 (7% puli gracza) |
| krótki miecz | 320 ms | 340 ms | 660 ms | 13 (13%) |
| maczuga | 460 ms | 520 ms | 980 ms | 19 (19%) |

**Okno reakcji na cios goblina = 460 ms** (goblin bije maczugą; okno to cały `windup`,
bo klatka `Attack` ustawia się w chwili rozpoczęcia zamachu). Ludzka reakcja na bodziec
wzrokowy to 200–300 ms, więc 460 ms wystarcza **pod warunkiem, że zamach widać**.
Dziś nie widać: klatki `Idle` i `Attack` różnią się dwoma znakami na 35
(`' |#| '` → `' |#|='` w dwóch wierszach), a przy próbkowaniu najbliższego sąsiada
z ośmiu metrów te dwie komórki potrafią zniknąć całkiem.

Wytrzymałość — bieżąca ekonomia:

| broń | ciosy bez przerwy | tyle sekund ciągłego ataku | bilans na cykl |
|---|---|---|---|
| sztylet | 56 | 21,3 s | −2% puli |
| krótki miecz | 24 | 15,8 s | −4% |
| maczuga | 16 | 15,7 s | −5% |

Starcie z jednym goblinem trwa 4–5 s. **Wytrzymałość nie wymusza dziś żadnego wyboru** —
przez całą walkę można atakować bez przerwy i nigdy nie dobić do zera. Unik kosztuje
16% puli, blok 1,6 punktu wytrzymałości za każdy punkt zatrzymanych obrażeń,
regeneracja 14/s stojąc i 4/s w bloku.

---

## Zakres

### Wolno dotykać
```
packages/content/src/creatures.ts   ← klatki, barwy, rozmiar grupy
packages/content/src/combat.ts      ← koszty i regeneracja wytrzymałości, czasy
packages/core/src/sprites.ts        ← wyłącznie po to, by sprite mógł mieć własny
                                      modyfikator barwy na kilka klatek (§2)
packages/rules/src/combat.ts        ← wyłącznie opóźnienie regeneracji (§4)
packages/ui/                        ← wskaźniki trafienia i stanu przeciwnika
apps/game/src/main.ts, entities.ts  ← klatki zdarzeń, drganie kadru, animacja
tools/harness/src/*.test.ts, *.bench.ts
docs/architektura.md                ← §3.4 i §6 po zmianach
```

### Nie dotykać
`raymarch.ts`, `screen.ts`, `blit.ts`, `light.ts`, cała `packages/world` poza niczym,
`save.ts`. Model walki (kolejność postaw, wzór trafienia, wzór obrażeń) zostaje —
zmieniamy **liczby i to, co widać**, nie reguły.

---

## Co ma powstać, w kolejności ważności

### 1. Telegraf ataku przeciwnika

**Ile ciała w ogóle widać** (pomiar: oko 1,7 m, stworzenie 1,5 m):

| dystans | widoczna sylwetka | szerokość na ekranie |
|---|---|---|
| 1,4 m — zasięg maczugi | 12 z 67 wierszy = **18%** | 54 kolumny |
| 2 m | 32% | |
| 3 m | 55% | |
| 4 m | 78% | |
| 8 m | 100% | |

W zwarciu widać **głowę i barki**. Nogi są poza dolną krawędzią kadru dokładnie wtedy,
kiedy telegraf ma znaczenie. (Goblin ma 1,4 m, czyli jest jeszcze odrobinę ciaśniej.)

Z tego wynikają trzy rzeczy i wszystkie są wiążące:

- **Telegraf musi mieścić się w górnym pasie sylwetki**: głowa, barki, ręce. „Szersza
  postawa" i cokolwiek zapisanego w nogach jest wykluczone. Kierunek jest jeden i wynika
  z geometrii: przy zwarciu górna krawędź sylwetki stoi tuż pod horyzontem, więc
  **wzrost obrysu w górę zawsze mieści się w kadrze** — ręce nad głowę, broń uniesiona,
  głowa odchylona.
- **Progi mierzymy na 1,5 / 3 / 6 m.** Przy 16 m telegraf jest nieistotny, bo przeciwnik
  i tak nie dosięgnie; tam liczy się widoczność z §3.
- **Procent różniących się komórek liczymy wyłącznie w widocznej części kadru**, nie
  w całym sprite'cie. Różnica zapisana w wierszach, które są poza ekranem, nie istnieje.

**Miara.** Nowy test: renderuj tego samego goblina w klatce `Idle` i `Attack` z 1,5 / 3
/ 6 m; policz komórki znakowe, które się różnią, jako procent komórek **widocznych**
zamalowanych przez sprite'a. Próg: **≥ 35% na każdej z trzech odległości** oraz obrys
wyższy o co najmniej jeden wiersz na 1,5 i 3 m. Liczby przed zmianą podaj w raporcie —
mają pokazać, jak było.

**Zasada dla przyszłych potworów: `windupMs ≥ 350` dla każdej broni używanej przez byt
z `wildCreatures`, pilnowane testem.** Pola `telegraphMs` nie wprowadzamy: rozdzielałoby
animację od mechaniki, czyli pozwalałoby kłamać graczowi, a dziś nie ma stworzenia,
które by go potrzebowało. Szybki przeciwnik to inny projekt — skok z dystansu, a nie
krótszy tell.

W raporcie podaj wprost: ile milisekund ma gracz na reakcję przy każdej broni potwora
i ile z tego zostaje po odjęciu jednej klatki opóźnienia (16 ms przy 60 fps).

### 2. Potwierdzenie trafienia — w obie strony

**Trafiłem przeciwnika:** klatka `Hit` utrzymana przez 2–3 klatki animacji plus krótki
błysk — przesunięcie barwy sprite'a o pasmo w górę na ten sam czas. Byt ma już pole
`holdMs`, dziś nieużywane; to jest jego zastosowanie.

**Oberwałem:** krótkie przyciemnienie kadru albo drganie kamery, ≤ 150 ms.
**Drganie wolno nakładać wyłącznie na kierunek patrzenia użyty do rysowania**, nigdy
na `cam.yaw` — inaczej trafienie przesuwa celownik i psuje kolejny cios gracza.
To jest ta sama zasada, przez którą w M2c odrzucaliśmy wygładzanie myszy: nic, co
rusza celowaniem.

**Mój blok zadziałał** — osobny sygnał, nie brak sygnału. Bez niego nie wiadomo, czy
blok był dobrą decyzją, czy przeciwnik po prostu spudłował, a to są dwie różne lekcje.
Kierunek: rozbłysk na sylwetce przeciwnika w miejscu kontaktu albo krótka klatka
odbicia u niego, plus wpis w linii zdarzeń (§7).

**Chybienie ma wyglądać inaczej niż trafienie** — brak błysku, brak klatki `Hit`,
inny wpis w dzienniku. Dziś dziennik już to rozróżnia; chodzi o to, żeby rozróżniał
to również obraz.

**Miara.** Cztery snapshoty z tej samej sceny i tej samej klatki symulacji:
`combat-hit` (mój cios trafiony), `combat-blocked` (mój cios zablokowany przez
przeciwnika), `combat-miss` (pudło), `combat-player-blocked` (**mój** blok zatrzymał
cios). Każda para musi różnić się co najmniej 20 komórkami; test porównuje je między
sobą, nie tylko ze wzorcem.

**Osobno dla oberwania: snapshot nie nadaje się na miarę przyciemnienia kadru** —
przyciemnienie zmienia każdą komórkę, więc porównanie „różni się" niczego nie
rozróżnia. Mierz **spadek średniej luminancji kadru** (liczba, nie obraz), a snapshot
`combat-player-hurt` rób z klatki **po wygaśnięciu efektu** — sprawdza on wtedy to,
co naprawdę groźne: czy kadr wraca do stanu sprzed trafienia.

### 3. Widoczność sprite'a na tle biomu

Goblin ginie w trawie: ta sama zieleń, podobne pokrycie atramentem. Trzeba to najpierw
**zmierzyć**, a potem stroić — nie odwrotnie.

**Metryka kontrastu** (nowa, w `tools/harness`): dla każdej komórki zamalowanej przez
sprite'a policz różnicę wobec tej samej komórki w kadrze bez sprite'a — osobno
odległość barwy w przestrzeni po `pack15` i różnicę pokrycia atramentem
(`INK_COVERAGE` z contentu). Raportuj medianę i piąty percentyl na scenach: łąka,
las, wnętrze lochu, przy 4, 8 i 16 m.

**Dystanse są tu inne niż w §1 i mają takie zostać.** Telegraf mierzy się na 1,5/3/6 m,
bo tam przeciwnik dosięga i tam decyzja ma sens; kontrast mierzy się na 4/8/16 m, bo
odpowiada na inne pytanie — czy zauważysz goblina, **zanim** podejdzie. Ujednolicenie
tych dwóch zestawów zepsułoby obie miary naraz.

**Kolejność pracy:** zmierz stan obecny → dobierz cieplejszą paletę i cięższe glify →
zmierz ponownie → próg ustal z pomiaru (propozycja: mediana kontrastu barwy co najmniej
dwukrotnie wyższa niż dziś i piąty percentyl powyżej progu widoczności `minLum`).

**Uwaga na regułę z M1c.** „Glify jednego pasma mają mieć zbliżone pokrycie atramentem"
dotyczy **rampy jednego materiału** — tam różnica wagi czyta się jako migotanie.
Sprite kontra teren to inna oś: tu różnica wagi jest celem. Jeśli w trakcie pracy
te dwie rzeczy zaczną sobie przeczyć (np. cięższy glif sprite'a wywoła migotanie
przy ruchu), zatrzymaj się i opisz — patrz warunek zatrzymania.

### 4. Wytrzymałość widoczna w decyzji

Dziś nie jest zasobem, tylko licznikiem: 16–56 ciosów bez przerwy przy starciu
trwającym 4–5 s. Cel: **ciągły atak wyczerpuje pulę w 5–7 ciosach**, czyli w trakcie
jednego starcia, więc gracz musi wybrać moment.

Do wyboru (zdecyduj pomiarem, nie na oko):
- podnieść koszt ciosu,
- obniżyć regenerację,
- albo — sposób najbardziej klasyczny i najmniej karzący — **opóźnienie regeneracji
  po akcji**: nowa stała `staminaRegenDelayMs` w `COMBAT`, przez którą po zamachu,
  uniku i przebitym bloku wytrzymałość nie wraca wcale.

Trzecia opcja jest jedyną, która wymaga dotknięcia `packages/rules` — jedna gałąź
w `tickActor`. Jeśli wystarczą pierwsze dwie, tym lepiej.

**Miary:**
- test: ciągły atak każdą bronią kończy się brakiem wytrzymałości po 5–7 ciosach,
- test 10 000 starć nadal daje medianę w przedziale 2,5–15 s (nie wolno zepsuć
  tempa walki przy okazji),
- w raporcie: koszt ciosu, bloku i uniku jako **procent puli**, i ile sekund trwa
  odbudowa pełnej puli.

### 5. Groźba z liczby, nie z siły

Pojedynczy goblin zabiera 1 hp z 45 — i tak ma zostać. **Nie podnosimy obrażeń
pojedynczego przeciwnika.** Zamiast tego mierzymy, jak czyta się grupa.

**Pomiar:** 200 symulowanych starć dla 1, 2 i 3 goblinów naraz, przeciw graczowi
sterowanemu prostą, kompetentną heurystyką (atakuje w zasięgu, blokuje przy cudzym
zamachu, cofa się przy niskiej wytrzymałości). Raportuj odsetek wygranych i medianę
pozostałego hp.

**Strojenie idzie w liczebność**, nie w statystyki: rozmiar grupy przenieś do
`packages/content` (dziś `1 + hash % 3` siedzi w `apps/game/src/entities.ts` — to jest
liczba balansu w kodzie, czyli błąd wobec §Konwencje) i dobierz go tak, żeby trójka
była realnym zagrożeniem dla gracza, który się nie pilnuje.

### 6. Stan wyczerpania

Jeśli pula ma się kończyć po 5–7 ciosach (§4), to **moment jej wyczerpania jest
najważniejszą chwilą walki** — i musi być czytelny natychmiast, bez wpatrywania się
w pasek. Dziś jest odwrotnie: `beginAttack` przy pustej wytrzymałości zwraca `false`
i nie dzieje się **nic**, więc gracz czyta to jako zgubione kliknięcie, a nie jako
karę za własną decyzję.

Do zrobienia, w tej kolejności ważności:

1. **Odmowa akcji ma być widoczna w tej samej klatce**, w której padła. Kliknięcie,
   po którym nic się nie dzieje, jest gorsze niż kara — uczy nieufności do sterowania.
2. **Stan wyczerpania trwa, dopóki pula nie wróci powyżej progu** i przez ten czas ma
   być widoczny poza paskiem (kierunek do wyboru: zmiana pasma barwy wskaźników,
   inny glif wypełnienia paska, wpis trzymany w linii zdarzeń).
3. Próg powrotu podaj w `COMBAT` — wyjście z wyczerpania przy jednym punkcie
   wytrzymałości daje migotanie stanu przy każdej regeneracji.

**Miara** — ta sama co reszta, nie „na oko": snapshot `combat-exhausted` z klatki,
w której pula spadła do zera, i liczba komórek **poza wierszami paska**, które różnią
się od kadru z pełną wytrzymałością. Próg ustal z pomiaru, ale ma być większy od zera
i stabilny między klatkami.

### 7. Linia zdarzeń w buforze znaków

Kryterium odbioru brzmi „mam wiedzieć, **dlaczego** przegrałem". Telegraf i błysk dają
odczyt chwilowy — mówią, że coś się stało, nie mówią co. Odpowiedź na „dlaczego" niesie
tekst, a w medium bez dźwięku i bez cząsteczek tekst jest naturalnym kanałem sprzężenia
zwrotnego. Jest też zgodny z zasadą jednego bufora: to te same glify co świat.

- **dwie–trzy ostatnie linijki**, gasnące po około sekundzie (czas w contencie, nie
  w kodzie),
- treść nazywa **przyczynę**, a nie sam fakt: „trafiony w bok", „zablokowane",
  „brak wytrzymałości", „cios w odbiciu" — a nie „−4 hp",
- najstarsza linia gaśnie pierwsza; nowe zdarzenie nie kasuje poprzednich,
- to **nie** są unoszące się liczby obrażeń ani widżet: stała pozycja w kadrze, ten sam
  bufor, ta sama czcionka.

Punktem wyjścia jest istniejąca jednolinijkowa `logLine` w `apps/game/src/main.ts`
(dziś 3,5 s i jeden wpis). Rozbudowa idzie do `packages/ui` jako kolejny element
wzorca z `panel.ts`, a nie jako kod w pętli gry.

**Miara:** snapshot `combat-log` z trzema zdarzeniami w kolejce oraz test, że wpis
znika po zadanym czasie i że kolejka nigdy nie rośnie ponad trzy linie.

---

## Definicja ukończenia

1. `pnpm typecheck`, `pnpm test`, `pnpm test:snap`, `pnpm bench` — zielone.
2. Nowe snapshoty: `combat-telegraph-1.5m`, `combat-telegraph-3m`, `combat-telegraph-6m`,
   `combat-hit`, `combat-blocked`, `combat-miss`, `combat-player-blocked`,
   `combat-player-hurt` (klatka **po** wygaśnięciu efektu), `combat-exhausted`,
   `combat-log`. Zmienione snapshoty sprite'ów (paleta!) — **opisane z diffem i powodem**.
3. Raport zawiera pięć zestawów liczb, każdy **przed i po**: okno reakcji i procent
   różnicy telegrafu w widocznej części kadru, kontrast do tła w trzech biomach,
   ekonomia wytrzymałości, spadek średniej luminancji przy oberwaniu, skuteczność
   grupy 1/2/3.
4. Budżet klatki bez zmian: sprite'y i AI dalej poniżej 0,3 ms przy 60 bytach.
5. Historia podzielona na moduły: `content` → `core` → `rules` → `ui` → `apps` → `docs`.
6. **Weryfikacja w grze przez człowieka** — kryterium odbioru jest na górze tego pliku
   i nie zastępuje go żaden test.

---

## Czego świadomie NIE robimy

- pasków życia nad przeciwnikami (informacja ma iść z obrazu bytu, nie z widżetu),
- liczb obrażeń unoszących się w przestrzeni — linia zdarzeń z §7 jest czym innym:
  stała pozycja, nazwana przyczyna, ten sam bufor znaków,
- pola `telegraphMs` rozdzielającego animację od mechaniki (patrz §1),
- systemu efektów/cząsteczek — błysk to zmiana barwy istniejącego sprite'a,
- dźwięku (projekt nie ma warstwy audio i M3b jej nie zakłada),
- zmian w modelu walki: kolejność postaw, wzór trafienia i wzór obrażeń zostają.

---

## Pułapki

1. **Błysk przez podbicie luminancji powyżej 1** — `shade` przytnie do bieli i byt
   straci barwę, zamiast błysnąć. Przesuwaj pasmo barwy, nie jasność ponad zakres.
2. **Drganie kamery wpięte w `cam.yaw`** — psuje celowanie i wyjdzie dokładnie tam,
   gdzie boli, czyli przy kontrataku. Osobna wielkość do rysowania.
3. **Klatka `Attack` nadpisana przez animację chodu** — priorytet stanu nad ruchem
   już jest w `animate()`, ale `holdMs` musi go respektować.
4. **Strojenie kontrastu na oko** — cała §3 jest po to, żeby tego nie robić. Pomiar
   przed, pomiar po, próg z pomiaru.
5. **Podniesienie obrażeń goblina „bo tak szybciej"** — to jest wprost wykluczone
   w §5. Groźba wychodzi z liczebności.
6. **Zmiana palety potworów przy okazji zmieniająca złote pliki scen bez sprite'ów** —
   jeśli tak się stanie, coś jest źle: paleta bytów nie ma prawa dotykać terenu.
7. **Telegraf zapisany w nogach albo w szerokości postawy** — niewidoczny dokładnie
   w zwarciu, czyli tam, gdzie jest potrzebny (§1, tabela widoczności).
8. **Snapshot jako miara efektu obejmującego cały kadr** — przyciemnienie zmienia
   wszystko i przechodzi każdy test „różni się". Efekty globalne mierzy się liczbą.
9. **Linia zdarzeń w snapshotach walki** — wpisy gasną z czasem, więc każdy snapshot
   z tekstem zdarzenia musi mieć ustalony moment względem zdarzenia, inaczej złoty plik
   jest losowy.

---

## Warunek zatrzymania

Jeśli po **dwóch** próbach metryka kontrastu (§3) i reguła stabilności glifów z M1c
wykluczają się nawzajem — albo jeśli telegraf (§1) nie daje się odczytać przy 6 m
bez powiększenia sprite'a ponad realną wysokość bytu — przerwij i wróć z opisem:
co próbowałeś, jakie liczby wyszły, co się z czym wyklucza. Nie forsuj trzeciego
podejścia i nie obniżaj progu, żeby test przeszedł.
