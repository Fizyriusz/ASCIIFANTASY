/**
 * Zawartość lochu: ilu mieszkańców i ile żagwi. Liczby, nie kod — tak samo jak
 * obrażenia i czasy broni.
 *
 * Dwie z nich rządzą tym, czy loch jest miejscem, czy korytarzem, i obie są
 * kompromisem w tę samą stronę: **ciemność i pustka są stanem domyślnym**, a każda
 * zamieszkana komora i każda żagiew są wyjątkiem, który ten stan podkreśla. Loch
 * oświetlony w całości przestaje potrzebować pochodni, a loch pełen potworów
 * przestaje być zwiedzany i zaczyna być czyszczony.
 */
export const DUNGEON_SPAWN = {
  /** szansa, że zwykła komora jest zamieszkana */
  roomChance: 0.45,
  /**
   * ...i osobno komora z wejściem. Niżej, bo pierwsze trzy kroki w lochu nie mają
   * być walką — gracz ma zdążyć zauważyć, że zrobiło się ciemno.
   */
  entryRoomChance: 0.15,
  /** rozmiar grupy w zamieszkanej komorze, włącznie z granicami */
  packMin: 1,
  packMax: 3,
  /** ile do szansy dokłada każda kondygnacja w dół — jedyna nagroda za schodzenie */
  perLevel: 0.1,
  /** indeks bytu w `wildCreatures` */
  kind: 0,
} as const;

export const DUNGEON_LIGHT = {
  /** szansa, że komora ma żagiew */
  roomChance: 0.3,
  perRoomMin: 1,
  perRoomMax: 2,
  /** metry nad podłogą: wysokość zawieszenia */
  heightM: 2.2,
} as const;
