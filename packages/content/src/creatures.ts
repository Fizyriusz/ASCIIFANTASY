/**
 * Byty jako rysunki, nie jako tablice liczb.
 *
 * Każdy zestaw to cztery kierunki w kolejności **przód, bok prawy, tył, bok lewy**
 * — tak samo jak indeksuje je `SPRITE_DIRS` w rendererze. Spacja znaczy przezroczyste,
 * więc sprite'a da się przeczytać wprost z kodu i poprawić bez narzędzi.
 *
 * Kierunki są tu z tego samego powodu, dla którego są w Doomie: byt bez nich obraca
 * się razem z graczem i przestaje być bryłą. Koszt to cztery rysunki zamiast jednego.
 */

/** Jeden byt: klatki animacji × cztery kierunki, barwa i wysokość w metrach. */
export interface CreatureDef {
  id: string;
  /** klatka po klatce, w każdej cztery kierunki */
  art: readonly (readonly string[])[];
  r: number;
  g: number;
  b: number;
  /** metry — z tego wynika rozmiar na ekranie, nie z liczby znaków */
  heightM: number;
  /** metry — szerokość bytu; osobno od wysokości, bo komórka znakowa nie jest kwadratem */
  widthM: number;
  /** punkty życia na start; reszta reguł jest w `packages/rules` */
  hp: number;
}

/**
 * Goblin: mały, garbaty, z pałką. Tył różni się od przodu brakiem oczu — bez takiej
 * różnicy cztery kierunki są ozdobą, bo dwa z nich dają ten sam obraz.
 *
 * Rysunek ma 5×7 znaków, a nie 3×4: skalowanie próbkuje najbliższego sąsiada, więc
 * z dwóch metrów każdy znak rysunku rozlewa się na kilkanaście komórek. Przy 3×4
 * goblin z bliska był jednolitą płachtą liter `o`.
 *
 * Rysunek celowo bez ukośnika wstecznego — w rampach materiałów też go nie ma,
 * a w danych, które ktoś będzie poprawiał ręcznie, każdy znak wymagający ucieczki
 * to zaproszenie do literówki.
 */
const goblin: CreatureDef = {
  id: 'goblin',
  art: [
    // --- klatka 0: stoi --- (przod, bok prawy, tyl, bok lewy)
    [' ,^, ', '(o o)', '-|#|-', ' |#| ', ' |_| ', ' | | ', ' L J '],
    [' ,^  ', '(o=  ', ' |#|>', ' |#| ', ' |_| ', ' ||  ', ' LL  '],
    [' ,^, ', '(   )', '-|#|-', ' |#| ', ' |_| ', ' | | ', ' L J '],
    ['  ^, ', '  =o)', '<|#| ', ' |#| ', ' |_| ', '  || ', '  JJ '],
    // --- klatka 1: idzie, palka w gorze, nogi rozstawione ---
    [' ,^, ', '(o o)', '-|#|=', ' |#| ', ' |_| ', ' | | ', 'L   J'],
    [' ,^  ', '(o=  ', ' |#|^', ' |#| ', ' |_| ', ' |  |', ' L  J'],
    [' ,^, ', '(   )', '=|#|-', ' |#| ', ' |_| ', ' | | ', 'L   J'],
    ['  ^, ', '  =o)', '^|#| ', ' |#| ', ' |_| ', '|  | ', 'J   L'],
  ],
  r: 120,
  g: 160,
  b: 90,
  heightM: 1.4,
  widthM: 0.9,
  hp: 14,
};

export const wildCreatures: readonly CreatureDef[] = [goblin];

export const WildCreature = {
  Goblin: 0,
} as const;

export type WildCreature = (typeof WildCreature)[keyof typeof WildCreature];
