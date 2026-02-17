import Papa from "papaparse";

/**
 * Google Ads "Search terms" CSV export parser.
 *
 * Many exports contain 1–N meta lines before the real header row, e.g.:
 *   Search terms report
 *   10 February 2026 - 13 February 2026
 *   Search term,Match type,Campaign,...
 *
 * We auto-detect the real header row, parse the table, and also:
 * - inject the detected date range as a special first row (rowType = "meta")
 * - keep totals rows and re-order them to a stable order (rowType = "total")
 */
export async function parseSearchTermsCsv(file) {
  const textRaw0 = await file.text();
  const textRaw = stripBom(String(textRaw0 || ""));

  // Parse without header first, to detect where the real header row starts.
  const scan = Papa.parse(textRaw, {
    header: false,
    skipEmptyLines: true,
    beforeFirstChunk: (chunk) => stripBom(String(chunk || "")),
  });

  const scanRows = (scan.data || []).filter(Boolean);

  const warnings = [];
  if (scan?.errors?.length) {
    const top = scan.errors[0];
    warnings.push(`CSV parse warning: ${top?.message || "Unknown parsing issue"}`);
  }

  const headerRowIndex = findHeaderRowIndex(scanRows);
  if (headerRowIndex === -1) {
    // Fallback: try the simple header-based parse (some exports might be "clean")
    return parseSimpleHeaderCsv(textRaw, warnings);
  }

  const preambleLines = scanRows
    .slice(0, headerRowIndex)
    .map(joinRowCells)
    .filter(Boolean);

  const columns = normalizeColumns(scanRows[headerRowIndex]);

  const tableRows = scanRows.slice(headerRowIndex + 1);
  const rawRows = tableRows.map((cells) => mapRowToObject(columns, cells));

  const searchTermCol = detectSearchTermColumn(columns);
  const campaignCol = detectCampaignColumn(columns);
  const adGroupCol = detectAdGroupColumn(columns);

  // Build special meta row (date range) if present in the preamble.
  const dateRange = extractDateRange(preambleLines);
  const metaRows = [];
  if (dateRange) {
    const metaObj = emptyObjectForColumns(columns);
    metaObj[searchTermCol || columns[0]] = dateRange;
    metaRows.push({
      __rowId: "meta-date-range",
      __rowType: "meta",
      ...metaObj,
      searchTerm: String(dateRange || ""),
      campaign: "",
      adGroup: "",
    });
  }

  const dataRows = [];
  const totalRows = [];

  rawRows.forEach((r, idx) => {
    const term = String(r?.[searchTermCol] ?? "");
    const rowOut = {
      __rowId: idx + 1,
      ...r,
      searchTerm: term,
      campaign: campaignCol ? String(r?.[campaignCol] ?? "") : "",
      adGroup: adGroupCol ? String(r?.[adGroupCol] ?? "") : "",
    };

    if (isTotalLabel(term)) {
      totalRows.push({ ...rowOut, __rowType: "total" });
    } else {
      dataRows.push({ ...rowOut, __rowType: "data" });
    }
  });

  const orderedTotals = sortTotals(totalRows, searchTermCol);

  return {
    columns,
    rows: [...metaRows, ...dataRows, ...orderedTotals],
    searchTermColumnName: searchTermCol,
    campaignColumnName: campaignCol,
    adGroupColumnName: adGroupCol,
    warnings,
    meta: {
      preambleLines,
      dateRange: dateRange || null,
    },
  };
}

/** -----------------------------
 * Header detection + mapping
 * ------------------------------*/

function stripBom(s) {
  return String(s || "").replace(/^\uFEFF/, "");
}

function joinRowCells(row) {
  if (!Array.isArray(row)) return String(row || "").trim();
  return row
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .join(", ")
    .trim();
}

function normalizeColumns(headerCells) {
  const cols = Array.isArray(headerCells) ? headerCells : [headerCells];
  return cols.map((h, i) => {
    const cleaned = stripBom(String(h ?? "")).trim();
    return cleaned || `Column ${i + 1}`;
  });
}

