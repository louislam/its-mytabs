// frontend/src/parsers/ugParser.ts
// TODO: test — parseUGContent with chord sheets and raw tab content

import ChordSheetJS from "chordsheetjs";
import { parseTextTab } from "./textTabParser";

export interface ParsedUGContent {
  type: "chords" | "tab";
  title?: string;
  artist?: string;
  chordHtml?: string;
  alphaTex?: string;
  song?: any; // ChordSheetJS Song object
}

/**
 * Parse content from Ultimate Guitar.
 * The user pastes tab/chord text directly (copied from UG page)
 * or pastes UG page HTML source containing the JSON data store.
 * We do NOT fetch from UG servers.
 */
export function parseUGContent(input: string): ParsedUGContent {
  const jsonContent = extractUGJson(input);
  const content = jsonContent ?? input;

  if (looksLikeChordSheet(content)) {
    return parseChordSheet(content);
  } else {
    return parseRawTab(content);
  }
}

function extractUGJson(html: string): string | null {
  const match = html.match(/data-content="([^"]+)"/);
  if (!match) return null;

  try {
    const decoded = match[1]
      .replace(/&quot;/g, "\"")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

    const data = JSON.parse(decoded);
    const tabContent = data?.store?.page?.data?.tab_view?.wiki_tab?.content
      ?? data?.store?.page?.data?.tab?.content;
    return tabContent ?? null;
  } catch {
    return null;
  }
}

function looksLikeChordSheet(content: string): boolean {
  const chordLineCount = content.split("\n").filter(line =>
    /\[?[A-G][#b]?(?:m|maj|min|dim|aug|sus|add|7|9|11|13)?\]?/.test(line) &&
    !/\|/.test(line)
  ).length;

  const tabLineCount = content.split("\n").filter(line =>
    /^[a-gA-G]?\|[\d\-]+\|?\s*$/.test(line.trim())
  ).length;

  return chordLineCount > tabLineCount;
}

function parseChordSheet(content: string): ParsedUGContent {
  const cleaned = content
    .replace(/\[ch\]/g, "[")
    .replace(/\[\/ch\]/g, "]")
    .replace(/\[tab\]/g, "")
    .replace(/\[\/tab\]/g, "");

  const parser = new ChordSheetJS.UltimateGuitarParser();
  const song = parser.parse(cleaned);

  const formatter = new ChordSheetJS.HtmlDivFormatter();
  const chordHtml = formatter.format(song);

  return {
    type: "chords",
    title: song.title ?? undefined,
    artist: song.artist ?? undefined,
    chordHtml,
    song,
  };
}

function parseRawTab(content: string): ParsedUGContent {
  const alphaTex = parseTextTab(content);
  return {
    type: "tab",
    alphaTex,
  };
}
