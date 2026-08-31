# Zadania

Kolejność wynika z grafu zależności: moduły niżej w stosie najpierw.
Jedno zadanie = jeden moduł = jeden PR. Nie zaczynamy kolejnego, póki poprzedni
nie ma zielonych testów i grywalnego buildu.

| # | Zadanie | Status | Odblokowuje |
|---|---|---|---|
| M0 | [Rdzeń renderera](M0-rdzen-renderera.md) | zrobione | wszystko |
| M1 | [Teren, biomy, chunki, streaming](M1-teren-i-chunki.md) | zrobione | świat większy niż ekran |
| M1b | [LOD sylwetkowy](M1b-lod-sylwetkowy.md) — **warunkowy** | niepotrzebny (pomiar M1 §7) | widok na dolinę |
| M1c | [Stabilność tekstury](M1c-stabilnosc-tekstury.md) — **przed M2** | zrobione | fakturę ścian lochu |
| M2 | [Wnętrza, lochy, światło](M2-wnetrza-loch-swiatlo.md) | zrobione | skradanie, eksplorację |
| M2c | [Górny front: bryła wisząca to nie sufit](M2c-gorny-front.md) — **przed M3** | zrobione | sprite’y, które nie znikają |
| M3 | [Postacie, walka, ekwipunek, zapis](M3-postacie-walka-zapis.md) | zrobione, czeka na odbiór | rozgrywkę |
| M3b | [Czytelność walki](M3b-czytelnosc-walki.md) | zrobione, czeka na odbiór | walkę, którą da się czytać |
| M3c | [Bryła stworzeń](M3c-bryla-stworzen.md) | do zrobienia — **następne** | czworonogi i pająki |
| M3d | [Zawartość lochu: mieszkańcy i światło](M3d-zawartosc-lochu.md) | zrobione, czeka na odbiór | loch, który jest miejscem |
| M4 | Miasteczko ([szkic](M4-M6-szkic.md)) | — | świat, który żyje |
| M5 | Questy ([szkic](M4-M6-szkic.md)) | — | cel gry |
| M6 | Region ([szkic](M4-M6-szkic.md)) | — | skalę |

M3d wykonujemy **przed** M3c: pusty loch to brak zawartości, a proporcje sprite'ów
przy obrocie to jakość tego, co już jest. Kolejność wynika z tego, że M3c stroi rzut
stworzeń, a M3d dopiero daje stworzenia, na których widać efekt — w lochu, czyli
tam, gdzie sprite stoi najbliżej oka.

M2c wykonujemy **przed** M3, nie po: sprite’y potworów i łupu są bryłami wiszącymi
i wejdą dokładnie w ten kod, w którym siedzi błąd. Wchodzenie w M3 bez tego znaczy,
że każdy potwór dostanie ten sam objaw, tylko że będzie się ruszał.

M1c wykonujemy **przed** M2, nie po: obejścia z M1 zbiły `roughness` w danych, a ściana
lochu stojąca metr od oka potrzebuje dokładnie tej faktury, którą zdjęto.

Szczegóły każdego etapu: `docs/architektura.md` §8.
Szablon nowego zlecenia: [SZABLON.md](SZABLON.md).
