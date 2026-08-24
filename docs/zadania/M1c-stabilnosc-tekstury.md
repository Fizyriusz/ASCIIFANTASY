# M1c — Stabilność tekstury przy ruchu

**Cel:** usunąć aliasing tekstury u źródła, zamiast tłumić go obniżaniem `roughness`
w danych. Po tym zadaniu daleka powierzchnia jest spokojna, **a bliska zachowuje pełną
fakturę** — co jest warunkiem, żeby ściany lochu w M2 nie wyglądały jak gładkie płyty.

To zadanie zamyka wątek ciągnący się przez cztery rundy poprawek w M1. Wszystkie
dotychczasowe obejścia siedziały w danych, bo zlecenie M1 zabraniało ruszać renderer.
Tutaj to zdejmujemy — z jawną zgodą na diff zamrożonych wzorców.

Przeczytaj wcześniej: `CLAUDE.md`, `docs/architektura.md` §3.2, raport z M1 i wątek
o migotaniu.

---

## Kontekst: dlaczego dotychczasowe poprawki nie były rozwiązaniem

W raporcie z M1 pojawiło się rozumowanie: „przy `roughness = 0` migotanie znika, więc
kwantyzacja pozycji nie jest wąskim gardłem". **To ma skrót logiczny.** Kwantyzacja
i `roughness` nie są dwiema niezależnymi przyczynami — to ten sam kanał. Hash decyduje,
który glif, `roughness` decyduje, jak mocno hash wpływa na wybór. Ustawienie `roughness`
na zero nie testuje kwantyzacji, tylko wyłącza teksturę. Aliasing znika, bo nie ma czego
aliasować.

Poprawka była legalna i tania, ale ma cenę: daleka trawa jest spokojna, **ponieważ jest
jednorodna**. Cena zostanie zapłacona w M2, gdzie ściana lochu stoi metr od oka i to
właśnie `roughness` daje jej strukturę.

Właściwe rozwiązanie to jedyny odpowiednik mipmapy dostępny w rendererze znakowym:
**tekstura zbiegająca z odległością do jednego, deterministycznego glifu**. Nie da się
uśrednić glifów — nie istnieje „pół `#` i pół `.`", a siatka znaków jest buforem ramki,
więc nie ma czego nadpróbkować.

---

## Zakres

### Wolno dotykać
```
packages/core/src/materials.ts      ← kwantyzacja i roughness zależne od odległości
packages/core/src/raymarch.ts       ← przekazanie rzutowanego rozmiaru komórki
packages/content/src/packs/wild/    ← przywrócenie pełnej faktury
packages/content/src/packs/neon/    ← to samo, dla spójności
tools/harness/src/*.test.ts         ← metryka ważona
tools/harness/golden/*.txt          ← WSZYSTKIE wzorce, łącznie z M0
```

### Nie dotykać
`terrain.ts`, `hydro.ts`, `biome.ts`, `chunk.ts`, `streaming.ts` — generacja świata
jest zamknięta. To zadanie dotyczy wyłącznie tego, jak powierzchnia jest rysowana.

### Zgoda na diff wzorców

**Wszystkie złote pliki się przesuną, łącznie z sześcioma z M0 i `neon-city`.**
To jest zamierzone i zaakceptowane z góry. Bajtowa niezmienność wzorców M0 kończy się
w tym commicie i ma to być napisane wprost w wiadomości commita, razem z powodem.

Wymóg: **obejrzyj każdy przesunięty wzorzec przed przyjęciem** i w podsumowaniu opisz,
co zmieniło się wizualnie w każdym z nich. Snapshot przyjęty bez obejrzenia jest gorszy
niż brak snapshotu.

---

## Co ma powstać

### 1. Kwantyzacja hasha zależna od odległości

Dziś krok siatki hasha jest stały (0,25 m). Przy powierzchni oddalonej o 50 m jedna
komórka ekranu pokrywa dziesiątki metrów terenu, więc punkt próbkowania przeskakuje
przy ruchu przez setki kratek i glif losuje się od nowa co klatkę.

Krok ma odpowiadać **rzutowanemu rozmiarowi komórki**, zaokrąglonemu do potęg dwójki:

```
step = 2^ceil(log2(footprint))
```

