/**
 * Stałe walki. Wszystkie w jednym miejscu, bo balans ma się zmieniać bez dotykania
 * `packages/rules` — jeśli zmiana liczby wymaga zmiany kodu, model danych jest zły.
 *
 * Szansa trafienia jest **jednym rzutem**: `base + skill*skillWeight + atrybut*attrWeight
 * − obrona`. Bez tabel, bez rzutów przeciwstawnych, bez stopni sukcesu. Tabela to
 * kolejny plik do strojenia, a nie kolejna decyzja dla gracza.
 */
export const COMBAT = {
  /** szansa trafienia przy zerowej umiejętności i zerowej obronie */
  baseHit: 0.35,
  /** wkład umiejętności broni (0..100) w szansę trafienia */
  hitPerSkill: 0.004,
  /** wkład zręczności (0..100) atakującego */
  hitPerAgi: 0.002,
  /**
   * radiany: połowa łuku ciosu w poziomie. Schodzi z 0,9 do 0,55, bo 0,9 rad to 51,6°
   * przy polu widzenia ±37° — łuk był **szerszy niż ekran**, czyli dawało się trafić
   * coś, czego nie widać.
   */
  swingArcRad: 0.55,
  /**
   * radiany: margines okna pionowego. Cel jest trafiony, gdy kąt elewacji patrzenia
   * mieści się w kącie, jaki zajmuje sylwetka celu, powiększonym o tyle z każdej
   * strony. Przy 2 m sylwetka goblina zajmuje od −9° (głowa) do −40° (stopy), więc
   * margines 8° robi z tego okno 47° — hojne, ale wymuszające patrzenie **na**
   * przeciwnika, a nie nad niego.
   */
  aimMarginRad: 0.14,
  /**
   * metry: pionowy zasięg ciosu wokół wysokości barków. Rozstrzyga po stronie AI
   * (byt celuje w środek sylwetki, więc kąt patrzenia niczego by nie ograniczył)
   * i domyka przypadek przęsła mostu: stojący wyżej nie dosięga tego pod spodem.
   */
  verticalReachM: 1.1,
  /** dolna i górna granica — zawsze zostaje ryzyko i zawsze zostaje szansa */
  hitMin: 0.05,
  hitMax: 0.95,

  /** obrona bierna obrońcy, zanim cokolwiek zrobi */
  defBase: 0.05,
  /** wkład uniku (0..100) w obronę, gdy obrońca stoi */
  defPerDodgeSkill: 0.0015,
  /** ile obrony dokłada unik trafiony w oknie czasowym */
  defDodgeWindow: 0.45,
  /**
   * ms: jak długo trwa okno uniku po naciśnięciu — i zarazem czas, na który rozłożone
   * jest przesunięcie. Wydłużone z 260 ms, bo przy dystansie 2,2 m krótkie okno dawało
   * szczyt 16,9 m/s i 27 cm przeskoku na klatkę: to czyta się jak teleport, nie uskok.
   * Przy 480 ms szczyt spada do 9,2 m/s (dwa razy prędkość biegu) i 15 cm na klatkę.
   */
  dodgeWindowMs: 480,
  /**
   * metry: o ile unik **przesuwa** postać. Unik nie jest oknem nietykalności ze znaczkiem
   * obok, tylko ruchem — sygnałem dla gracza jest to, że świat jedzie w drugą stronę,
   * a nie symbol przy krawędzi kadru. Metr przy oknie 260 ms daje szarpnięcie
   * wyraźnie szybsze od biegu i wyhamowanie w miejscu.
   */
  dodgeDistanceM: 2.2,
  /** ms: ile trwa bezradność po uniku — unik nie jest darmowy */
  dodgeRecoverMs: 340,
  /** wytrzymałość za unik */
  dodgeStamina: 24,

  /** ułamek obrażeń zatrzymany przez udany blok */
  blockReduction: 0.65,
  /** wkład umiejętności bloku w tę redukcję (0..100) */
  blockPerSkill: 0.002,
  /** wytrzymałość zjadana przez blok, na punkt zablokowanych obrażeń */
  blockStaminaPerDamage: 1.6,

  /** mnożnik obrażeń od siły: 1.0 przy sile 50 */
  dmgPerStr: 0.01,
  /** minimalne obrażenia trafienia, którego pancerz nie zatrzymał w całości */
  dmgFloor: 1,

  /** wytrzymałość na sekundę, gdy byt nic nie robi */
  staminaRegen: 24,
  /**
   * ms bez regeneracji po zamachu, uniku i przebitym bloku. To jest jedyny powód,
   * dla którego wytrzymałość w ogóle jest zasobem: bez opóźnienia regeneracja
   * 14/s pokrywała większość kosztu ciosu w trakcie jego własnego cyklu i można
   * było atakować bez przerwy przez 16-56 ciosów, przy starciu trwającym 4-5 s.
   * Wartość dobrana tak, żeby przekraczała pełny cykl **najwolniejszej** broni
   * (maczuga, 980 ms): dopóki bijesz, nie regenerujesz wcale, niezależnie od broni.
   * Regeneracja jest za to szybka (24/s), więc odpuszczenie ciosu na sekundę jest
   * realną decyzją, a nie wyrokiem — przy 14/s symulacja 10 000 starć rozciągała
   * się do 45 s w p99, bo obie strony stały wyczerpane.
   */
  staminaRegenDelayMs: 1000,
  /**
   * Ułamek puli, poniżej którego byt jest widocznie wyczerpany. Ułamek, a nie
   * liczba punktów: goblin ma pulę 60, gracz 100, więc próg 20 punktów znaczyłby
   * dla goblina jedną trzecią zapasu, a dla gracza jedną piątą — i potwór
   * przez większość walki cofałby się zamiast bić.
   */
  exhaustedBelow: 0.2,
  /**
   * ...i dopiero powyżej tylu z tego wychodzi. Histereza, bo próg pojedynczy daje
   * migotanie stanu przy każdym tyknięciu regeneracji.
   */
  exhaustedClear: 0.34,
  /** ...i gdy trzyma blok: mniej, więc blok w nieskończoność nie działa */
  staminaRegenBlocking: 7,
  /** poniżej tylu punktów cios wytrąca z równowagi */
  staggerBelowStamina: 12,
  /** ms: ile trwa wytrącenie */
  staggerMs: 500,
  /**
   * ms: ile najwyżej trwa **jedno** cofnięcie wyczerpanego bytu. Bez budżetu
   * czasowego cofanie nie ma końca: gracz naciera, byt spełnia warunek „przeciwnik
   * w zasięgu" w każdej klatce i wycofuje się w nieskończoność, co w grze wygląda
   * jak przepychanie potwora chodzeniem. Po wyczerpaniu budżetu byt staje i się
   * zasłania — a to jest czytelny sygnał „teraz go masz".
   */
  retreatMs: 900,

  /**
   * Rozwój przez użycie: przyrost punktów przy umiejętności 0. Wartość jest mała
   * celowo — przy 0,12 przejście 0→100 kosztuje około 2500 udanych użyć, czyli
   * godziny gry. Przy 0,9 (pierwsza próba) całą umiejętność wyrabiało 268 ciosów,
   * a więc jedno dłuższe starcie.
   */
  growthBase: 0.12,
  /** ...i tempo hamowania — przy skill = growthHalf przyrost jest połową bazowego */
  growthHalf: 25,
  /** ułamek przyrostu za nieudaną próbę: uczysz się też na pudłach, ale wolniej */
  growthOnMiss: 0.25,

  /** kilogramy udźwigu na punkt siły */
  carryPerStr: 0.6,
  /** przeciążenie: ile procent regeneracji zostaje przy pełnym przeciążeniu */
  overloadRegen: 0.35,
} as const;

