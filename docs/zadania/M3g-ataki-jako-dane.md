# M3g — Ataki jako dane

**Cel:** dziś każdy byt ma **jeden** zamach, bo klatka `windup` jest polem w definicji
stworzenia. Mag, łucznik i mieczownik dostają ten sam ruch. Wilk potrafi tylko gryźć
tak samo, jak goblin macha maczugą.

Po tym zadaniu **atak jest osobną daną**, a byt ma ich zestaw: wilk gryzie albo uderza
łapą, niedźwiedź staje na tylnych łapach, mieczownik tnie inaczej niż włócznik pcha.
Jeden szkielet klatek obsługuje wszystkich, a dodanie łuku to dodanie **ataku**,
nie przerysowanie stworzenia.

**Warunek wstępny:** M3f (sprzężenie własnych akcji) i M3c (bryła stworzeń) zamknięte.
M3c ustala liczbę kierunków i rozmiary siatek — rysowanie trzech ataków przed tą
decyzją znaczy przerysowanie ich wszystkich razy trzy.

Przeczytaj wcześniej: `CLAUDE.md`, `docs/architektura.md` §3.4, §6, zlecenia M3b, M3c, M3f.

---

## Dlaczego to nie jest kosmetyka

Mechanika już wie, że atak ma własne czasy: reguła `windupMs ≥ 350` z M3b jest
przypisana do **broni**, a klatka zamachu do **stworzenia**. Czyli czas należy do
czynności, a kształt do bytu — i to jest ten rozjazd, który trzeba usunąć.

Ale samo dorysowanie trzech różnych zamachów byłoby ozdobą. **Wariant ataku ma nieść
informację**, inaczej jest szumem: gracz uczy się rozpoznawać telegraf tylko wtedy,
gdy z rozpoznania coś wynika.

> **Reguła projektowa:** każdy atak bytu musi różnić się od pozostałych **co najmniej
> jedną rzeczą, na którą gracz może zareagować**: zasięgiem (czy zdążę się cofnąć),
> czasem zamachu (czy zdążę zablokować), albo kierunkiem (w którą stronę uskoczyć).
> Atak, który wygląda inaczej, ale wymaga tej samej reakcji, ma zostać scalony
> z tamtym — jest tańszy jako jeden rysunek.

To jest kryterium akceptacji dla każdego nowego ataku, także tych dodanych w przyszłości.

---

## Rozstrzygnięcie: kierunek cięcia jest automatyczny

**Nie robimy walki kierunkowej w stylu Mount & Blade.** To jest inny, dużo większy
projekt i inna gra — osobne wejście na każdy kierunek zmienia całą pętlę walki,
a razem z nią naukę gry, interfejs i AI.

Kierunek cięcia **wynika z sytuacji**, nie z osobnego przycisku:

- **cięcie w bok** — jeden cel w zasięgu,
- **cięcie szerokie** — kilka celów w łuku,
- **pchnięcie** — cel na granicy zasięgu.

Animacja niesie informację o tym, co robi postać, ale **nie dokłada graczowi klawiszy**.
To jest ta sama zasada, co przy telegrafie z M3b: obraz ma mówić, co się dzieje,
a nie żądać dodatkowej decyzji.

Powód, dla którego to jest tutaj, a nie w M3f: broń wjeżdżająca w kadr od dołu i znikająca
wygląda jak unoszący się przedmiot, bo nim jest — nie ma łuku ani kierunku. Kształt ruchu
per archetyp rozwiązuje to razem z resztą tego zlecenia.

---

## Zakres

### Wolno dotykać
```
packages/content/src/creatures.ts   ← zestawy ataków, klatki per atak
packages/content/src/items.ts       ← archetypy broni gracza
packages/content/src/combat.ts      ← czasy, zasięgi, koszty per atak
packages/rules/src/combat.ts        ← wybór ataku, czasy z ataku zamiast z broni
packages/rules/src/ai.ts            ← warunki wyboru
packages/core/src/sprites.ts        ← wyłącznie zmienne pudełko (§4)
packages/ui/                        ← nazwa ataku w linii zdarzeń
apps/game/src/entities.ts, main.ts
tools/harness/src/*.test.ts, *.bench.ts
tools/creature-editor/              ← sloty klatek per atak
docs/architektura.md                ← §3.4, §6
```

### Nie dotykać
`raymarch.ts`, `screen.ts`, `blit.ts`, `light.ts`, `materials.ts`, `packages/world`.
Wzór trafienia, wzór obrażeń i reguła celowania z M3f — bez zmian. Zmieniamy **to,
jakie ataki istnieją**, a nie sposób ich rozstrzygania.

---

## Co ma powstać

### 1. Atak jako dana

