# M3e — cykl życia bytów

**Cel:** świat ma rodzić byty przez całą partię, a nie przez pierwsze osiem kilometrów.
Dziś po dobiciu do sufitu listy rozmnażanie **umiera globalnie i na stałe**: nowe klastry
nie wystawiają nikogo nigdzie, do końca sesji.

To nie jest zadanie o gęstości potworów ani o balansie. To jest zadanie o **cyklu życia**:
kiedy byt powstaje, kiedy przestaje istnieć i co po nim zostaje. Determinizm świata jest
tu warunkiem brzegowym, a nie miłym dodatkiem — patrz §4.

Przeczytaj wcześniej: `CLAUDE.md` §Siedem zasad (1, 2, 3), `docs/architektura.md` §2.3,
§3.3a, §10.6, zlecenie M3d.

---

## Stan wejściowy (pomiar z M3d)

Model: gracz biegnie po prostej, chunki strumieniują się jak w grze, `spawnAround`
wołane co sekundę.

| po ilu km | bytów w pierścieniu 48 komórek | bytów na całej liście |
|---|---|---|
| 1,3 km (5 min) | **0** | 30 |
| 7,9 km (30 min) | **0** | 64 — sufit `MAX_BEINGS` |
| 31,7 km (120 min) | **0** | 64 |

Trzy niezależne przyczyny, każda wystarczająca sama z siebie:

1. **Sufit liczony na całą partię.** `MAX_BEINGS = 64` dotyczy listy, nie okolicy.
   Po jego dobiciu `spawnCluster` wychodzi natychmiast, więc świat przestaje rodzić
   byty **wszędzie**, nie tylko tam, gdzie jest tłok. To jest globalna śmierć spawnu
   i najpoważniejsza z trzech.
2. **Byt nigdy nie jest zwalniany.** Goblin, którego gracz minął trzydzieści kilometrów
   temu, nadal zajmuje miejsce na liście, jest tickowany przez AI i liczy się do sufitu.
3. **Klaster rozpatrzony nie wraca.** `seen` rośnie monotonicznie, więc powrót w to samo
   miejsce po godzinie zastaje pustkę — nawet gdyby sufit był wolny.

Osobno, czwarta przyczyna, **inna w naturze**: `spawnCluster` szuka gruntu pod pułapem
`pz + 3`, gdzie `pz` to wysokość gracza. Kandydat na wzgórzu wyżej niż trzy metry nad
graczem nie ma pod tym pułapem żadnej czapki i wypada — a klaster zostaje oznaczony jako
rozpatrzony, więc przepada **na stałe**. W pierścieniu startowym odrzucał 1 z 6
kandydatów. Pułap wszedł w M3 po to, żeby byty nie lądowały na łące **nad** lochem;
od M3d podziemia mają własną ścieżkę (§3.3a architektury), więc na powierzchni ten pułap
nie ma już czego pilnować.

---

## Zakres

### Wolno dotykać
```
apps/game/src/entities.ts       ← cykl życia: powstawanie, zwalnianie, sufit
apps/game/src/main.ts           ← wołanie cyklu, HUD
packages/world/src/save.ts      ← delty bytów, SAVE_VERSION
packages/content/src/creatures.ts ← promienie i sufity, jeśli mają być danymi
tools/harness/src/*.test.ts, *.bench.ts
docs/architektura.md
```

### Nie dotykać
`dungeon.ts` (zawartość lochu jest z M3d i działa), `chunk.ts`, `terrain.ts`, renderer,
`packages/rules`. Zmieniamy **kiedy byt istnieje**, nie to, czym jest ani jak walczy.

---

## Co ma powstać

### 1. Sufit na pierścień, nie na partię

Limit dotyczy bytów **zainstancjonowanych w promieniu wokół gracza**. Poza promieniem
bytów nie ma wcale, więc nie ma czego liczyć. Liczby (promień instancjonowania, sufit
w pierścieniu, histereza promienia zwalniania) idą do `packages/content` — to są liczby
odczucia i wydajności naraz.

Punkt wyjścia do strojenia, nie wyrocznia: promień instancjonowania ≈ pierścień klastrów
z M3 (48 komórek), promień zwalniania większy o połowę (histereza, żeby byt na granicy
nie migotał), sufit w pierścieniu 24.

### 2. Zwalnianie bytu poza promieniem — z deltą

Byt oddalony ponad promień zwalniania znika z listy. **To, co po nim zostaje, zależy od
tego, czy gracz go zmienił:**

- byt **nietknięty** (pełne hp, nigdy nie widział gracza) — nie zostaje nic; przy powrocie
  odtworzy się z hasza taki sam,
- byt **zabity** — zostaje delta „to pochodzenie jest puste"; zabity zostaje zabity,
- byt **ranny albo przesunięty** — zostaje delta z hp i pozycją.

To jest ta sama zasada, co przy świecie: seed plus nadpisania. Delty bytów idą do zapisu
(nowe pole, `SAVE_VERSION` w górę) i podlegają temu samemu budżetowi 2 MB — zmierz, ile
waży delta bytu i ile ich powstaje na godzinę gry.

**Decyzja do podjęcia w tym zadaniu, nie przede mną:** czy byt, którego gracz widział
i zostawił nietkniętego, ma **czekać** (delta z pozycją, w której go zostawiono), czy
**zniknąć** (odtworzy się w miejscu z hasza). Rekomendacja: znika, bo inaczej każde
minięcie potwora zostawia wpis w zapisie, a gracz przechodzi obok setek bytów. Ale to
ma być rozstrzygnięte **pomiarem rozmiaru zapisu**, nie przekonaniem — policz oba
warianty po 200 h syntetycznej gry i wybierz.

