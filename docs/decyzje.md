# Decyzje odrzucone i dlaczego

Ten dokument istnieje po to, żeby za pół roku nie cofnąć dobrego wyboru. Zapisujemy
tu **warianty rozważone i odrzucone**, razem z argumentem i liczbą, jeśli była — bo
sama decyzja bez powodu wygląda po czasie na przypadek i kusi, żeby ją „poprawić".

Zasada: jeśli wpis nie ma liczby ani argumentu z repozytorium, jest oznaczony jako
**uzasadnienie poza repo**. To znaczy: powód istniał w rozmowie, ale nie został
zapisany — i przy następnym podejściu trzeba go odtworzyć albo zmierzyć od nowa,
a nie przyjąć na słowo tego dokumentu.

Format: **co odrzucone** → na rzecz czego → argument → liczba.

---

## Walka

### Walka kierunkowa w stylu Mount & Blade — M3g

**Na rzecz:** kierunek cięcia wynikający z sytuacji (cięcie w bok przy jednym celu,
szerokie przy kilku, pchnięcie na granicy zasięgu).

**Argument:** osobne wejście na każdy kierunek zmienia całą pętlę walki, a razem z nią
naukę gry, interfejs i AI — to inny, dużo większy projekt i inna gra. Animacja ma
nieść informację o tym, co robi postać, ale **nie dokładać graczowi klawiszy**. To ta
sama zasada, co przy telegrafie z M3b: obraz mówi, co się dzieje, zamiast żądać
dodatkowej decyzji.

**Liczba:** brak — to rozstrzygnięcie zakresu, nie pomiaru.
Źródło: `docs/zadania/M3g-ataki-jako-dane.md` §Rozstrzygnięcie.

### Jakość ciosu liczona od marginesu sukcesu — M3e

**Na rzecz:** jakości **wyśrodkowanej na szansie trafienia**
(`clamp(p + (0,5 − rzut), grazeDamage, 1)`).

**Argument:** pierwsza wersja liczyła jakość jako `grazeDamage + (1 − grazeDamage) ·
(p − rzut)/p`, czyli podłoga muśnięcia obowiązywała wszystkie nieudane rzuty i zjadała
różnicę między nowicjuszem a wprawnym. Umiejętność miała zostać tak samo ważna jak
w modelu z pudłem, tylko przenieść się z bramki na skalę.

**Liczby:** ostrze 10 → 80 dawało **+19%** średnich obrażeń w wersji odrzuconej wobec
**+43%** w przyjętej; dawny model z pudłem dawał +69% ciosów, które w ogóle dochodziły.
Źródło: `docs/architektura.md` §6, `packages/rules/src/combat.ts`.

### Rzut na trafienie jako bramka zamiast skali — M3e

**Na rzecz:** rzut decydujący o **sile** ciosu (od muśnięcia do czystego trafienia);
cios, który przeszedł geometrię i nie został zablokowany ani ominięty unikiem,
dochodzi zawsze.

**Argument:** jedynymi powodami zerowych obrażeń mają być powody, które gracz **widzi**
— blok, unik, brak zasięgu. Kości produkujące niewidzialne zera to ta sama klasa błędu
co ciche ciosy z M3b: gra reaguje na wejście gracza, ale nie zostawia niczego, co
dałoby się odczytać z ekranu. Losowe pudło przy nieruchomym celu jest mechaniką z gier
turowych i nie pasuje do walki z telegrafem, blokiem i unikiem na timing.

**Liczby:** przy poprawnym celowaniu rzut odpowiadał za **100% chybień**, czyli 47%
wszystkich ciosów w nieruchomego przeciwnika; szansa trafienia przy ostrzu 35 wynosiła
50,7%, a trzy pudła pod rząd zdarzały się w 11,9% serii. Po zmianie mediana starcia
z 10 000 pojedynków 5,3 s wobec 5,1 s przed zmianą, p95 11,7 s wobec 12,0 s — tempo
walki bez zmian.
Źródło: `docs/architektura.md` §6, `tools/harness/src/melee-miss.test.ts`.

### Unik jako premia do obrony — M3e

