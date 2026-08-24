# Zadania

Kolejność wynika z grafu zależności: moduły niżej w stosie najpierw.
Jedno zadanie = jeden moduł = jeden PR. Nie zaczynamy kolejnego, póki poprzedni
nie ma zielonych testów i grywalnego buildu.

| # | Zadanie | Status | Odblokowuje |
|---|---|---|---|
| M0 | [Rdzeń renderera](M0-rdzen-renderera.md) | zrobione | wszystko |
| M1 | [Teren, biomy, chunki, streaming](M1-teren-i-chunki.md) | zrobione | świat większy niż ekran |
| M1b | [LOD sylwetkowy](M1b-lod-sylwetkowy.md) — **warunkowy** | niepotrzebny (pomiar M1 §7) | widok na dolinę |
| M1c | [Stabilność tekstury](M1c-stabilnosc-tekstury.md) — **przed M2** | do zrobienia | fakturę ścian lochu |
| M2 | [Wnętrza, lochy, światło](M2-wnetrza-loch-swiatlo.md) | po M1c | skradanie, eksplorację |
| M3 | [Postacie, walka, ekwipunek, zapis](M3-postacie-walka-zapis.md) | — | rozgrywkę |
| M4 | Miasteczko ([szkic](M4-M6-szkic.md)) | — | świat, który żyje |
| M5 | Questy ([szkic](M4-M6-szkic.md)) | — | cel gry |
| M6 | Region ([szkic](M4-M6-szkic.md)) | — | skalę |

M1c wykonujemy **przed** M2, nie po: obejścia z M1 zbiły `roughness` w danych, a ściana
lochu stojąca metr od oka potrzebuje dokładnie tej faktury, którą zdjęto.

Szczegóły każdego etapu: `docs/architektura.md` §8.
Szablon nowego zlecenia: [SZABLON.md](SZABLON.md).
