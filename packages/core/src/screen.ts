/**
 * Bufor znaków — jedyna powierzchnia, na którą rysuje cała gra.
 * Świat, UI, mapa i dialogi trafiają tutaj, dzięki czemu nie ma rozjazdu
 * stylu ani osobnej warstwy HTML.
 *
 * Kontrakt wydajnościowy: żadna metoda nie alokuje. Bufory są prealokowane
 * przy `resize`, a `resize` wołamy tylko przy realnej zmianie rozmiaru okna.
 */

/** Pusta komórka. Kod 0, a nie spacja — spacja to świadomie narysowana spacja. */
export const EMPTY = 0;

export interface ScreenMetrics {
  /** szerokość backing store'u w pikselach (już po devicePixelRatio) */
  readonly widthPx: number;
  readonly heightPx: number;
  readonly cols: number;
  readonly rows: number;
  /** szerokość glifu w pikselach — bierzemy z measureText, nie zgadujemy */
  readonly cellW: number;
  readonly cellH: number;
  readonly fontPx: number;
}

export class Screen {
  /** kody znaków, indeks = row * cols + col */
  chars: Uint16Array;
  /** kolor skwantyzowany do 15 bitów (patrz color.ts) */
  colors: Uint16Array;

  cols = 0;
  rows = 0;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.chars = new Uint16Array(cols * rows);
    this.colors = new Uint16Array(cols * rows);
  }

  /** Realokuje bufory. Wołać wyłącznie przy zmianie rozmiaru okna. */
  resize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.chars = new Uint16Array(cols * rows);
    this.colors = new Uint16Array(cols * rows);
  }

  clear(): void {
    this.chars.fill(EMPTY);
  }

  /** Bez sprawdzania zakresu — hot path. Wywołujący gwarantuje poprawność. */
  putUnsafe(col: number, row: number, ch: number, color: number): void {
    const i = row * this.cols + col;
    this.chars[i] = ch;
    this.colors[i] = color;
  }

  /** Wersja bezpieczna — dla UI, nie dla renderu świata. */
  put(col: number, row: number, ch: number, color: number): void {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
    const i = row * this.cols + col;
    this.chars[i] = ch;
    this.colors[i] = color;
  }

  /**
   * Wypisuje tekst. Alokuje (charCodeAt na stringu jest tani, ale string już istnieje),
   * więc wolno tego używać wyłącznie w UI, nigdy w pętli renderu świata.
   */
  text(col: number, row: number, s: string, color: number): void {
    for (let k = 0; k < s.length; k++) {
      this.put(col + k, row, s.charCodeAt(k), color);
    }
  }

  /** Zrzut do tekstu — podstawa testów snapshotowych. */
  toText(): string {
    const lines: string[] = [];
    for (let r = 0; r < this.rows; r++) {
      let line = '';
      for (let c = 0; c < this.cols; c++) {
        const ch = this.chars[r * this.cols + c] ?? EMPTY;
        line += ch === EMPTY ? ' ' : String.fromCharCode(ch);
      }
      lines.push(line.replace(/\s+$/, ''));
    }
    return lines.join('\n');
  }
}
