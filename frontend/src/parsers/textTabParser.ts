// frontend/src/parsers/textTabParser.ts
// TODO: test — parseTextTab with various ASCII tab formats (standard, bass, partial)

/**
 * Converts plain-text ASCII guitar tablature into alphaTex format.
 *
 * Input format (6 lines per "system"):
 * e|---0---2---3---|
 * B|---1---3---0---|
 * G|---0---2---0---|
 * D|---2---0---0---|
 * A|---3-------2---|
 * E|-----------3---|
 *
 * Output: alphaTex string renderable by alphaTab's api.tex()
 */

interface TabColumn {
  notes: Map<number, number>; // string index (1-6) -> fret number
}

export function parseTextTab(input: string): string {
  const lines = input.split("\n");
  const systems = extractSystems(lines);
  const columns = systems.flatMap(parseSystem);

  if (columns.length === 0) {
    throw new Error("No valid tablature found in input");
  }

  return columnsToAlphaTex(columns);
}

function extractSystems(lines: string[]): string[][] {
  const systems: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (isTabLine(trimmed)) {
      current.push(trimmed);
    } else {
      if (current.length >= 4) {
        systems.push(current);
      }
      current = [];
    }
  }
  if (current.length >= 4) systems.push(current);

  return systems;
}

function isTabLine(line: string): boolean {
  return /^[a-gA-G]?\|[\d\-hpbs/\\|~()x ]+\|?\s*$/.test(line) ||
         /^\|[\d\-hpbs/\\|~()x ]+\|?\s*$/.test(line);
}

function parseSystem(systemLines: string[]): TabColumn[] {
  const rawLines = systemLines.map(line => {
    const match = line.match(/^[a-gA-G]?\|(.+?)\|?\s*$/);
    return match ? match[1] : line;
  });

  const maxLen = Math.max(...rawLines.map(l => l.length));
  const padded = rawLines.map(l => l.padEnd(maxLen, "-"));

  const columns: TabColumn[] = [];
  const skipCols = new Set<number>();

  for (let col = 0; col < maxLen; col++) {
    if (skipCols.has(col)) continue;

    const notes = new Map<number, number>();
    for (let stringIdx = 0; stringIdx < padded.length; stringIdx++) {
      const char = padded[stringIdx][col];
      if (/\d/.test(char)) {
        let fretStr = char;
        if (col + 1 < maxLen && /\d/.test(padded[stringIdx][col + 1])) {
          fretStr += padded[stringIdx][col + 1];
          skipCols.add(col + 1);
        }
        notes.set(stringIdx + 1, parseInt(fretStr, 10));
      }
    }
    if (notes.size > 0) {
      columns.push({ notes });
    }
  }

  return columns;
}

function columnsToAlphaTex(columns: TabColumn[]): string {
  // alphaTex format reference: https://alphatab.net/docs/alphatex/introduction
  let tex = "\\title \"Imported Tab\"\n";
  tex += "\\tempo 120\n";
  tex += "\\instrument 25\n"; // Steel string acoustic guitar
  tex += "\\staff{tabs}\n";
  tex += ".\n"; // Start of music — dot separates metadata from notes
  tex += ":4 "; // Set default duration to quarter notes

  const beatsPerBar = 4;
  for (let i = 0; i < columns.length; i++) {
    if (i > 0 && i % beatsPerBar === 0) {
      tex += " | ";
    }

    const col = columns[i];
    if (col.notes.size === 1) {
      const [stringIdx, fret] = [...col.notes.entries()][0];
      tex += `${fret}.${stringIdx} `;
    } else {
      const noteStrs = [...col.notes.entries()].map(([s, f]) => `${f}.${s}`);
      tex += `(${noteStrs.join(" ")}) `;
    }
  }

  return tex.trim();
}