function mapRowToObject(columns, cells) {
  const arr = Array.isArray(cells) ? cells : [cells];
  const obj = {};
  for (let i = 0; i < columns.length; i += 1) {
    obj[columns[i]] = arr[i] ?? "";
  }
  return obj;
}

function emptyObjectForColumns(columns) {
  const obj = {};
  for (const c of columns || []) obj[c] = "";
  return obj;
}

function findHeaderRowIndex(rows) {
  for (let i = 0; i < (rows || []).length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    // Heuristic: header row should have several columns and contain
    // something that looks like "Search term".
    if (row.length < 3) continue;

    const normCells = row.map((c) => normalizeHeader(c));
    const hasSearchTerm = normCells.some((k) => isSearchTermHeaderKey(k));
    if (hasSearchTerm) return i;
  }
  return -1;
}

/** Fallback parser (when there's no preamble and the file starts with the header row). */
function parseSimpleHeaderCsv(textRaw, inheritedWarnings = []) {
  const parsed = Papa.parse(textRaw, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => stripBom(String(h || "")).trim(),
    beforeFirstChunk: (chunk) => stripBom(String(chunk || "")),
  });

  const rawRows = parsed.data || [];
  const rawCols = parsed.meta?.fields || [];

  const warnings = [...(inheritedWarnings || [])];
  if (parsed?.errors?.length) {
    const top = parsed.errors[0];
    warnings.push(`CSV parse warning: ${top?.message || "Unknown parsing issue"}`);
  }

  const searchTermCol = detectSearchTermColumn(rawCols);
  const campaignCol = detectCampaignColumn(rawCols);
  const adGroupCol = detectAdGroupColumn(rawCols);

  const rows = rawRows.map((r, i) => {
    const normalizedRow = r || {};
    return {
      __rowId: i + 1,
      __rowType: isTotalLabel(String(normalizedRow?.[searchTermCol] ?? ""))
        ? "total"
        : "data",
      ...normalizedRow,
      searchTerm: String(normalizedRow?.[searchTermCol] ?? ""),
      campaign: campaignCol ? String(normalizedRow?.[campaignCol] ?? "") : "",
      adGroup: adGroupCol ? String(normalizedRow?.[adGroupCol] ?? "") : "",
    };
  });

  return {
    columns: rawCols.length ? rawCols : [searchTermCol || "Search term"],
    rows,
    searchTermColumnName: searchTermCol,
    campaignColumnName: campaignCol,
    adGroupColumnName: adGroupCol,
    warnings,
    meta: { preambleLines: [], dateRange: null },
  };
}

/** -----------------------------
 * Totals row handling
 * ------------------------------*/

function isTotalLabel(term) {
  const k = normalizeHeader(term);
  return k.startsWith("total:") || k.startsWith("итого:") || k.startsWith("всего:");
}

function totalBucket(term) {
  const cleaned = String(term || "").trim();
  const parts = cleaned.split(":");
  if (parts.length < 2) return normalizeHeader(cleaned);
  return normalizeHeader(parts.slice(1).join(":").trim());
}

function sortTotals(totalRows, searchTermCol) {
  const order = [
    "performance max",
    "display",
    "demand gen",
    "account",
    "filtered search terms",
    "search",
  ];

  const rank = (row) => {
    const label = String(row?.[searchTermCol] ?? row?.searchTerm ?? "");
    const bucket = totalBucket(label);
    const idx = order.indexOf(bucket);
    return idx === -1 ? 999 : idx;
  };

  return [...(totalRows || [])].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;

    // Secondary: alphabetical by bucket
    const ba = totalBucket(String(a?.[searchTermCol] ?? a?.searchTerm ?? ""));
    const bb = totalBucket(String(b?.[searchTermCol] ?? b?.searchTerm ?? ""));
    return ba.localeCompare(bb);
  });
}

/** -----------------------------
 * Search term / campaign detection (multi-language)
 * ------------------------------*/

function normalizeHeader(h) {
  return stripBom(String(h || ""))
    .trim()
    .toLowerCase();
}

