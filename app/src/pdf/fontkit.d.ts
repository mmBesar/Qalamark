// Minimal typing for the parts of fontkit the PDF writer uses.
declare module 'fontkit' {
  export interface Glyph { id: number; codePoints: number[]; advanceWidth: number; path: { commands: Array<{ command: string; args: number[] }> } }
  export interface Position { xAdvance: number; yAdvance: number; xOffset: number; yOffset: number }
  export interface GlyphRun { glyphs: Glyph[]; positions: Position[]; advanceWidth: number }
  export interface Subset { includeGlyph(g: Glyph | number): number; encode(): Uint8Array | { buffer: ArrayBuffer }; encodeStream?: unknown }
  export interface Font {
    unitsPerEm: number; ascent: number; descent: number; lineGap: number; capHeight: number; xHeight: number; bbox: { minX: number; minY: number; maxX: number; maxY: number };
    familyName: string; postscriptName: string; numGlyphs: number;
    hasGlyphForCodePoint(cp: number): boolean;
    glyphForCodePoint(cp: number): Glyph;
    getGlyph(id: number): Glyph;
    layout(text: string, features?: unknown, script?: string, language?: string, direction?: string): GlyphRun;
    createSubset(): Subset;
  }
  export function create(data: Uint8Array): Font;
}
