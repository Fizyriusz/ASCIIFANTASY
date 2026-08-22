# M1b — LOD sylwetkowy (zlecenie warunkowe)

**Uruchamiamy tylko wtedy, gdy tabela pomiarów z M1 §7 tego wymaga.** Jeśli zasięg
dający sensowny widok na pustkowiu mieści się w 8 ms — to zlecenie zostaje niewykonane
i to jest dobry wynik.

**Cel:** widok na dolinę z grzbietu. Detal blisko, sylwetka daleko, granica niewidoczna
dla gracza.

Przeczytaj wcześniej: `CLAUDE.md`, `docs/architektura.md` §2.2 i §3.1, raport z M1.

---

## Zakres

### Wolno dotykać
```
packages/core/src/raymarch.ts       ← druga warstwa marszu
packages/core/src/lod.ts            ← nowy
packages/world/src/coarse.ts        ← nowy: siatka zgrubna wysokości
packages/world/src/chunk.ts         ← produkcja danych zgrubnych
tools/harness/src/*.test.ts
```

### Nie dotykać
`terrain.ts`, `hydro.ts`, `biome.ts` — warstwa zgrubna ma być **pochodną** tych samych
funkcji, nie drugą, niezależną generacją. Dwa źródła prawdy o wysokości terenu to
gwarantowany rozjazd między tym, co widać z daleka, a tym, co zastajesz na miejscu.

---

## Co ma powstać

### 1. Siatka zgrubna

```ts
function coarseHeight(seed: number, gx: number, gy: number): number;  // 8×8 komórek
function coarseMaterial(seed: number, gx: number, gy: number): number;
```

Jedna próbka na 8×8 komórek (16×16 m). Liczona z tych samych funkcji co teren pełny —
próbkowanie, nie osobny algorytm. Cache per chunk, tani do policzenia razem z chunkiem.

### 2. Dwie warstwy marszu

- **blisko** (do zasięgu z M1, obecnie 64 komórki = 128 m): obecny marsz spanowy, pełny detal
- **daleko** (do ~200 komórek): marsz po siatce zgrubnej, wyłącznie sylwetka —
  wysokość, kolor materiału, rampa znaku sterowana samą odległością. Bez tekstury,
  bez okien, bez detalu

Warstwa daleka startuje tam, gdzie bliska skończyła: przekazujesz jej `loRow` / `hiRow`
(dolny front idzie od `rows` w górę, górny od `-1` w dół), więc zasłanianie działa dalej
bez dodatkowej logiki.

### 3. Ukrycie granicy

Granica musi być niewidoczna. Trzy mechanizmy, wszystkie potrzebne:

- **mgła rosnąca z odległością** tak dobrana, żeby przy przejściu detal i tak był ledwo
  czytelny — to główny mechanizm, reszta go wspiera
- **rampa znaku** rzednie stopniowo, nie skokowo
- **brak zmiany koloru** przy przejściu: sylwetka używa tego samego materiału gruntu
  co detal, tylko bez wariacji

Jeśli po tych trzech granica nadal jest widoczna, problem leży w doborze mgły, nie
w potrzebie czwartego mechanizmu.

---

## Definicja ukończenia

1. `pnpm typecheck`, `pnpm test`, `pnpm test:snap`, `pnpm bench` — zielone.
2. Snapshoty: `lod-valley` (widok z grzbietu na dolinę), `lod-boundary` (kamera ustawiona
   tak, że granica warstw wypada w środku kadru — **ma być nie do wskazania**),
   `lod-forest-far` (las w warstwie dalekiej czyta się jako las, nie jako zielona plama).
3. **Test spójności**: 10 000 punktów, wysokość zgrubna vs pełna — różnica poniżej
   progu widoczności przy odległości, na której warstwa zgrubna jest używana.
4. Budżet: `renderWorld` z zasięgiem 200 komórek < 8 ms na wszystkich trzech scenach z M1.
5. `pnpm dev`: wejdź na grzbiet, obejrzyj dolinę, zejdź do niej. Napisz, czy w trakcie
   schodzenia coś „doskoczyło" — to jedyny test, którego nie zrobi snapshot.
6. Podsumowanie w formacie z `CLAUDE.md`.

---

## Pułapki

1. **Druga, niezależna generacja terenu dla LOD** — rozjazd między widokiem z daleka
   a rzeczywistością na miejscu. Warstwa zgrubna to próbkowanie tej samej funkcji.
2. **Ostra granica warstw** — objawia się jako pierścień wokół gracza wędrujący razem
   z nim. Najbardziej rzucający się w oczy artefakt w całym rendererze.
3. **Sylwetka z detalem** — jeśli warstwa daleka rysuje okna i tekstury, nie oszczędzasz
   nic i cały LOD nie ma sensu.
4. **LOD dla lasu liczony z pojedynczych drzew** — las ma być jedną bryłą o wysokości
   koron, nie tysiącem billboardów.