**Na rzecz:** unik jako **wyłącznie** okno nietykalności.

**Argument:** okno robiło dwie rzeczy naraz — dawało nietykalność i dokładało +0,45 do
obrony. Dwa mechanizmy na jeden efekt znaczą, że nie da się wyregulować żadnego z nich
osobno.

**Liczba:** premia dawała **96% chybień**, czyli i tak nietykalność, tylko wyliczoną
okrężnie.
Źródło: `docs/architektura.md` §6, `packages/content/src/combat.ts`.

### Margines celowania w stopniach — M3e

**Na rzecz:** margines w **metrach** (`aimMarginM` = 0,5 m nad głową i pod stopami),
liczony na dystansie celu.

**Argument:** ten sam kąt znaczy co innego z bliska niż z daleka, a walka wręcz dzieje
się właśnie z bliska. Goblin ma 1,4 m, oko gracza 1,7 m, więc w zwarciu cel jest zawsze
pod horyzontem.

**Liczby:** przy marginesie 8° pomiar stu ciosów dał **100% chybień „poza pionem"** przy
poziomym patrzeniu, na każdym z trzech dystansów broni (0,6 / 1,05 / 2,05 m). W metrach
te same pół metra daje okno do +18,4° / +10,8° / +5,6° i 100% trafień.
Źródło: `docs/architektura.md` §6.

### Pole `telegraphMs` rozdzielające animację od mechaniki — M3b

**Na rzecz:** `windupMs ≥ 350` dla każdej broni używanej przez byt z `wildCreatures`,
pilnowane testem.

**Argument:** osobny czas telegrafu pozwalałby **kłamać graczowi** — pokazywać zamach
innej długości niż ten, który rozstrzyga. Dziś nie ma stworzenia, które by tego
potrzebowało, a szybki przeciwnik to inny projekt: skok z dystansu, a nie krótszy tell.

**Liczba:** brak; próg 350 ms jest w regule, nie w pomiarze odrzucenia.
Źródło: `docs/zadania/M3b-czytelnosc-walki.md` §1 i §Czego świadomie nie robimy.

### Paski życia nad przeciwnikami i liczby obrażeń w przestrzeni — M3b

**Na rzecz:** informacja niesiona przez **obraz bytu** (klatka `Hit`, błysk, przygaszenie)
plus linia zdarzeń o stałej pozycji.

**Argument:** widżet nad głową jest osobnym językiem, którego świat nie mówi; linia
zdarzeń nazywa **przyczynę** („zablokowane", „brak zasięgu"), a nie sam fakt.

**Liczba:** brak.
Źródło: `docs/zadania/M3b-czytelnosc-walki.md` §Czego świadomie nie robimy.

---

## Stworzenia i sprite'y

### Bryłowe stworzenia w spanach — M3c