/**
 * Percepcja. Światło jest tu pełnoprawnym składnikiem, bo policzyliśmy je w M2 —
 * skradanie w ciemności wychodzi z tego za darmo, bez osobnego systemu.
 */
export const PERCEPTION = {
  /** radiany: połowa kąta stożka widzenia */
  coneHalf: 1.05,
  /** metry: zasięg wzroku przy pełnym świetle celu */
  sightM: 40,
  /** metry: zasięg, poniżej którego byt zauważa cel nawet poza stożkiem (czuje) */
  senseM: 2.5,
  /** poniżej tej luminancji celu (0..1) wzrok nie działa wcale */
  darkCutoff: 0.12,
  /** metry: jak daleko słychać bieg... */
  noiseRunM: 22,
  /** ...i skradanie */
  noiseSneakM: 5,
  /** ułamek hp, poniżej którego byt ucieka zamiast walczyć */
  fleeHpFraction: 0.25,
  /** ms: jak długo byt szuka po utracie celu z oczu, zanim wróci do spokoju */
  searchMs: 6000,
} as const;

/**
 * Ruch. Metry na sekundę — prędkości są tu, a nie w kodzie, bo tempo poruszania
 * jest odczuciem z gry i stroi się je razem z zasięgiem wzroku i czasem zamachu.
 */
export const MOVE = {
  walkMps: 1.9,
  runMps: 4.4,
  /** bieg kosztuje wytrzymałość — inaczej nie ma powodu chodzić */
  runStaminaPerSec: 9,
  /** radiany na sekundę: jak szybko byt obraca się w stronę celu */
  turnRate: 3.2,
  /**
   * metry: promień ciała. Dwa byty nie zbliżą się bardziej niż na jego dwukrotność.
   * Bez tego gracz **wchodził w potwora**: pomiar dał dystans 0,00 m po dziesięciu
   * sekundach nacierania, a wtedy sprite jest w kamerze, łuk ciosu przestaje cokolwiek
   * znaczyć, a odsuwanie się bytu czyta się jak przepychanie go chodzeniem.
   */
  bodyRadiusM: 0.55,
} as const;

/**
 * Postać gracza na start. Atrybuty w skali 0..100, umiejętności tak samo —
 * jedna skala dla wszystkiego, żeby wzory nie musiały ich przeliczać.
 */
export const PLAYER = {
  hp: 45,
  stamina: 100,
  /** SIŁ ZRĘ KON INT WOL CHA */
  attrs: [45, 45, 45, 40, 40, 40] as const,
  /** ostrze, obuch, blok, unik, skradanie */
  skills: [25, 10, 15, 15, 10] as const,
} as const;
