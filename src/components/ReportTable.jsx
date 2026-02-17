import React, { useMemo, useState } from "react";
import { tokenizeSearchTerm } from "../features/report/tokenize.js";

/* -----------------------------
   Helpers
------------------------------ */

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

function hasValue(v) {
  const s = String(v ?? "").trim();
  return s !== "" && s !== "—" && s !== "-";
}

function formatMetaItem(label, value) {
  return `${label}: ${String(value ?? "").trim()}`;
}

/**
 * Locale-robust number parsing for Google Ads exports.
 * Handles values like:
 *  - "€1,234.56"
 *  - "1 234,56"
 *  - "1,234" (thousand) or "1,23" (decimal)
 */
function parseMetricNumber(value) {
  if (value == null) return Number.NEGATIVE_INFINITY;

  let s = String(value).trim();
  if (!s || s === "—" || s === "-") return Number.NEGATIVE_INFINITY;

  // Keep digits, separators, and minus
  s = s.replace(/[^\d,.\-]/g, "");

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");

  // If there are both '.' and ',', last one is decimal separator
  if (lastDot !== -1 && lastComma !== -1) {
    const decSep = lastDot > lastComma ? "." : ",";
    const thouSep = decSep === "." ? "," : ".";
    s = s.split(thouSep).join("");
    if (decSep === ",") s = s.replace(",", ".");
    return safeParseFloat(s);
  }

  // Only comma present
  if (lastComma !== -1 && lastDot === -1) {
    const after = s.length - lastComma - 1;
    if (after >= 1 && after <= 2) {
      // last comma is decimal, others are thousand separators
      const parts = s.split(",");
      const dec = parts.pop();
      s = parts.join("") + "." + dec;
      return safeParseFloat(s);
    }
    // thousands separators
    s = s.split(",").join("");
    return safeParseFloat(s);
  }

  // Only dot present
  if (lastDot !== -1 && lastComma === -1) {
    const after = s.length - lastDot - 1;
    if (after >= 1 && after <= 2) {
      // decimal dot, remove other dots
      const parts = s.split(".");
      const dec = parts.pop();
      s = parts.join("") + "." + dec;
      return safeParseFloat(s);
    }
    // thousands separators
    s = s.split(".").join("");
    return safeParseFloat(s);
  }

  return safeParseFloat(s);
}