Wtedy jedna komórka ekranu odpytuje mniej więcej jedną kratkę hasha, a zmiany zachodzą
tylko przy przejściu między poziomami — jak granice mipmap, i tak samo niewidoczne,
jeśli przejścia są rzadkie.

`raymarch.ts` musi przekazać `footprint` do `materialGlyph`. To jedyna zmiana w marszu.

### 2. `roughness` gasnący z odległością

```
effectiveRoughness = mat.roughness * falloff(distance)
```

Blisko: pełna wartość z paczki contentu. Daleko: zbieganie do zera, czyli do jednego
glifu podstawowego. Próg dobierz pomiarem, nie na oko — zacznij od odległości, przy
której rzutowana komórka przekracza ~2 m.

### 3. Przywrócenie faktury w danych

`roughness` w paczce `wild` został zbity do 0,15–0,2 jako obejście. Przywróć wartości
oddające materiał (kora szorstka, woda gładka, kamień pośrodku) i pozwól, żeby wygaszanie
odległością robiło robotę. **Efekt sprawdzasz metryką, nie deklaracją.**

### 4. Metryka ważona wagą glifu

Obecny strażnik liczy, ile komórek zmieniło znak. Oko reaguje na **wagę wizualną**:
sto komórek przechodzących z `%` na `"` jest niewidoczne, dziesięć kęp `W` mrugających
na łące wygląda jak stroboskop. Stąd rozjazd między raportem (13,6% → 4,3%) a tym,
co widać na ekranie — czyli brakiem odczuwalnej poprawy.

Przypisz każdemu glifowi **pokrycie atramentem** (0..1, np. z tabeli: spacja 0,
`.` ≈ 0,05, `W` ≈ 0,7) i waż zmianę różnicą pokrycia. Tabela idzie do contentu jako
dane, nie do kodu.

Zachowaj starą metrykę obok nowej — chcemy widzieć obie i wiedzieć, kiedy się rozjeżdżają.

---

## Definicja ukończenia

1. `pnpm typecheck`, `pnpm test`, `pnpm test:snap`, `pnpm bench` — zielone.
2. **Metryka ważona** przy kroku 0,05 m do przodu, na wszystkich pięciu scenach
   pustkowia: wynik lepszy niż stan obecny mimo przywróconego `roughness`.
   Podaj tabelę: przed / po, obie metryki.
3. **Test faktury bliskiej**: powierzchnia w odległości 2 m ma mieć co najmniej tyle
   różnych glifów, ile miała przed obejściem z M1. To jest zabezpieczenie przed
   „naprawą przez wygładzenie wszystkiego".
4. **Test przejścia poziomów**: kamera cofająca się o 20 m małymi krokami — zmiana
   przy przekroczeniu progu potęgi dwójki nie może dać piku wyższego niż zwykły krok.
5. Budżet: `renderWorld` bez wzrostu powyżej 10% względem obecnych 0,89 ms.
6. Wszystkie przesunięte wzorce obejrzane i opisane, po jednym zdaniu na plik.
7. `pnpm dev`: przejdź się łąką przód-tył. To jedyny test, który rozstrzyga —
   opisz, czy pas pod horyzontem nadal migocze.
8. Podsumowanie w formacie z `CLAUDE.md`.

---

## Pułapki

1. **Naprawa przez wygładzenie wszystkiego** — jeśli po tym zadaniu bliska ściana
   nie ma faktury, cel nie został osiągnięty, choćby metryka świeciła zielono.
   Punkt 3 DoD jest właśnie po to.
2. **`footprint` liczony z odległości euklidesowej** zamiast z rzutowanego rozmiaru
   komórki — daje inny wynik dla powierzchni poziomych i pionowych, a to właśnie
   grunt pod horyzontem jest problemem.
3. **Ciągła zmiana kroku zamiast potęg dwójki** — tekstura „oddycha" przy ruchu,
   co jest gorsze niż rzadkie przeskoki między poziomami.
4. **Tabela pokrycia atramentem wpisana w kod** — to dane materiałowe, miejsce
   w `content`.
5. **Przyjęcie 40 przesuniętych wzorców bez obejrzenia.** Przy tak dużym diffie
   łatwo przepuścić realną regresję w scenie, o której się nie myśli — na przykład
   w `neon-city`.
