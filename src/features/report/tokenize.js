/**
 * Tokenize a search term into “words” for clickable chips.
 * Works with Cyrillic and other non-Latin alphabets.
 *
 * Examples:
 *  - "купить iphone 15 pro" -> ["купить","iphone","15","pro"]
 *  - "s-cool" -> ["s-cool"]
 *  - "д'артаньян" -> ["д'артаньян"]
 */
export function tokenizeSearchTerm(input) {
  const s = String(input || "").trim();
  if (!s) return [];

  // Unicode letters/numbers + allow internal - ' ’
  // Requires modern JS (supported by Vite/modern browsers)
  const re = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;

  const matches = s.match(re);
  if (!matches) return [];

  return matches
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 60); // safety cap
}

