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
  /** dolna i górna granica — zawsze zostaje ryzyko i zawsze zostaje szansa */
  hitMin: 0.05,
  hitMax: 0.95,

  /** obrona bierna obrońcy, zanim cokolwiek zrobi */
  defBase: 0.05,
  /** wkład uniku (0..100) w obronę, gdy obrońca stoi */
  defPerDodgeSkill: 0.0015,
  /** ile obrony dokłada unik trafiony w oknie czasowym */
  defDodgeWindow: 0.45,
  /** ms: jak długo trwa okno uniku po naciśnięciu */
  dodgeWindowMs: 260,
  /** ms: ile trwa bezradność po uniku — unik nie jest darmowy */
  dodgeRecoverMs: 340,
  /** wytrzymałość za unik */
  dodgeStamina: 16,

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
  staminaRegen: 14,
  /** ...i gdy trzyma blok: mniej, więc blok w nieskończoność nie działa */
  staminaRegenBlocking: 4,
  /** poniżej tylu punktów cios wytrąca z równowagi */
  staggerBelowStamina: 12,
  /** ms: ile trwa wytrącenie */
  staggerMs: 500,

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