```ts
interface AttackMove {
  id: string;
  name: string;          // do linii zdarzeń: "kłami", "łapą", "z góry"
  windupMs: number;      // telegraf, nadal ≥ 350 dla bytów (reguła z M3b)
  strikeMs: number;
  recoverMs: number;
  reachM: number;
  staminaCost: number;
  damageMul: number;
  frames: { windup: FrameRef; strike: FrameRef };  // per kierunek, jak reszta
  boxOverride?: { heightM?: number; lengthM?: number };  // §4
  mirrorSide?: 'left' | 'right' | 'alternate';           // §5
}
```

Byt ma `attacks: AttackMove[]`. Klatki `idle`, `walk`, `hit` i `death` **zostają
wspólne** — tylko `windup` i `strike` są per atak. To jest cała różnica w koszcie
rysowania i warto ją utrzymać.

Czasy przenoszą się z broni do ataku. Broń nadal istnieje jako przedmiot i nadal
niesie obrażenia i wagę — ale to atak mówi, jak długo trwa zamach.

### 2. Zestawy startowe

Liczby są **punktem wyjścia do strojenia**, nie ustaleniem.

**Wilk** — dwa ataki różniące się zasięgiem i czasem, czyli reakcją:

| atak | zamach | zasięg | obrażenia | uwagi |
|---|---|---|---|---|
| kły | 380 ms | 1,0 m | ×1,0 | szybki, trzeba blokować |
| łapa | 520 ms | 1,4 m | ×0,8 | wolniejszy, ale sięga dalej — cofnięcie nie wystarczy |

`mirrorSide: 'alternate'` dla łapy: raz lewa, raz prawa. **Naprzemienność ma być
deterministyczna** (licznik w stanie byta, nie losowanie), bo inaczej powtórka
tej samej walki po wczytaniu zapisu wygląda inaczej. Rytm zwierzęcia, nie szum.

**Niedźwiedź** — dwa ataki różniące się czasem i groźbą:

| atak | zamach | zasięg | obrażenia | uwagi |
|---|---|---|---|---|
| zamach łapą | 480 ms | 1,6 m | ×1,0 | podstawowy |
| stanie na tylnych | 780 ms | 1,4 m | ×2,2 | długi telegraf, wysoka kara |

Stanie na tylnych łapach jest tanie w rysunku, bo to ten sam ruch co uniesienie broni
nad głowę — tylko podnosi się cały korpus zamiast rąk. Ale **zmienia pudełko** (§4).

**Goblin** — zostaje przy jednym ataku, dopóki nie znajdzie się drugi spełniający
regułę projektową. To jest przykład, że zestaw ataków ma być krótki i uzasadniony.

### 3. Archetypy broni gracza

M3f wprowadził broń wchodzącą w kadr od dołu. M3g nadaje jej **kształt ruchu
zależny od archetypu**:

- **cięcie** (miecz, topór) — łuk z góry, broń wchodzi z boku kadru,
- **pchnięcie** (włócznia, sztylet) — broń wchodzi wzdłuż osi patrzenia, krótki ruch,
  większy zasięg dla włóczni,
- **zamach ciężki** (maczuga, topór dwuręczny) — dłuższy telegraf, wyraźniejszy łuk.

Archetyp jest polem broni w `items.ts` i wskazuje na `AttackMove` gracza. Broni
przybywa przez dodanie wpisu, nie przez rysowanie nowej animacji.

**Łuk i magia: klatki tak, mechanika nie.** Pociski w locie, czas lotu i zaklęcia to
osobny system i nie mieszczą się w tym zleceniu. Jeśli narysujesz naciąganie cięciwy
i rzucanie, ma to zostać jako dane bez podpiętej mechaniki, wyraźnie oznaczone
w podsumowaniu jako nieużywane.

### 4. Pudełko zmienne w trakcie ataku

Niedźwiedź stojący na tylnych łapach **jest wyższy**. To nie jest szczegół graficzny:
od M3f trafienie wymaga, żeby kąt patrzenia mieścił się w sylwetce celu, więc zmiana
wysokości zmienia okno celowania. Stojący niedźwiedź ma być trafiany wyżej — i ma
sięgać wyżej, gdy sam uderza.

`boxOverride` obowiązuje przez czas trwania ataku (od `windup` do końca `strike`),
po czym pudełko wraca. Wymagania:

- przejście jest **skokowe, nie interpolowane** — sprite i tak przeskakuje między
  klatkami, a interpolacja pudełka bez interpolacji rysunku daje rozjazd trafień
  względem obrazu,
- kolizja ciał (z M3b) używa pudełka bieżącego, więc niedźwiedź na tylnych łapach
  zajmuje inne miejsce; sprawdź, czy nie da się go tym zablokować w korytarzu,
- siatka klatki `windup` dla takiego ataku może potrzebować **więcej wierszy**
  niż siatka bazowa — to jest dopuszczalne, ale musi być zadeklarowane.

### 5. Koszt rysowania i reguła współdzielenia

