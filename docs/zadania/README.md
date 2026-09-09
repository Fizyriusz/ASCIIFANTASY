# Zadania

Kolejność wynika z grafu zależności: moduły niżej w stosie najpierw.
Jedno zadanie = jeden moduł = jeden PR. Nie zaczynamy kolejnego, póki poprzedni
nie ma zielonych testów i grywalnego buildu.

**Ta tabela jest stanem projektu, nie historią.** Status ma odpowiadać na pytanie
„co jest teraz do zrobienia", więc aktualizujemy ją razem ze zleceniem, a nie po fakcie.

| # | Zadanie | Status | Odblokowuje |
|---|---|---|---|
| M0 | [Rdzeń renderera](M0-rdzen-renderera.md) | zrobione, odebrane | wszystko |
| M1 | [Teren, biomy, chunki, streaming](M1-teren-i-chunki.md) | zrobione, odebrane | świat większy niż ekran |
| M1b | [LOD sylwetkowy](M1b-lod-sylwetkowy.md) — **warunkowy** | odrzucone pomiarem (M1 §7) | — |
| M1c | [Stabilność tekstury](M1c-stabilnosc-tekstury.md) — **przed M2** | zrobione, odebrane | fakturę ścian lochu |
| M2 | [Wnętrza, lochy, światło](M2-wnetrza-loch-swiatlo.md) | zrobione, odebrane | skradanie, eksplorację |
| M2c | [Górny front: bryła wisząca to nie sufit](M2c-gorny-front.md) — **przed M3** | zrobione, odebrane | sprite'y, które nie znikają |
| M3 | [Postacie, walka, ekwipunek, zapis](M3-postacie-walka-zapis.md) | zrobione, odebrane (tag `m3-recording`) | rozgrywkę |
| M3b | [Czytelność walki](M3b-czytelnosc-walki.md) | zrobione, odebrane | walkę, którą da się czytać |
| M3d | [Zawartość lochu: mieszkańcy i światło](M3d-zawartosc-lochu.md) | zrobione, odebrane | loch, który jest miejscem |
| M3f | [Sprzężenie własnych akcji i celowanie](M3f-sprzezenie-wlasnych-akcji.md) | zrobione, odebrane | walkę, w której widać siebie |
| M3e | [Cykl życia bytów](M3e-cykl-zycia-bytow.md) | zrobione, **czeka na odbiór w grze** | świat, który nie pustoszeje |
| M3g | [Ataki jako dane](M3g-ataki-jako-dane.md) | do zrobienia — **następne** | kształt ruchu broni, łuki i pchnięcia |
| M3c | [Bryła stworzeń](M3c-bryla-stworzen.md) | do zrobienia, po M3g | czworonogi i pająki |
| M4 | Miasteczko ([szkic](M4-M6-szkic.md)) | szkic | świat, który żyje |
| M5 | Questy ([szkic](M4-M6-szkic.md)) | szkic | cel gry |
| M6 | Region ([szkic](M4-M6-szkic.md)) | szkic | skalę |

Poza tabelą, bo nie są zleceniami: **poprawki w trakcie M3e** — czytelność trafień
(margines celowania w metrach, rzut na siłę ciosu, unik jako nietykalność) i zwłoki
jako rekord. Oba weszły jako reakcja na zgłoszenie z gry, oba są opisane
w `docs/architektura.md` §6 i §2.3a, a odrzucone przy nich warianty — w `docs/decyzje.md`.

## Kolejność i jej powody

M3g wykonujemy **przed** M3c: ataki jako dane zmieniają to, **co** stworzenie ma
narysowane (osobne klatki na wariant ataku), więc rysowanie brył przed ustaleniem
liczby klatek znaczyłoby rysowanie dwa razy.

M3d wykonujemy **przed** M3c: pusty loch to brak zawartości, a proporcje sprite'ów
przy obrocie to jakość tego, co już jest. Kolejność wynika z tego, że M3c stroi rzut
stworzeń, a M3d dopiero daje stworzenia, na których widać efekt — w lochu, czyli
tam, gdzie sprite stoi najbliżej oka.

M2c wykonujemy **przed** M3, nie po: sprite'y potworów i łupu są bryłami wiszącymi
i wejdą dokładnie w ten kod, w którym siedzi błąd. Wchodzenie w M3 bez tego znaczy,
że każdy potwór dostanie ten sam objaw, tylko że będzie się ruszał.

M1c wykonujemy **przed** M2, nie po: obejścia z M1 zbiły `roughness` w danych, a ściana
lochu stojąca metr od oka potrzebuje dokładnie tej faktury, którą zdjęto.

## Narzędzia, na których stoją zlecenia

| narzędzie | do czego | używane przez |
|---|---|---|
| [`tools/creature-editor`](../../tools/creature-editor/index.html) | rysowanie stworzeń, ataki jako dane, miara telegrafu i kontrastu | M3c, M3g |
| [`tools/grimoire`](../../tools/grimoire/index.html) | prototyp rysowanych zaklęć (kształt = co, pomiar = jak dobrze, glif = żywioł) | po M3, magia |
| `tools/harness` | render headless, złote pliki, pomiary | wszystkie |
| `tools/mapdump` | podgląd regionu z góry | M1, M6 |

Szczegóły każdego etapu: `docs/architektura.md` §8.
Odrzucone warianty i ich powody: [`docs/decyzje.md`](../decyzje.md).
Szablon nowego zlecenia: [SZABLON.md](SZABLON.md).