### 3. Klaster wraca do puli

`seen` przestaje być zbiorem rosnącym. Zamiast „czy ten klaster był kiedykolwiek
rozpatrzony" pytamy „czy ten byt jest teraz zainstancjonowany albo ma deltę". Wtedy powrót
w to samo miejsce odtwarza tę samą zawartość, a przejście obok bez interakcji nie zostawia
śladu.

Uwaga na koszt: pytanie „czy powinienem tu kogoś postawić" biegnie dla wszystkich klastrów
w pierścieniu co klatkę. Dziś chroni przed tym `seen`. Po zmianie potrzebny jest inny
mechanizm — na przykład przeliczanie tylko przy zmianie klastra gracza. Zmierz.

### 4. Determinizm mimo zwalniania

**Dwa przejścia tą samą trasą muszą dać ten sam świat.** To jest warunek brzegowy całego
zadania i najłatwiejszy do złamania przy zwalnianiu bytów:

- pozycja i rodzaj bytu wynikają z `(seed, pochodzenie)`, nigdy z kolejności odwiedzin ani
  z licznika instancji,
- zwolnienie i ponowne powstanie bytu nietkniętego dają **ten sam** byt: to samo hp, ten
  sam rodzaj, ta sama pozycja startowa,
- byt zabity nie wraca, bo jego pochodzenie ma deltę,
- strumień losowy AI nie może wpływać na to, co powstaje — walka jest losowa, świat nie.

### 5. Warunek gruntu bez pułapu gracza

Na powierzchni pułap `pz + 3` znika: kandydat dostaje grunt ze swojej komórki. Podziemia
mają własną ścieżkę od M3d, więc pułap nie ma już czego chronić. Sprawdź w pomiarze, czy
po zdjęciu pułapu byty nie zaczynają powstawać na dachach i półkach skalnych, do których
gracz nie ma dojścia — jeśli tak, właściwym warunkiem jest **osiągalność**, a nie różnica
wysokości.

---

## Definicja ukończenia

1. `pnpm typecheck`, `pnpm test`, `pnpm test:snap`, `pnpm bench` — zielone.
2. **Kryterium odbioru:** po 30 km marszu liczba bytów w pierścieniu jest statystycznie
   taka sama jak po 1 km. Test mierzy w trzech punktach (1 km, 10 km, 30 km) i porównuje
   mediany z kilku tras; rozjazd większy niż ±40% oznacza, że zadanie nie jest zrobione.
3. **Test determinizmu trasy:** dwa przejścia tą samą trasą dają identyczną listę
   `(pochodzenie, rodzaj, pozycja startowa)`. Trzecie przejście po zabiciu jednego bytu
   różni się dokładnie o ten jeden byt.
4. **Budżet zapisu:** delty bytów po 200 h syntetycznej gry mieszczą się w limicie 2 MB
   razem z deltami komórek. Podaj obie liczby osobno.
5. **Budżet klatki:** koszt cyklu życia (zwalnianie plus pytanie o powstawanie) przy
   pełnym pierścieniu poniżej 0,3 ms — tyle, ile dziś kosztuje AI przy 60 bytach.
6. Weryfikacja w grze: przebiec kilka kilometrów, wrócić tą samą drogą i sprawdzić, że
   świat po drodze nadal ma mieszkańców, a zabity goblin nie ożył.
7. Historia podzielona na moduły: `content` → `world` → `apps` → `harness` → `docs`.

---

## Czego świadomie NIE robimy

- respawnu w czasie („po dwóch dniach gry obóz znowu stoi") — to jest symulacja z M4,
- wędrówek bytów poza pierścieniem: byt poza promieniem **nie istnieje**, a nie „chodzi
  sobie dalej",
- zapisywania bytów, których gracz nigdy nie widział,
- zmian w AI, walce i regułach.

---

## Pułapki

1. **Delta na każde minięcie.** Byt widziany i zostawiony to najczęstsze zdarzenie w grze;
   zapisywanie go zamienia zapis w dziennik podróży. Stąd pomiar w §2.
2. **Migotanie na granicy promienia.** Bez histerezy byt na krawędzi znika i wraca co
   klatkę, a razem z nim jego delta.
3. **Determinizm złamany kolejnością.** Instancjonowanie „w kolejności napotkania"
   z licznikiem w środku hasza daje inny świat przy powrocie z drugiej strony.
4. **Sufit pierścienia mylony z sufitem listy.** Jeśli zostanie jedno pole `MAX_BEINGS`
   używane w obu znaczeniach, wróci dokładnie ten błąd, od którego zaczyna się to zlecenie.
5. **Zdjęcie pułapu `pz + 3` bez sprawdzenia osiągalności** — byty na półkach skalnych,
   których nie da się dosięgnąć, są gorsze niż ich brak: gracz je widzi i próbuje dojść.
6. **Koszt pytania o powstawanie co klatkę** — patrz §3.

---

## Warunek zatrzymania

Jeśli po dwóch próbach nie da się pogodzić determinizmu (§4) z budżetem zapisu (§2) —
to znaczy, że delty bytów rosną szybciej, niż limit pozwala — przerwij i wróć z liczbami:
ile delt na godzinę, ile bajtów każda, przy którym wariancie. Nie podnoś limitu 2 MB
z `CLAUDE.md`, żeby zmieścić rozwiązanie.