Dwa ataki po dwie klatki na cztery kierunki to **16 nowych siatek na stworzenie**,
a przy ośmiu kierunkach (wilk, §5 z M3c) — 32. To jest realny koszt każdego przyszłego
potwora i dlatego:

- atak może zadeklarować `frames: 'base'` i użyć wspólnego zamachu, jeśli jego różnica
  jest wyłącznie liczbowa (inny zasięg przy tym samym ruchu). Wtedy nie przechodzi
  jednak reguły projektowej z góry dokumentu, więc musi mieć uzasadnienie
  w podsumowaniu,
- lustro z M3c obowiązuje tak samo: `mirrorSide` produkuje drugą stronę odbiciem,
  chyba że byt ma flagę „nie odbijaj".

---

## Definicja ukończenia

1. `pnpm typecheck`, `pnpm test`, `pnpm test:snap`, `pnpm bench` — zielone.
2. **Test rozróżnialności telegrafów.** Dla każdego bytu, każda para jego ataków musi
   różnić się w klatce `windup` co najmniej **35% widocznych komórek sprite'a**,
   mierzone na 1,5 / 3 / 6 m i **wyłącznie w widocznej części kadru** (zasada z M3b:
   w zwarciu widać 18% sylwetki). Para poniżej progu oznacza, że ataki należy scalić
   albo przerysować — nie obniżyć próg.
3. **Test reguły projektowej.** Każda para ataków tego samego bytu różni się co najmniej
   jedną z trzech wielkości: `reachM` o ≥ 0,3 m, `windupMs` o ≥ 120 ms, albo kierunkiem
   (`mirrorSide`). Test wylicza to z danych, bez renderu.
4. **Determinizm naprzemienności.** Ta sama walka odtworzona z zapisu daje tę samą
   sekwencję ataków. Test: 200 starć z ustalonym seedem, dwa przebiegi, identyczne listy.
5. **Snapshoty:** `wolf-bite-windup`, `wolf-paw-windup`, `bear-swipe-windup`,
   `bear-rear-windup`, `bear-rear-box` (pudełko w trakcie stania), `player-slash`,
   `player-thrust`, `player-heavy`. Porównywane **między sobą**, nie tylko ze wzorcem.
6. **Metryki M3b i M3c przeliczone.** Telegraf, kontrast i zniekształcenie muszą nadal
   przechodzić dla wszystkich nowych klatek — nowy atak to nowy sprite i podlega
   tym samym progom.
7. **Budżet:** sprite'y i AI poniżej 0,3 ms przy 60 bytach; wybór ataku nie może
   dokładać alokacji w pętli.
8. **Weryfikacja w grze:** stanąć przed wilkiem i opisać, czy da się odróżnić kły
   od łapy **zanim** cios padnie, i czy z tej różnicy coś wynika.

---

## Czego świadomie NIE robimy

- pocisków, czasu lotu, zaklęć i całej mechaniki dystansowej,
- kombinacji ciosów, przerywania animacji, systemu postury,
- trafień w części ciała (odrzucone przy celowaniu w M3f),
- animacji ciała gracza innej niż broń (zasada z M3f),
- nowych stworzeń poza niedźwiedziem — pająk i reszta czekają.

---

## Pułapki

1. **Trzy ataki wyglądające tak samo.** Punkt 2 DoD istnieje dokładnie po to. Jeśli
   nie umiesz narysować dwóch wyraźnie różnych zamachów, to znaczy, że to jeden atak.
2. **Losowy wybór ataku.** Psuje determinizm zapisu i czyta się jak szum zamiast
   jak zachowanie zwierzęcia. Licznik albo warunek, nie `random`.
3. **Wariant, na który reakcja jest ta sama** — ozdoba udająca głębię. Reguła
   projektowa z góry dokumentu.
4. **`boxOverride` interpolowane** — obraz przeskakuje, pudełko płynie, trafienia
   rozjeżdżają się z tym, co widać.
5. **Zapomniana kolizja przy zmianie pudełka** — niedźwiedź na tylnych łapach
   w wąskim korytarzu.
6. **Czasy zostawione w broni** przy przeniesieniu do ataku — dwa źródła prawdy
   o długości zamachu, czyli ta sama klasa błędu co rozjazd `reachOf` z M3b.
7. **Klatki łuku i magii podpięte „na próbę"** — mechanika dystansowa jest wykluczona
   i podpięcie jej po cichu wyjdzie jako niedziałający atak.

---

## Warunek zatrzymania

Jeśli po **dwóch** próbach nie da się narysować dwóch ataków wilka tak, żeby przechodziły
próg 35% różnicy w zwarciu (gdzie widać tylko górę sylwetki) — przerwij i wróć z liczbami.
Możliwe, że w zwarciu telegraf musi żyć w innym miejscu niż na średnim dystansie,
a to jest decyzja projektowa, nie poprawka.
