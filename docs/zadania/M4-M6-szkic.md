# M4–M6 — szkic kierunkowy

**To nie są zlecenia.** To notatka, żeby nie zgubić wątku między milestone'ami.
Pełne zlecenie każdego etapu piszemy dopiero, gdy poprzedni jest zamknięty — bo
specyfikacja pisana trzy miesiące naprzód opisuje świat, którego nie ma.

Format docelowy: `docs/zadania/SZABLON.md`.

---

## M4 — Miasteczko żyje

**Cel:** jedna osada, w której NPC są w innych miejscach o 3:00 i o 13:00, a kradzież
ma konsekwencje.

Kluczowe decyzje do podjęcia w zleceniu:

- **Leniwe harmonogramy** — pozycja NPC jako czysta funkcja `(harmonogram, zegar, delty)`.
  Pełni agenci tylko w promieniu ~40 m. To jest miejsce, gdzie ten projekt albo utrzyma
  wydajność, albo ją straci
- ekonomia z podaży i popytu, nie z tabeli cen — ceny mają wynikać z zapasów osady
- straż, przestępstwo, reputacja — najprostsza wersja, jaka daje konsekwencje
- dialog: drzewo z warunkami na stanie świata, bez systemu skryptowego
- budynki z M2 dostają mieszkańców i wnętrza

Kryterium: przejdź się po osadzie o różnych porach doby i opisz, co robili ludzie.

---

## M5 — Questy

**Cel:** pięć questów z rzędu, żaden nie wskazuje na nieistniejący byt.

- szablony ze slotami, sloty wiązane do **realnie istniejących** bytów świata
- 3–4 ręcznie napisane wątki jako kręgosłup — bez nich wszystko brzmi jak Radiant Quest
- plotki jako encje z polem `truth`: plotka może kłamać, a dziennik zapisuje to,
  co gracz wie, nie prawdę
- generator uruchamiany potrzebą NPC, nie licznikiem

Kryterium: 10 000 wygenerowanych instancji, zero nieosiągalnych slotów.

---

## M6 — Region

**Cel:** trzy godziny gry bez powtórzenia się tego samego układu.

- 20–40 POI: osady, ruiny, wieże, kopalnie, obozy, kręgi kamienne
- drogi między POI (A* po koszcie terenu, warstwa zgrubna jak rzeki w M1)
- podróż szybka z upływem czasu gry i zdarzeniami losowymi
- frakcje i stan świata na osiach

Kryterium: 3 h gry, spis odwiedzonych miejsc, żadne dwa nie sprawiają wrażenia tego samego.

---

## Po M6

**Więcej contentu, nie więcej systemów.** To moment, w którym takie projekty giną:
kolejny system zawsze wydaje się ciekawszy niż dwadzieścia dobrze napisanych questów.

Rzeczy odłożone świadomie, do rozważenia dopiero wtedy: konstruktor zaklęć, rzemiosło,
budowa i posiadanie własnego domu, pogoda i pory roku, dźwięk (Web Audio), tryb wieloosobowy.

Osobny wątek: paczka `neon` z M1 wciąż działa. Shadowrun na tym rdzeniu to nie nowy
silnik, tylko nowa paczka contentu plus Matrix jako druga siatka.