function safeParseFloat(s) {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

/* -----------------------------
   Strong column detection (order-independent)
   Goal: cost in UI always equals "Cost" in CSV (never Cost/conv, never Conv. rate, etc.)
------------------------------ */

function pickBestColumn(columns, scoreFn) {
  let best = null;
  let bestScore = 0;

  for (const col of columns || []) {
    const k = norm(col);
    const score = scoreFn(k);
    if (score > bestScore) {
      bestScore = score;
      best = col;
    }
  }
  return best;
}

function isCostPerConvKey(k) {
  return (
    /cost\s*\/\s*conv/.test(k) ||
    k.includes("cost/conv") ||
    k.includes("cost per conv") ||
    k.includes("cost per conversion") ||
    k.includes("cpa") ||
    (k.includes("стоим") && k.includes("конв")) ||
    (k.includes("расход") && k.includes("конв"))
  );
}

function isConversionRateKey(k) {
  return (
    k.includes("conv. rate") ||
    k.includes("conversion rate") ||
    k.includes("конв. коэф") ||
    (k.includes("конвер") && k.includes("коэф")) ||
    k.includes("%")
  );
}

function detectMetricColumnsStrong(columns) {
  const cols = columns || [];

  const costPerConv = pickBestColumn(cols, (k) => {
    if (isCostPerConvKey(k)) return 100;
    return 0;
  });

  const cost = pickBestColumn(cols, (k) => {
    // ❗ Exclude cost/conv explicitly so "Cost / conv." can never become "Cost"
    if (isCostPerConvKey(k)) return 0;

    // Best matches
    if (k === "cost") return 120;
    if (/^cost\s*\(.+\)$/.test(k)) return 115; // Cost (USD), Cost (SGD), etc.

    // RU equivalents
    if (k === "расход" || /^расход\s*\(.+\)$/.test(k)) return 120;
    if (k === "стоимость" || /^стоимость\s*\(.+\)$/.test(k)) return 120;

    // Weak matches: allow only if NOT containing conv/per/rate
    if (
      k.includes("cost") &&
      !k.includes("per") &&
      !k.includes("conv") &&
      !k.includes("conversion") &&
      !k.includes("rate") &&
      !k.includes("/")
    )
      return 60;

    if (
      (k.includes("расход") || k.includes("стоимость")) &&
      !k.includes("конв") &&
      !k.includes("коэф") &&
      !k.includes("/")
    )
      return 60;

    return 0;
  });

  const impr = pickBestColumn(cols, (k) => {
    if (k === "impr." || k === "impressions") return 110;
    if (k.startsWith("impr")) return 80;
    if (k.includes("impression")) return 80;
    if (k.includes("показ")) return 90;
    return 0;
  });

  const clicks = pickBestColumn(cols, (k) => {
    if (k === "clicks" || k === "click") return 110;
    if (k.includes("click")) return 80;
    if (k.includes("клик")) return 80;
    return 0;
  });

  const conv = pickBestColumn(cols, (k) => {
    // ❗ Never map conversions to conversion rate
    if (isConversionRateKey(k)) return 0;

    if (k === "conversions") return 110;
    if (/^conv\.?$/.test(k)) return 105;
    if (k.includes("conversion")) return 80;
    if (k.includes("конверс")) return 85;

    return 0;
  });

  return { cost, impr, clicks, conv, costPerConv };
}

/* -----------------------------
   Component
------------------------------ */

export default function ReportTable({
  columns,
  rows,
  searchTermColumnName,
  markedRowIds,
  getNegativeMapForRow,
  onAddFullTerm,
  onRemoveFullTerm,
  onToggleWord,
}) {
  const [filter, setFilter] = useState("");

  // sortKey: "cost" | "impr" | "clicks" | "conv" | "cpcv" | null
  // sortDir: "desc" | "asc" | null
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState(null);

  // ✅ Strong, order-independent mapping
  const metrics = useMemo(() => detectMetricColumnsStrong(columns), [columns]);

  const availableSort = useMemo(() => {
    return {
      cost: !!metrics.cost,
      impr: !!metrics.impr,
      clicks: !!metrics.clicks,
      conv: !!metrics.conv,
      cpcv: !!metrics.costPerConv,
    };
  }, [metrics]);

  function cycleSort(nextKey) {
    if (sortKey !== nextKey) {
      setSortKey(nextKey);
      setSortDir("desc");
      return;
    }
    if (sortDir === "desc") setSortDir("asc");
    else if (sortDir === "asc") {
      setSortKey(null);
      setSortDir(null);
    } else setSortDir("desc");
  }

  function isInNegatives(text, row) {
    const key = String(text || "").trim().toLowerCase();
    if (!key) return false;
    const map = getNegativeMapForRow ? getNegativeMapForRow(row) : null;
    return !!(map && map.has(key));
  }

  const visibleRows = useMemo(() => {
    const q = filter.trim().toLowerCase();

    const metaRows = [];
    const totalRows = [];
    let dataRows = [];

    for (const r of rows || []) {
      const rowType = r?.__rowType || "data";
      if (rowType === "meta") {
        metaRows.push(r);
        continue;
      }
      if (rowType === "total") {
        totalRows.push(r);
        continue;
      }
      dataRows.push(r);
    }

    // Filter only data rows
    if (q) {
      dataRows = dataRows.filter((r) => {
        const term = String(r?.searchTerm ?? "").toLowerCase();
        const camp = String(r?.campaign ?? "").toLowerCase();
        return term.includes(q) || camp.includes(q);
      });
    }

    // Sort only data rows (meta top, totals bottom)
    if (sortKey && sortDir) {
      const colName =
        sortKey === "cost"
          ? metrics.cost
          : sortKey === "impr"
          ? metrics.impr
          : sortKey === "clicks"
          ? metrics.clicks
          : sortKey === "conv"
          ? metrics.conv
          : sortKey === "cpcv"
          ? metrics.costPerConv
          : null;

      if (colName) {
        const mul = sortDir === "asc" ? 1 : -1;
        dataRows = [...dataRows].sort((a, b) => {
          const av = parseMetricNumber(a?.[colName]);
          const bv = parseMetricNumber(b?.[colName]);

          const aMiss = av === Number.NEGATIVE_INFINITY;
          const bMiss = bv === Number.NEGATIVE_INFINITY;
          if (aMiss && bMiss) return 0;
          if (aMiss) return 1;
          if (bMiss) return -1;

          if (av === bv) return 0;
          return av > bv ? 1 * mul : -1 * mul;
        });
      }
    }

    return [...metaRows, ...dataRows, ...totalRows];
  }, [rows, filter, sortKey, sortDir, metrics]);

  function renderSearchTermCell(row) {
    const rowType = row?.__rowType || "data";
    const isSpecial = rowType !== "data";

    const termRaw =
      searchTermColumnName && row?.[searchTermColumnName] != null
        ? row[searchTermColumnName]
        : row?.searchTerm ?? "";

    const term = String(termRaw ?? "");

    // meta/totals rows: show plain
    if (isSpecial) {
      return (
        <div className={rowType === "total" ? "termTitle termTitleTotal" : "termTitle"}>
          {term}
        </div>
      );
    }

    // meta line under chips
    const metaParts = [];
    if (metrics.cost && hasValue(row?.[metrics.cost]))
      metaParts.push(formatMetaItem("Cost", row[metrics.cost]));
    if (metrics.impr && hasValue(row?.[metrics.impr]))
      metaParts.push(formatMetaItem("Impr.", row[metrics.impr]));
    if (metrics.clicks && hasValue(row?.[metrics.clicks]))
      metaParts.push(formatMetaItem("Clicks", row[metrics.clicks]));
    if (metrics.conv && hasValue(row?.[metrics.conv]))
      metaParts.push(formatMetaItem("Conv.", row[metrics.conv]));
    if (metrics.costPerConv && hasValue(row?.[metrics.costPerConv]))
      metaParts.push(formatMetaItem("Cost/conv.", row[metrics.costPerConv]));

    // chips only
    let tokens = tokenizeSearchTerm(term);
    if ((!tokens || tokens.length === 0) && term.trim()) tokens = [term.trim()];

    return (
      <div title={term}>
        {tokens.length ? (
          <div className="chips termChips">
            {tokens.map((w, idx) => {
              const inList = isInNegatives(w, row);
              return (
                <button
                  key={`${w}-${idx}`}
                  className={`chip ${inList ? "chipOn" : ""}`}
                  title={inList ? "Remove from negatives" : "Add to negatives"}
                  onClick={() => onToggleWord(w, row)}
                >
                  {w}
                  {inList ? <span className="chipX">×</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}

        {metaParts.length ? (
          <div className="termMeta" style={{ marginTop: 10 }}>
            {metaParts.map((x) => (
              <span key={x} className="termMetaItem">
                {x}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function renderCampaignCell(row) {
    const rowType = row?.__rowType || "data";
    if (rowType !== "data") return "";
    return String(row?.campaign ?? "").trim() || "—";
  }

  const sortLabel = (k) =>
    k === "cost"
      ? "Cost"
      : k === "impr"
      ? "Impr."
      : k === "clicks"
      ? "Clicks"
      : k === "conv"
      ? "Conv."
      : k === "cpcv"
      ? "Cost/conv."
      : "";

  const dirSymbol = sortDir === "desc" ? "↓" : sortDir === "asc" ? "↑" : "";

  const hasData = rows?.length;

  return (
    <div className="card">
      <div className="cardRow">
        <div>
          <div className="cardTitle">2) Search terms</div>
          <div className="cardHint">
            Row <b>+</b> adds the whole term (exact). Click a <b>word chip</b> to add/remove that word (broad).
          </div>
        </div>

        <input
          className="input"
          placeholder="Filter by term or campaign…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {/* Sort controls */}
      <div className="sortBar">
        <div className="sortTitle">
          Sort{sortKey && sortDir ? `: ${sortLabel(sortKey)} ${dirSymbol}` : ": off"}
        </div>

        <div className="sortBtns">
          <button
            className={`btn btnSort ${sortKey === "cost" && sortDir ? "btnSortOn" : ""}`}
            disabled={!availableSort.cost}
            onClick={() => cycleSort("cost")}
          >
            Cost {sortKey === "cost" ? dirSymbol : ""}
          </button>

          <button
            className={`btn btnSort ${sortKey === "impr" && sortDir ? "btnSortOn" : ""}`}
            disabled={!availableSort.impr}
            onClick={() => cycleSort("impr")}
          >
            Impr. {sortKey === "impr" ? dirSymbol : ""}
          </button>

          <button
            className={`btn btnSort ${sortKey === "clicks" && sortDir ? "btnSortOn" : ""}`}
            disabled={!availableSort.clicks}
            onClick={() => cycleSort("clicks")}
          >
            Clicks {sortKey === "clicks" ? dirSymbol : ""}
          </button>

          <button
            className={`btn btnSort ${sortKey === "conv" && sortDir ? "btnSortOn" : ""}`}
            disabled={!availableSort.conv}
            onClick={() => cycleSort("conv")}
          >
            Conv. {sortKey === "conv" ? dirSymbol : ""}
          </button>

          <button
            className={`btn btnSort ${sortKey === "cpcv" && sortDir ? "btnSortOn" : ""}`}
            disabled={!availableSort.cpcv}
            onClick={() => cycleSort("cpcv")}
          >
            Cost/conv. {sortKey === "cpcv" ? dirSymbol : ""}
          </button>
        </div>
      </div>

      {!hasData ? (
        <div className="empty">Upload a CSV to render the report table here.</div>
      ) : (
        <div className="tableWrap">
          <table className="table tableCompact">
            <thead>
              <tr>
                <th style={{ width: 96 }}>Actions</th>
                <th>Search term</th>
                <th style={{ width: 320 }}>Campaign</th>
              </tr>
            </thead>

            <tbody>
              {visibleRows.map((r) => {
                const rowType = r?.__rowType || "data";
                const isSpecial = rowType !== "data";

                const fullTermInList = !isSpecial && isInNegatives(r.searchTerm, r);
                const isMarked = markedRowIds?.has(r.__rowId) || fullTermInList;

                return (
                  <tr
                    key={r.__rowId}
                    className={
                      isSpecial
                        ? rowType === "total"
                          ? "rowTotal"
                          : "rowMeta"
                        : isMarked
                        ? "rowMarkedRed"
                        : ""
                    }
                  >
                    <td>
                      {isSpecial ? null : (
                        <>
                          <button
                            className="iconBtn"
                            title="Add whole term to negative list"
                            onClick={() => onAddFullTerm(r.searchTerm, r.__rowId, r)}
                          >
                            +
                          </button>

                          <button
                            className={`iconBtn danger ${fullTermInList ? "" : "iconBtnDisabled"}`}
                            title="Remove whole term from negative list"
                            disabled={!fullTermInList}
                            onClick={() => onRemoveFullTerm(r.searchTerm, r.__rowId, r)}
                          >
                            x
                          </button>
                        </>
                      )}
                    </td>

                    <td>{renderSearchTermCell(r)}</td>
                    <td>{renderCampaignCell(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


