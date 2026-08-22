/**
 * Model świata. Komórka to lista spanów (pionowych brył), nie pojedyncza wysokość.
 * Teren otwarty ma zwykle 1 span, więc szybka ścieżka pozostaje szybka, ale ten
 * sam kod obsługuje mosty, piętra, piwnice i jaskinie.
 */

export type MaterialId = number;
export type RegionId = number;
export type ChunkCoord = { cx: number; cy: number };

export const CHUNK_SIZE = 64;
/** metry na komórkę — fantasy jest kameralne, cyberpunk był na 4 m */
export const CELL_METERS = 2;

/**
 * Flagi spanu. Obiekt `as const`, nie enum: `const enum` znika przy transpilacji
 * per plik, więc jego użycie przez granicę pakietu zależy od bundlera i cicho
 * pęka przy zmianie narzędzi. Zwykły obiekt zachowuje się tak samo w tsc,
 * esbuildzie i rollupie.
 */
export const SpanFlags = {
  None: 0,
  Solid: 1 << 0,
  Water: 1 << 1,
  Door: 1 << 2,
  Stairs: 1 << 3,
  Transparent: 1 << 4,
  Emissive: 1 << 5,
} as const;

/** Pojedyncza flaga — jedna z wartości SpanFlags. */
export type SpanFlag = (typeof SpanFlags)[keyof typeof SpanFlags];

/**
 * Maska flag. Osobny typ od `SpanFlag`, bo flagi łączy się OR-em, a suma
 * (np. Solid | Emissive = 33) nie należy już do unii pojedynczych wartości.
 */
export type SpanFlagMask = number;

export interface Span {
  bottom: number;
  top: number;
  mat: MaterialId;
  capMat: MaterialId;
  flags: SpanFlagMask;
}

export interface Cell {
  spans: Span[];
  /** światło statyczne 0..15, wynik flood fillu przy generacji chunka */
  light: number;
  region: RegionId;
}

export interface Chunk {
  cx: number;
  cy: number;
  /** CHUNK_SIZE * CHUNK_SIZE komórek, indeks = y * CHUNK_SIZE + x */
  cells: Cell[];
  /** hash zawartości — do testu determinizmu */
  contentHash: number;
}

/** Zapis gry: seed + nadpisania. Nigdy nie serializujemy wygenerowanego świata. */
export type DeltaKey = `${number}:${number}:${number}`;

export interface SaveFile {
  seed: number;
  version: number;
  /** minuty gry od startu */
  clock: number;
  cellDeltas: Record<DeltaKey, Partial<Cell>>;
  flags: Record<string, number>;
}
