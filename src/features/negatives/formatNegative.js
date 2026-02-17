export function formatNegative(text, matchType) {
  const t = (text || "").trim();
  if (!t) return "";

  if (matchType === "exact") return `[${t}]`;
  if (matchType === "phrase") return `"${t}"`;
  return t; // broad
}
