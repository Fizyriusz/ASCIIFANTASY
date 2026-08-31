# M3c — Bryła stworzeń

**Cel:** stworzenia mają czytać się jako bryły w przestrzeni, a nie jako naklejki
obracające się razem z kamerą. Humanoidy (goblin, szkielet, troll) wyglądają dziś
poprawnie. Czworonogi i pająki — nie. Po tym zadaniu da się obejść wilka dookoła
i widzieć, że go obchodzisz.

**To nie jest zadanie o „prawdziwym 3D".** Bryłowe stworzenia w spanach są wprost
wykluczone — patrz §Czego świadomie NIE robimy.

Przeczytaj wcześniej: `CLAUDE.md`, `docs/architektura.md` §3.4, zlecenie M3b.

---

## Stan wejściowy: dlaczego wilk wygląda śmiesznie

Sprite ma dziś jedną `widthM` na stworzenie, niezależną od kąta patrzenia. Dla
humanoida to prawie nie boli, dla czworonoga boli bardzo.

Szerokość rzutu prostopadłościanu `|sin θ|·length + |cos θ|·width`, gdzie θ to kąt
między kamerą a zwrotem bytu:

| stworzenie | dł. × szer. | rzut przy 0° / 45° / 90° | zmiana |
|---|---|---|---|
| goblin, człowiek | 0,35 × 0,50 m | 0,50 / 0,60 / 0,35 | ×1,4 |
| troll | 0,60 × 0,90 m | 0,90 / 1,06 / 0,60 | ×1,5 |
| **wilk** | 1,40 × 0,45 m | 0,45 / 1,31 / 1,40 | **×3,1** |
| pająk | 1,10 × 1,10 m | 1,10 / 1,56 / 1,10 | ×1,0 |

Wilk oglądany z boku z sześciu metrów zajmuje dziś **8 kolumn zamiast 25**. Widać psa
wciśniętego w słupek — i żadna liczba kierunków tego nie naprawi, bo błąd jest
w szerokości, nie w kącie.

Tabela rozdziela też dwa problemy, które z zewnątrz wyglądają jak jeden:

- **wilk** — problem perspektywy, naprawia go §1,
- **pająk** — zmiana rzutu ×1,0, czyli perspektywa jest w porządku. Jego problem to
  rozdzielczość: osiem nóg nie mieści się w siatce 5×7. Naprawia go §2.

Do tego przy zwarciu (1,4 m) sprite zajmuje 67×54 komórek ekranu, a jest rysowany
z siatki 5×7 — **9,6-krotne powiększenie**. Każdy narysowany znak rozlewa się
na jedenaście kolumn.

---

## Zakres

### Wolno dotykać
```
packages/content/src/creatures.ts    ← pudełko, siatki per kierunek, nowy byt
packages/content/src/combat.ts       ← nic poza stałymi cieniowania, jeśli trzeba
packages/core/src/sprites.ts         ← rzut pudełka, cieniowanie, cień kontaktowy
apps/game/src/entities.ts            ← kąt bytu względem kamery
tools/harness/src/sprite*.test.ts, *.bench.ts
tools/creature-editor/               ← siatki per kierunek (narzędzie, nie gra)
docs/architektura.md                 ← §3.4
```

### Nie dotykać
`raymarch.ts`, `screen.ts`, `blit.ts`, `light.ts`, `materials.ts`, cała `packages/world`.
Model walki i reguły z `packages/rules` — bez zmian. To jest zadanie o tym, **jak byt
wygląda**, nie o tym, jak działa.

---

## Co ma powstać, w kolejności

### 1. Pudełko zamiast jednej szerokości

Definicja bytu dostaje `lengthM` (nos–ogon), `widthM` (bok–bok), `heightM`.
Szerokość na ekranie liczy się z kąta:

```
θ = kąt między kierunkiem patrzenia kamery a zwrotem bytu
apparentWidthM = |sin θ| · lengthM + |cos θ| · widthM
```

To jest dokładny rzut prostopadłościanu, więc obrót wokół bytu daje **ciągłą** zmianę
szerokości — czyli wrażenie bryły — mimo że sprite'ów jest dalej cztery.

Migracja: istniejące byty dostają `lengthM` równe dotychczasowej `widthM`, więc
humanoidy renderują się prawie bez zmian (dla goblina różnica ×1,4 rozłoży się
płynnie zamiast być stała).

