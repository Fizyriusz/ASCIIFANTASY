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
  /**
   * Pula wytrzymałości. Osobno od hp i **nie w kodzie gry**: przy puli 60 i maczudze
   * po 19 goblin ma trzy ciosy do wyczerpania, czyli przez większość walki cofa się
   * zamiast bić. To jest liczba balansu i musi być strojona razem z kosztem broni.
   */
  stamina: number;
  /** metry na sekundę: marsz i pościg */
  walkMps: number;
  runMps: number;
  /** indeks broni w `weapons`, `null` = pazury i zęby */
  weapon: number | null;
  /** SIŁ ZRĘ KON INT WOL CHA */
  attrs: readonly number[];
  /** ostrze, obuch, blok, unik, skradanie */
  skills: readonly number[];
}

/**
 * Goblin: mały, garbaty, z pałką. Tył różni się od przodu brakiem oczu — bez takiej
 * różnicy cztery kierunki są ozdobą, bo dwa z nich dają ten sam obraz.
 *
 * Rysunek ma 5×8 znaków. Ósmy wiersz **od góry** jest w większości klatek pusty
 * i to jest miejsce na telegraf: klatka `Attack` wypełnia go uniesioną pałką, więc
 * sylwetka rośnie w górę. Kierunek nie jest ozdobny, tylko wymuszony geometrią —
 * w zwarciu (1,4 m) widać jedynie 18% ciała, czyli głowę i barki; nogi są poza dolną
 * krawędzią kadru dokładnie wtedy, kiedy zamach ma znaczenie. Telegraf zapisany
 * w rozstawie nóg byłby niewidoczny tam, gdzie jest potrzebny.
 *
 * Rysunek celowo bez ukośnika wstecznego — w rampach materiałów też go nie ma,
 * a w danych, które ktoś będzie poprawiał ręcznie, każdy znak wymagający ucieczki
 * to zaproszenie do literówki.
 */
const goblin: CreatureDef = {
  id: 'goblin',
  art: [
    // --- Idle: stoi --- (przod, bok prawy, tyl, bok lewy)
    ['     ', ' ,^, ', '(o o)', '-|#|-', ' |#| ', ' |_| ', ' | | ', ' L J '],
    ['     ', ' ,^  ', '(o=  ', ' |#|>', ' |#| ', ' |_| ', ' ||  ', ' LL  '],
    ['     ', ' ,^, ', '(   )', '-|#|-', ' |#| ', ' |_| ', ' | | ', ' L J '],
    ['     ', '  ^, ', '  =o)', '<|#| ', ' |#| ', ' |_| ', '  || ', '  JJ '],
    // --- Walk0: krok lewa noga ---
    ['     ', ' ,^, ', '(o o)', '-|#|=', ' |#| ', ' |_| ', ' | | ', 'L   J'],
    ['     ', ' ,^  ', '(o=  ', ' |#|v', ' |#| ', ' |_| ', ' |  |', ' L  J'],
    ['     ', ' ,^, ', '(   )', '=|#|-', ' |#| ', ' |_| ', ' | | ', 'L   J'],
    ['     ', '  ^, ', '  =o)', 'v|#| ', ' |#| ', ' |_| ', '|  | ', 'J   L'],
    // --- Walk1: przeciwna faza kroku ---
    ['     ', ' ,^, ', '(o o)', '=|#|-', ' |#| ', ' |_| ', ' | | ', 'J   L'],
    ['     ', ' ,^  ', '(o=  ', ' |#|^', ' |#| ', ' |_| ', '|  | ', ' J  L'],
    ['     ', ' ,^, ', '(   )', '-|#|=', ' |#| ', ' |_| ', ' | | ', 'J   L'],
    ['     ', '  ^, ', '  =o)', '^|#| ', ' |#| ', ' |_| ', ' |  |', ' L  J'],
    // --- Attack: palka nad glowa, sylwetka rosnie w gore ---
    [' ,#, ', ' /|/ ', '(o o)', ' |#| ', ' (#) ', ' |_| ', ' | | ', ' L J '],
    [' ,#  ', ' /|  ', '(o=  ', ' |#| ', ' (#) ', ' |_| ', ' ||  ', ' LL  '],
    [' ,#, ', ' /|/ ', '(   )', ' |#| ', ' (#) ', ' |_| ', ' | | ', ' L J '],
    ['  #, ', '  |/ ', '  =o)', ' |#| ', ' (#) ', ' |_| ', '  || ', '  JJ '],
    // --- Hit: glowa odrzucona, rece w bok, nogi rozjezdzaja sie ---
    ['     ', ' ,X, ', '(- -)', '=|#|=', ' |#| ', ' |_| ', ' | | ', 'L   J'],
    ['     ', ' ,X  ', '(-=  ', '=|#|=', ' |#| ', ' |_| ', ' ||  ', 'L  J '],
    ['     ', ' ,X, ', '(   )', '=|#|=', ' |#| ', ' |_| ', ' | | ', 'L   J'],
    ['     ', '  X, ', '  =-)', '=|#|=', ' |#| ', ' |_| ', '  || ', ' L  J'],
    // --- Death: kupka na ziemi, gorne wiersze przezroczyste ---
    ['     ', '     ', '     ', '     ', '     ', '     ', ' ,x, ', '-###-'],
    ['     ', '     ', '     ', '     ', '     ', '     ', ' ,x  ', '-##=-'],
    ['     ', '     ', '     ', '     ', '     ', '     ', ' ,-, ', '-###-'],
    ['     ', '     ', '     ', '     ', '     ', '     ', '  x, ', '-=##-'],
  ],
  // Barwa ciepła i jasna, celowo daleka od zieleni liści i trawy. Zielony goblin
  // miał w lesie medianę kontrastu barwy 24 na 255 (na łące 78, w lochu 43) — czyli
  // w lesie zlewał się z tłem. Po zmianie: las 90, łąka 111, loch 68. Metoda pomiaru
  // i pełna tabela są w zleceniu M3b §3.
  r: 220,
  g: 130,
  b: 70,
  heightM: 1.4,
  widthM: 0.9,
  hp: 14,
  stamina: 85,
  walkMps: 1.5,
  runMps: 3.8,
  weapon: 2,
  attrs: [35, 45, 35, 25, 30, 20],
  skills: [10, 20, 5, 15, 25],
};

export const wildCreatures: readonly CreatureDef[] = [goblin];

export const WildCreature = {
  Goblin: 0,
} as const;

export type WildCreature = (typeof WildCreature)[keyof typeof WildCreature];

/**
 * Rozmnażanie: co który klaster jest zamieszkany i ilu bytów się w nim spodziewać.
 * To są liczby balansu, więc mieszkają w contencie — groźba ma wychodzić
 * z liczebności grupy, a nie z siły pojedynczego przeciwnika.
 */
export const WILD_SPAWN = {
  /** jeden na tyle klastrów jest zamieszkany */
  oneInClusters: 8,
  /** rozmiar grupy, włącznie z granicami */
  packMin: 1,
  packMax: 3,
} as const;