**Na rzecz:** billboard z rzutem pudełka (szerokość sprite'a liczona z obrysu bryły).

**Argument:** świat jest czystą funkcją seeda, a ruchome spany wstawiane co klatkę do
marszu kolumnowego łamią ten model i kosztują **na każdej kolumnie**. Do tego dane
wolumetryczne i tak zostałyby wyrzucone przez próbkowanie — to płacenie architekturą za
rozdzielczość, której nie widać.

**Liczba:** z ośmiu metrów wilk zajmuje **12×9 komórek** znakowych.
Źródło: `docs/zadania/M3c-bryla-stworzen.md` §Czego świadomie nie robimy.

### Osiem kierunków dla wszystkich stworzeń — M3c

**Na rzecz:** progu `lengthM / widthM < 1,5` — poniżej wystarczają cztery kierunki,
powyżej ósmy rysunek jest obowiązkowy.

**Argument:** ósmy kierunek kosztuje rysowanie (pięć autorskich klatek, trzy z lustra),
a dla bytów zwartych nie ma czego naprawiać: strefa rozciągnięcia w ogóle nie
występuje, bo próg z pudełka wypada powyżej 45°.

**Liczby:** dla wilka (`lengthM/widthM` = 3,1) zostaje strefa **10–18°**, w której
sprite przodu jest rozciągany **×1,7 do ×2,0**; dla goblina (0,7) i pająka (1,0) ta
strefa nie istnieje.
Źródło: `docs/zadania/M3c-bryla-stworzen.md` §5.

### Wiele billboardów na byt (osobno korpus, osobno łeb) — M3c

**Na rzecz:** jednego billboardu z rzutem pudełka.

**Argument:** rzut pudełka daje ten sam efekt taniej; wraca do rozważenia dopiero, gdyby
sam rzut okazał się niewystarczający.

**Liczba:** brak.
Źródło: `docs/zadania/M3c-bryla-stworzen.md` §Czego świadomie nie robimy.

### Trup jako byt zamiast rekordu — M3e

**Na rzecz:** zwłok jako osobnego rekordu (`Corpse`) rysowanego na gruncie: bez postawy,
AI i miejsca w kolizji.

**Argument:** trup jako byt zjada sufit pierścienia, więc kilkanaście ciał w jednym
miejscu zatrzymywałoby rodzenie nowych w okolicy — czyli wracałby w miniaturze błąd, od
którego zaczęło się M3e. Kolizji trup i tak nie zajmował (`occupied` pomija `Dead` od
M3b), więc bycie bytem nie dawało mu ani jednej używanej właściwości.

**Liczby:** sufit pierścienia to **24 byty** przy typowym zaludnieniu **9–10**; przemiar
szesnastu miejsc dał 4–15 bytów w pierścieniu.
Źródło: `docs/architektura.md` §2.3a.

### Zwłoki leżące wiecznie — M3e

**Na rzecz:** okna `CORPSE.minutes` = 540 minut zegara (3 minuty realne), po którym wpis
w zapisie wraca do samego pochodzenia.

**Argument:** delta świeżego trupa niesie pozycję upadku i czas śmierci, więc jest
trzykrotnie droższa od zwykłego „zabity"; wieczne zwłoki znaczą, że płacimy tę różnicę
za każde zabójstwo w partii, a nie za ciała widoczne w tej chwili.

**Liczby:** świeże zwłoki **43,2 B** wobec 14 B, pełny sufit ciał **518 B** (0,03%
limitu 2 MB); wariant wieczny kosztowałby **+348 kB** na 200 h gry.
Źródło: `docs/architektura.md` §2.3a, `packages/world/src/save.test.ts`.

---

## Renderer i świat

### Dwa fronty wypełniania zamiast maski pokrycia — M2c

**Na rzecz:** jednej ścieżki: maski pokrycia kolumny.

**Argument:** fronty opisują kolumnę dwiema liczbami, więc zakładają, że pokrycie jest
**spójne** — zamalowane od dołu i od góry, z jedną dziurą pośrodku. Świat z drzwiami,
oknami, koronami drzew i przęsłami mostów tego założenia nie spełnia, a każda próba
załatania kończyła się rozjazdem między frontami a maską i poprawianiem dwa razy.

**Liczby:** trzy rundy zgłoszeń z M2b (łaty nieba na koronach, fałszywy strop w niebie,
korona gasnąca nad pniem) okazały się **jednym błędem modelu w trzech przebraniach**.
Koszt przejścia na jedną ścieżkę: sceny pustkowia **+79–197%**, sceny miejskie
**+20–32%** czasu (pomiar w vitest; w przeglądarce około trzykrotnie mniej).
Źródło: `docs/architektura.md` §3.1, `docs/zadania/M2c-gorny-front.md`.

### LOD sylwetkowy — M1b (odrzucony pomiarem)

**Na rzecz:** braku LOD: jednej warstwy marszu kolumnowego na wszystkich dystansach.

**Argument:** zlecenie było **warunkowe** — miało ruszyć tylko wtedy, gdy zasięg dający
sensowny widok na pustkowiu nie mieści się w budżecie. Pomiar z M1 §7 pokazał, że się
mieści, więc druga warstwa marszu (i druga generacja terenu pod nią) byłaby złożonością
bez problemu do rozwiązania.

**Liczby:** przy zasięgu 400 m najgorsza z mierzonych scen (grzbiet z widokiem na
dolinę) kosztowała **3,81 ms** przy budżecie 8 ms — mniej niż połowa. Powód jest
strukturalny: kolumna kończy marsz, gdy fronty się spotkają, więc wydłużenie zasięgu
dokłada koszt tylko tam, gdzie niebo sięga nisko nad horyzont. Prawdziwy koszt zasięgu
siedzi gdzie indziej — w strumieniowaniu: pierścień o promieniu 4 to 81 chunków,
**313 ms** generacji rozłożonej na 81 klatek i około 18 MB pamięci.
Źródło: `docs/zadania/M1-teren-i-chunki.md` §7, `docs/zadania/M1b-lod-sylwetkowy.md`.

### Minimalne oświetlenie otoczenia w lochu — M2

**Na rzecz:** pory dnia i dostępu do nieba jako **mnożników**, nie składników — w lochu
bez źródła światła gracz widzi dosłownie nic poza najbliższymi komórkami.

**Argument:** „odrobina światła dla wygody" kasuje całą mechanikę eksploracji lochu:
pochodnia przestaje być decyzją, skradanie przestaje wynikać ze światła, a kryterium
odbioru M2 („bez światła jest naprawdę ciemno") przestaje być spełnialne. Jako składnik
`ambient` należałby do obserwatora, a nie do miejsca — jaskinia oglądana z zewnątrz
w południe byłaby jasna.

**Liczba:** przy porze dnia = 1 i dostępie do nieba = 15 wzór sprowadza się **bajt
w bajt** do wersji z M1 — dlatego złote pliki M0 i M1 przetrwały M2 bez zmiany.
Źródło: `docs/architektura.md` §3.3, `docs/zadania/M2-wnetrza-loch-swiatlo.md` §4,
`CLAUDE.md` §Kamienie milowe (kryterium M2).

### Oświetlenie dynamiczne rzucające cienie — M2

**Na rzecz:** liczenia **tłumienia** światła, nie geometrii cieni.

**Argument:** cienie wymagają drugiego przebiegu geometrii na każde źródło, a mechanika
(widoczność, skradanie) potrzebuje tylko jasności komórki.

**Liczba:** brak.
Źródło: `docs/zadania/M2-wnetrza-loch-swiatlo.md` §Czego świadomie nie robimy.

### Glify spoza ASCII 32–126 i półbloki — M2b

**Na rzecz:** rampy z drukowalnego ASCII, z tabelą pokrycia atramentem (`INK_COVERAGE`)
mierzoną dla znaków 32–126.

**Argument w repo:** alfabet jest zamknięty na łaciński i cyrylicę, bo blit zakłada
**jedną komórkę na znak**; znaki podwójnej szerokości rozjeżdżają siatkę i wymagałyby
komórek dwuszerokościowych w blicie i w każdej mierze układu — to osobny projekt, a nie
ustawienie.

**Liczba:** wariacja glifów w rampie ma iść w kształt, nie w ciężar — podmiana jednego
glifu o innej wadze (`&` 0,45 → `@` 0,62) zbiła metrykę migotania z **0,55 na 0,34**,
podczas gdy przemiatanie `roughness` koron nie ruszyło jej wcale.

**Uzasadnienie poza repo:** osobny argument przeciw **półblokom** (▀▄█) i ramkom
Unicode — czyli czemu nie używamy ich mimo stałej szerokości — nie jest w repozytorium
zapisany. Do odtworzenia przy pierwszym podejściu, które będzie chciało je wprowadzić.
Źródło: `CLAUDE.md` §Konwencje kodu, `docs/architektura.md` §10a.

---

## Zapis i cykl życia

### Sufit bytów liczony na całą partię — M3e

**Na rzecz:** sufitu liczonego **na pierścień wokół gracza** plus zwalniania bytów poza
promieniem.

**Argument:** globalny sufit oznaczał, że po jego dobiciu świat przestaje rodzić byty
**wszędzie i na stałe**, a nie tylko tam, gdzie jest tłok.

**Liczby:** przy `MAX_BEINGS = 64` pomiar dawał **0 bytów w pierścieniu** po 1,3, 7,9
i 31,7 km marszu. Po zmianie: mediana z trzech tras **9 / 10 / 8** bytów po 1, 10 i 30 km.
Źródło: `docs/architektura.md` §2.3a, `tools/harness/src/life.test.ts`.

### Zapisywanie bytów nietkniętych („byt widziany czeka") — M3e

**Na rzecz:** zapisywania wyłącznie odstępstw: zabity zostaje zabity, ranny wraca ranny,
nietknięty nie zostawia śladu i odtwarza się z hasza.

**Argument:** byt widziany i zostawiony to najczęstsze zdarzenie w grze; zapisywanie go
zamienia zapis w dziennik podróży.

**Liczby:** 12 000 delt bytów na 200 h to **348 kB**; przy jednej delcie na każdy
widziany byt limit 2 MB padłby w kilkanaście godzin gry.
Źródło: `docs/architektura.md` §2.3a, `docs/zadania/M3e-cykl-zycia-bytow.md` §2.

### Obiektowy format zapisu zamiast krotkowego — M3e i wcześniej

**Na rzecz:** krotek: span jako `[bottom, top, mat, capMat, flags]`, delta bytu jako
`[pochodzenie, …]`.

**Argument:** nazwy pól powtórzone przy każdym wpisie kosztują więcej niż same liczby,
a limit 2 MB po 200 h jest twardy.

**Liczby:** **832 kB w krotkach zamiast 2697 kB w obiektach**; same delty bytów 29,7 B
zamiast 117,5 B na wpis.
Źródło: `packages/world/src/save.ts`, `packages/world/src/save.test.ts`.

### Wsteczna zgodność zapisów przed pierwszym wydaniem — M3e

**Na rzecz:** podbijania `SAVE_VERSION` i odrzucania starych plików wprost.

**Argument:** czytanie starego formatu to koszt bez odbiorcy — nie ma jeszcze gracza,
którego zapis miałby przetrwać.

**Liczba:** brak.
Źródło: decyzja z M3e, `docs/architektura.md` §2.3.

---

## Architektura i proces

### Serializacja świata zamiast seeda plus delt — od M0

**Na rzecz:** świata jako czystej funkcji `(seed, współrzędne)` i zapisu jako słownika
nadpisań.

**Argument:** serializacja chunków dałaby setki megabajtów i koniec projektu.

**Liczba:** limit **2 MB** po 200 h gry, dziś wykorzystany w 832 kB.
Źródło: `CLAUDE.md` §Siedem zasad, `docs/architektura.md` §2.3.

### Framework UI, ECS, silnik fizyki, system zdarzeń „na przyszłość" — stała reguła

**Na rzecz:** kodu pisanego pod konkretny, istniejący problem.

**Argument:** każdy z nich to warstwa, która zaczyna dyktować kształt reszty, zanim
projekt wie, czego potrzebuje.

**Liczba:** brak.
Źródło: `CLAUDE.md` §Czego nie robisz bez pytania.

### Wcześniejsze przejście na WebGL — próg odłożony, nie odrzucony

**Na rzecz:** Canvas 2D z run-length w blicie.

**Argument:** atlas glifów na GPU kosztuje przepisanie warstwy rysującej i utratę
headless testów snapshotowych w obecnej formie, a dziś nie ma problemu, który by to
kupował. Próg jest zapisany: **p95 samego blitu powyżej 6 ms**.

**Liczby:** scena referencyjna to 7 200 komórek, 6 741 zamalowanych, **978 wywołań
`fillText`** i **0,24 ms** na sam blit — czyli 25× zapasu do progu.
Źródło: `CLAUDE.md` §Budżety.

---

## Jak dopisywać

Nowy wpis powstaje wtedy, gdy w zleceniu albo w rozmowie pada „rozważaliśmy X, robimy
Y". Wpis bez argumentu jest gorszy niż jego brak, bo wygląda na ustalenie, a jest tylko
zapisem gustu — dlatego pole **uzasadnienie poza repo** jest w tym dokumencie legalnym
wynikiem i lepszym niż wymyślony powód.