### 2. Siatka źródłowa: większa i osobna per kierunek

Siatka źródłowa jest dziś **węższym gardłem niż rozdzielczość ekranu**, i jest to
najtańsza możliwa poprawa: próbkowanie najbliższego sąsiada działa per komórka ekranu,
więc siatka 11×15 renderuje się dokładnie tak samo szybko jak 5×7. Płacisz wyłącznie
czasem rysowania i pamięcią.

Dwie zmiany:

- **rozmiar siatki per kierunek.** Wilk z boku potrzebuje siatki szerokiej (np. 15×8),
  z przodu wąskiej (7×9). Dziś rozmiar jest jeden na stworzenie;
- **para siatek: bliska i daleka.** Bliska z detalem (pancerz, hełm, kształt broni),
  daleka z czystą sylwetką, przełączana progiem odległości. To jest ta sama zasada,
  co wygaszanie `roughness` w M1c: sama sylwetka z daleka czyta się lepiej niż
  downsampling detalu, bo downsampling produkuje szum.

Próg przełączenia dobierz pomiarem: kandydat to moment, w którym siatka bliska
przestaje być powiększana (dla 11×15 to około 8 m).

### 3. Cieniowanie walcowe

Objętość bez rysowania ani jednej nowej klatki. Korpus traktujemy jak walec: pozycja
komórki w poziomie sprite'a daje udawaną normalną, iloczyn skalarny z kierunkiem
światła daje jasność, ciemniejsza strona dostaje **lżejsze glify**, nie tylko ciemniejszy
kolor.

```
u = 2·(kolumna / szerokość) − 1        // −1 lewa krawędź, +1 prawa
n = (u, 0, sqrt(max(0, 1 − u²)))       // normalna walca
lum *= ambient + (1 − ambient) · max(0, dot(n, kierunekŚwiatła))
```

Źródło światła: słońce z pory doby na zewnątrz, pochodnia gracza pod ziemią. Pochodnia
stoi przy kamerze, więc daje jasny środek i ciemne brzegi — czytelny walec.

**To jest pilotaż techniki, która może później trafić do świata.** Analogiczny pomysł
dla terenu (glif dobierany z orientacji powierzchni, a nie tylko z jasności) jest
większą zmianą i dotyka zamrożonego `raymarch.ts`. Jeśli na sprite'ach zadziała, wróci
jako osobne zlecenie z tą wiedzą; jeśli nie zadziała, zaoszczędzimy tamtą rundę.

### 4. Cień kontaktowy

Sprite stoi dziś na gruncie, ale nie jest z nim związany wizualnie — stąd wrażenie
naklejki. Najtańsze lekarstwo to kilka ciemniejszych komórek gruntu pod bytem:
przyciemnienie istniejących glifów terenu w owalu o szerokości `apparentWidthM`,
bez żadnych nowych znaków.

Warunki: cień rysuje się tylko wtedy, gdy byt stoi na powierzchni (nie w locie, nie
w wodzie powyżej pasa), i skaluje się z odległością tak samo jak sprite.

### 5. Osiem kierunków — na końcu i tylko jeśli reszta trzyma budżet

Cztery kierunki po §1 dają już ciągłą zmianę szerokości, ale sylwetka nadal przeskakuje
co 90°. Osiem kierunków to usuwa, kosztem rysowania.

**Autoryzujesz pięć, trzy robisz lustrem**: przód, przód-lewy, lewy, tył-lewy, tył —
reszta z odbicia. Uwaga: lustro psuje byty asymetryczne (broń w prawej ręce), więc
definicja musi mieć flagę „nie odbijaj" i test, który pilnuje, że byt z taką flagą
ma wszystkie osiem narysowanych.

Jeśli po §1–§4 wilk czyta się dobrze, **napisz to i pomiń §5**. Czterdzieści klatek
na stworzenie zamiast dwudziestu ośmiu to realny koszt każdego przyszłego potwora.

### 6. Wilk jako przypadek testowy

Bez czworonoga nie ma czego weryfikować — dziś w repo jest wyłącznie goblin.
Dodaj jednego wilka: pudełko 1,40 × 0,45 × 0,90 m, siatki per kierunek, komplet klatek.
Rysunek zrób w `tools/creature-editor` (narzędzie wymaga rozszerzenia o rozmiar siatki
per kierunek — to zmiana w narzędziu, nie w grze).

---

## Definicja ukończenia

