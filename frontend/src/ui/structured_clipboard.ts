import type { Json } from '../contracts/ports.js';
export interface StructuredClipboardPort {
  writeText(text: string): Promise<void>;
  remember(text: string, matrix: Json[][]): void;
  recall(text: string): Json[][] | null;
  clear(): void;
}
/** Explicit host-owned clipboard cache; selection, history and documents never live here. */
export function createStructuredClipboard(writeText: (text: string) => Promise<void>): StructuredClipboardPort {
  let saved: {text: string; matrix: Json[][]} | null = null;
  return {
    writeText,
    remember(text, matrix) { saved = {text, matrix: structuredClone(matrix)}; },
    recall(text) { return saved?.text === text ? structuredClone(saved.matrix) : null; },
    clear() { saved = null; },
  };
}