function isSearchTermHeaderKey(key) {
  const exactCandidates = new Set([
    // English
    "search term",
    "search terms",
    "customer search term",
    "search query",
    "queries",
    // Russian
    "поисковый запрос",
    "поисковые запросы",
    "поисковый термин",
    "поисковые термины",
    "поисковая фраза",
    "поисковые фразы",
  ]);

  if (exactCandidates.has(key)) return true;

  // Heuristics
  const en =
    key.includes("search") && (key.includes("term") || key.includes("query"));
  const ru =
    (key.includes("поиск") || key.includes("поисков")) &&
    (key.includes("запрос") || key.includes("термин") || key.includes("фраз"));

  return en || ru;
}

/**
 * Try to find the column name that represents Search Term.
 */
function detectSearchTermColumn(cols) {
  if (!cols || !cols.length) return "Search term";

  const normalized = cols.map((c) => ({ original: c, key: normalizeHeader(c) }));

  const exactCandidates = new Set([
    // English
    "search term",
    "search terms",
    "customer search term",
    "search query",
    "queries",
    // Russian
    "поисковый запрос",
    "поисковые запросы",
    "поисковый термин",
    "поисковые термины",
    "поисковая фраза",
    "поисковые фразы",
  ]);

  const exact = normalized.find((x) => exactCandidates.has(x.key));
  if (exact) return exact.original;

  const enHeuristic = normalized.find(
    (x) => x.key.includes("search") && (x.key.includes("term") || x.key.includes("query"))
  );
  if (enHeuristic) return enHeuristic.original;

  const ruHeuristic = normalized.find((x) => {
    const k = x.key;
    return (
      (k.includes("поиск") || k.includes("поисков")) &&
      (k.includes("запрос") || k.includes("термин") || k.includes("фраз"))
    );
  });
  if (ruHeuristic) return ruHeuristic.original;

  // Last resort
  return cols[0];
}

/**
 * Campaign column name (if present).
 */
function detectCampaignColumn(cols) {
  if (!cols || !cols.length) return null;
  const normalized = cols.map((c) => ({ original: c, key: normalizeHeader(c) }));

  const exactCandidates = new Set([
    "campaign",
    "campaign name",
    "campaigns",
    "кампания",
    "кампании",
    "имя кампании",
  ]);

  const exact = normalized.find((x) => exactCandidates.has(x.key));
  if (exact) return exact.original;

  const heuristic = normalized.find((x) => x.key.includes("campaign") || x.key.includes("кампан"));
  return heuristic?.original ?? null;
}

/**
 * Ad group column name (if present).
 */
function detectAdGroupColumn(cols) {
  if (!cols || !cols.length) return null;
  const normalized = cols.map((c) => ({ original: c, key: normalizeHeader(c) }));

  const exactCandidates = new Set([
    "ad group",
    "adgroup",
    "ad group name",
    "ad groups",
    "группа объявлений",
    "группы объявлений",
    "группа",
  ]);

  const exact = normalized.find((x) => exactCandidates.has(x.key));
  if (exact) return exact.original;

  const heuristic = normalized.find((x) => {
    const k = x.key;
    return (
      k.includes("ad group") ||
      k.includes("adgroup") ||
      (k.includes("групп") && k.includes("объяв"))
    );
  });

  return heuristic?.original ?? null;
}

/** -----------------------------
 * Meta extraction
 * ------------------------------*/

function extractDateRange(lines) {
  // Prefer explicit date range lines like: "10 February 2026 - 13 February 2026"
  // We keep the original line as-is.
  const candidates = (lines || []).map((x) => String(x || "").trim()).filter(Boolean);

  const dateRangeRegex =
    /(\d{1,2}\s+[A-Za-zА-Яа-я]+\s+\d{4})\s*[-–—]\s*(\d{1,2}\s+[A-Za-zА-Яа-я]+\s+\d{4})/;

  const hit = candidates.find((l) => dateRangeRegex.test(l));
  if (hit) return hit;

  // Fallback: first line that contains a year and a dash
  const loose = candidates.find((l) => /\d{4}/.test(l) && /[-–—]/.test(l));
  return loose || null;
}