1. `pnpm typecheck`, `pnpm test`, `pnpm test:snap`, `pnpm bench` — zielone.
2. Snapshoty: `wolf-side`, `wolf-front`, `wolf-45deg`, `wolf-melee`,
   `sprite-cyl-shading` (to samo stworzenie z cieniowaniem i bez, dwa pliki),
   `sprite-contact-shadow`, `spider-detail` (jeśli pająk powstanie) oraz
   przesunięte snapshoty goblina — **opisane z diffem i powodem**.
3. **Tabela rzutu przed i po**: szerokość wilka na ekranie z 6 m przy 0°, 30°, 60°, 90°.
   Po zmianie ma odpowiadać rzutowi pudełka z dokładnością do zaokrąglenia.
4. **Metryki M3b przeliczone od nowa.** Większa siatka i cieniowanie zmieniają kontrast
   do tła i procent różnicy telegrafu — obie miary z M3b muszą zostać zmierzone
   ponownie i nadal przechodzić. Jeśli któraś spadnie poniżej progu, to jest regresja
   czytelności walki, a nie „inne warunki pomiaru".
5. **Budżet:** sprite'y i AI dalej poniżej 0,3 ms przy 60 bytach. Cieniowanie dokłada
   pracę na każdą zamalowaną komórkę sprite'a — zmierz osobno koszt §3.
6. **Weryfikacja w grze:** obejść wilka dookoła w otwartym terenie i napisać, czy
   czyta się jako bryła. Żaden test tego nie zastąpi.

---

## Czego świadomie NIE robimy

- **Bryłowych stworzeń w spanach.** Świat jest czystą funkcją seeda, a ruchome spany
  wstawiane co klatkę do marszu łamią ten model i kosztują na każdej kolumnie.
  Do tego z ośmiu metrów wilk to 12×9 komórek — dane wolumetryczne zostałyby
  wyrzucone przez próbkowanie. To jest płacenie architekturą za rozdzielczość,
  której nie widać.
- Wielu billboardów na byt (osobno korpus, osobno łeb) — rzut pudełka daje ten sam
  efekt taniej. Do rozważenia dopiero, gdyby §1 okazał się niewystarczający.
- Głębi oręża w klatce ataku — to nie architektura, tylko „narysuj dobrze klatkę",
  i wraca samo przy większej siatce z §2.
- Zmian w rendererze świata: glif z orientacji powierzchni, rozdzielenie barwy
  od jasności, tło komórki, wyższa rozdzielczość ekranu. Każde z nich to osobne
  zlecenie o innym profilu ryzyka; §3 jest pilotażem pierwszego z nich.

---

## Pułapki

1. **Znak kąta.** θ liczy się między zwrotem **bytu** a kierunkiem **kamery**; pomylenie
   znaku daje wilka, który zwęża się wtedy, kiedy powinien się rozszerzać. Test:
   szerokość rzutu jako funkcja kąta ma mieć maksimum przy 90°, nie przy 0°.
2. **Siatka bliska używana z daleka** — to jest dokładnie ten aliasing, który M1c
   usuwał w teksturach terenu. Detal z dużej siatki próbkowany do 6×5 komórek
   produkuje szum i migotanie przy ruchu.
3. **Cieniowanie podbijające luminancję powyżej 1** — `shade` przytnie do bieli.
   Cieniowanie ma tylko **odejmować** od strony przeciwnej do światła.
4. **Cieniowanie spychające komórki poniżej `minLum`** — ciemna strona walca zniknie
   całkiem i byt straci pół sylwetki. Ogranicz dolny zakres.
5. **Cień kontaktowy rysowany po sprite'cie** — zamaluje mu nogi. Idzie przed.
6. **Lustro na asymetrycznym bycie** — broń przeskakuje z ręki do ręki przy obrocie.
7. **Przeliczenie progów M3b „bo warunki się zmieniły"** — progi zostają, zmienia się
   to, co mierzą. Spadek poniżej progu to regresja do naprawienia, nie do zaakceptowania.

---

## Warunek zatrzymania

Jeśli po **dwóch** próbach cieniowanie walcowe (§3) nie daje się pogodzić z progiem
widoczności `minLum` albo psuje metrykę kontrastu z M3b — przerwij, zostaw §1, §2 i §4
(są niezależne) i wróć z liczbami. Cieniowanie jest najbardziej niepewnym punktem tego
zlecenia i jedynym, który można wyciąć bez utraty reszty.
