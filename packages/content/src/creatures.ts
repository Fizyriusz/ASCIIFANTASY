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

/**
 * Nazwy klatek. Renderer nie zna tych stałych — dostaje numer klatki; nazwy są tu,
 * bo to reguły i AI decydują, kiedy byt zamachuje się, a kiedy leży.
 */
export const Frame = {
  Idle: 0,
  Walk0: 1,
  Walk1: 2,
  Attack: 3,
  Hit: 4,
  Death: 5,
} as const;
export type Frame = (typeof Frame)[keyof typeof Frame];

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
    // --- Idle: stoi --- (przod, bok prawy, tyl, bok lewy)
    [' ,^, ', '(o o)', '-|#|-', ' |#| ', ' |_| ', ' | | ', ' L J '],
    [' ,^  ', '(o=  ', ' |#|>', ' |#| ', ' |_| ', ' ||  ', ' LL  '],
    [' ,^, ', '(   )', '-|#|-', ' |#| ', ' |_| ', ' | | ', ' L J '],
    ['  ^, ', '  =o)', '<|#| ', ' |#| ', ' |_| ', '  || ', '  JJ '],
    // --- Walk0: krok lewa noga, palka w gorze ---
    [' ,^, ', '(o o)', '-|#|=', ' |#| ', ' |_| ', ' | | ', 'L   J'],
    [' ,^  ', '(o=  ', ' |#|^', ' |#| ', ' |_| ', ' |  |', ' L  J'],
    [' ,^, ', '(   )', '=|#|-', ' |#| ', ' |_| ', ' | | ', 'L   J'],
    ['  ^, ', '  =o)', '^|#| ', ' |#| ', ' |_| ', '|  | ', 'J   L'],
    // --- Walk1: przeciwna faza kroku ---
    [' ,^, ', '(o o)', '=|#|-', ' |#| ', ' |_| ', ' | | ', 'J   L'],
    [' ,^  ', '(o=  ', ' |#|v', ' |#| ', ' |_| ', '|  | ', ' J  L'],
    [' ,^, ', '(   )', '-|#|=', ' |#| ', ' |_| ', ' | | ', 'J   L'],
    ['  ^, ', '  =o)', 'v|#| ', ' |#| ', ' |_| ', ' |  |', ' L  J'],
    // --- Attack: palka wyprowadzona do przodu ---
    [' ,^, ', '(o o)', '-|#|-', ' |#|=', ' |_|=', ' | | ', ' L J '],
    [' ,^  ', '(o=  ', ' |#| ', ' |#|=', ' |_|=', ' ||  ', ' LL  '],
    [' ,^, ', '(   )', '-|#|-', ' |#|=', ' |_|=', ' | | ', ' L J '],
    ['  ^, ', '  =o)', ' |#| ', '=|#| ', '=|_| ', '  || ', '  JJ '],
    // --- Hit: odrzucony ciosem, rece w bok ---
    [' ,^, ', '(x x)', '-=#=-', ' |#| ', ' |_| ', ' | | ', ' L J '],
    [' ,^  ', '(x=  ', '-=#=-', ' |#| ', ' |_| ', ' ||  ', ' LL  '],
    [' ,^, ', '(   )', '-=#=-', ' |#| ', ' |_| ', ' | | ', ' L J '],
    ['  ^, ', '  =x)', '-=#=-', ' |#| ', ' |_| ', '  || ', '  JJ '],
    // --- Death: kupka na ziemi, gorne wiersze przezroczyste ---
    ['     ', '     ', '     ', '     ', '     ', ' ,x, ', '-###-'],
    ['     ', '     ', '     ', '     ', '     ', ' ,x  ', '-##=-'],
    ['     ', '     ', '     ', '     ', '     ', ' ,-, ', '-###-'],
    ['     ', '     ', '     ', '     ', '     ', '  x, ', '-=##-'],
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
