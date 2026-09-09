# Wizja

**To nie jest zlecenie ani plan.** To jest kryterium odrzucania pomysłów: dokument, do
którego wracamy, gdy trzeba rozstrzygnąć, czy jakaś mechanika pasuje do tej gry. Nie ma
tu terminów ani zakresu — te są w `docs/zadania/`. Nie ma tu też architektury — ta jest
w `docs/architektura.md`.

---

## Zasada naczelna

**Świat istnieje niezależnie od gracza, a gracz uczy się jego reguł, zamiast dostawać
instrukcję.**

Wszystko, co dokładamy, ma to wzmacniać albo odpaść. Test na pomysł jest jednym pytaniem:
czy ta mechanika sprawia, że świat działa bardziej **sam z siebie** i że gracz dowiaduje
się o nim **z obserwacji**? Jeśli odpowiedzią jest „nie, ale jest wygodna" — odpada.

Dwie konsekwencje, które łatwo przeoczyć:

- **Znacznik na mapie to nie jest udogodnienie, tylko odebranie graczowi nauki.** Jeśli
  gracz nie umie trafić do celu, brakuje wskazówki w świecie, a nie strzałki na ekranie.
- **Informacja ma iść z obrazu i z zachowania świata**, nie z widżetu obok. Ta zasada
  jest już wdrożona w walce (telegraf zamiast paska życia, dziennik nazywający przyczynę)
  i to jest wzorzec dla wszystkiego, co przyjdzie później.

---

## Inspiracje i co z nich bierzemy

Fragmenty, nie całość. Z każdej gry bierzemy **jedną rzecz**, a nie jej gatunek.

**Dwarf Fortress** — rzeczy dzieją się bez gracza. Historia powstaje z symulacji, a nie
z napisanego tekstu. Nie bierzemy: głębi symulacji na poziomie kończyn i nastrojów.

**Morrowind** — brak prowadzenia za rękę. Kierunek to zdanie w dialogu („idź na północ,
za mostem w lewo"), a nie znacznik na mapie. Nie bierzemy: ręcznie stawianego świata.

**Daggerfall** — skala. Świat większy niż jakakolwiek opowieść, która się w nim toczy.
Nie bierzemy: pustki, która z tej skali w Daggerfallu wynikła.

**Witch Hat Atelier** — wiedza jako progres i rysowanie jako **umiejętność gracza**, a nie
statystyka postaci. Prototyp jest w `tools/grimoire/`: kształt decyduje, co zaklęcie robi,
pomiar — jak dobrze, glif — jaki żywioł. Postać, która nie zna znaku, rysuje martwy
atrament: kosztuje, ale nie działa. Nie bierzemy: listy zaklęć do odblokowania.

**Overgeared** — reputacja: świat zaczyna wiedzieć, kim jesteś. Nie bierzemy: skali
potęgi, w której gracz przerasta świat.

### Relacje i sprawczość NPC

Z Overgeared bierzemy nie tylko reputację, ale też to, że **NPC mają własne pragnienia,
potrzeby i plany i sami wpływają na świat**. Gracz jest jednym ze sprawców, nie jedynym.

To nie jest ozdoba, tylko warunek zasady naczelnej: bez cudzych ambicji plotka może
donosić wyłącznie o graczu, a wtedy świat nie istnieje niezależnie — tylko reaguje.

Dwa ograniczenia zapisane od razu, bo później będą drogie:

1. **Pragnienie NPC ma wynikać z tego samego modelu, co reszta świata**, a nie być
   osobnym systemem obok harmonogramów i ekonomii. Kupiec chce zysku, bo osada ma niskie
   zapasy — jedno napędza drugie za darmo. Dwie równoległe symulacje trzeba potem godzić
   i to jest praca bez końca.

2. **To zderza się z leniwymi harmonogramami z M4.** Stan NPC miał być czystą funkcją
   `(harmonogram, zegar)`, a NPC realizujący własny plan **ma stan**, którego z zegara nie
   da się wyliczyć. Rozwiązanie idzie tą samą drogą, co zwłoki i zabite byty: **plan jest
   deltą, nie nowym rodzajem bytu w pamięci.** Harmonogram zostaje domyślnym zachowaniem,
   plan jest nadpisaniem.

**Determinizm obowiązuje tak samo jak wszędzie**: cały system ma być odtwarzalny z seeda
i delt. Konkretny model do określenia — Filip wchodzi w materiały o worldbuildingu.

---

## Fabuła: kręgosłup, nie fabuła

Trzy–cztery ręcznie napisane wątki, każdy 2–3 zadania, każdy kończący się **trwałą zmianą
w świecie**. Pełna swoboda ignorowania: da się przejść obok i nie zauważyć.

Reszta pochodzi z generatora, z plotek i z tego, co gracz znajdzie po drodze. Kręgosłup
ma nadawać światu kierunek, a nie prowadzić przez niego korytarzem.

---

## Ryzyko projektu

**To jest ważniejsze od reszty tego dokumentu.**

Z pięciu inspiracji wyżej **tylko jedna ma autora, który skończył**. Cztery pozostałe to
projekty bez końca albo projekty, które skończyły się czym innym, niż się zaczęły. To nie
jest anegdota — to jest opis pułapki, w którą ten projekt wchodzi z definicji: symulacja
zawsze da się pogłębić i zawsze będzie kusiła bardziej niż domknięcie.

Dlatego **każdy element ma mieć wersję minimalną, działającą samodzielnie, zanim dostanie
rozbudowaną**:

| element | wersja minimalna |
|---|---|
| plotki | trzy typy wiadomości między dwiema osadami |
| wpływ na świat | jedna oś stanu na region |
| reputacja | jedna liczba i trzy progi |
| pragnienia NPC | jedno pragnienie na NPC, trzy typy, realizowane albo porzucane w skali doby |

**Rozbudowa zawsze później, nigdy jako warunek wydania.** Element, który nie działa
w wersji minimalnej, nie zadziała też w rozbudowanej — będzie tylko trudniejszy do
zdiagnozowania.

---

## Jak używać tego dokumentu

Pomysł przechodzi, jeśli:

1. wzmacnia zasadę naczelną (świat sam z siebie, gracz uczy się z obserwacji),
2. ma wersję minimalną, którą da się skończyć i zobaczyć w grze,
3. nie wymaga drugiej symulacji obok istniejącej,
4. da się odtworzyć z seeda i delt.

Pomysł, który spełnia 1 i 2, ale nie 3 albo 4, nie jest odrzucony — jest **odłożony do
czasu, aż ktoś pokaże, jak go zmieścić w modelu**. Ta różnica ma znaczenie: `decyzje.md`
zbiera warianty odrzucone razem z powodem, i to tam trafia rozstrzygnięcie, a nie tutaj.
