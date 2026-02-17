import React, { useEffect, useMemo, useReducer } from "react";
import UploadPanel from "../components/UploadPanel.jsx";
import ReportTable from "../components/ReportTable.jsx";
import NegativePanel from "../components/NegativePanel.jsx";
import ScopeControls from "../components/ScopeControls.jsx";
import { parseSearchTermsCsv } from "../features/report/parseSearchTermsCsv.js";
import { formatNegative } from "../features/negatives/formatNegative.js";

const initialState = {
  report: {
    columns: [],
    rows: [],
    filename: null,
    searchTermColumnName: null,
    campaignColumnName: null,
    adGroupColumnName: null,
    warnings: [],
    error: null,
  },
  negatives: {
    items: [], // Account mode: { id, text, matchType }
    byCampaign: {}, // Campaign mode: { [campaignName]: Array<{ id, text, matchType }> }
  },
  ui: {
    markedRowIds: new Set(), // rows that were added as FULL terms
    mode: "account", // 'account' | 'campaign'
    selectedCampaign: "", // used in campaign mode
  },
};

const UNKNOWN_CAMPAIGN = "Unknown campaign";

function normKey(s) {
  return String(s || "").trim().toLowerCase();
}

function normCampaignName(s) {
  const c = String(s || "").trim();
  return c || UNKNOWN_CAMPAIGN;
}

function extractCampaigns(rows) {
  const set = new Set();
  for (const r of rows || []) {
    // Ignore special rows (meta/totals) when building the campaign dropdown.
    if (r?.__rowType && r.__rowType !== "data") continue;

    const raw = String(r?.campaign ?? "").trim();
    if (!raw) continue;
    set.add(raw);
  }
  const arr = Array.from(set);
  arr.sort((a, b) => a.localeCompare(b));
  return arr.length ? arr : [UNKNOWN_CAMPAIGN];
}

function reducer(state, action) {
  switch (action.type) {
    case "REPORT_LOADED": {
      const campaigns = extractCampaigns(action.payload.rows);
      return {
        ...state,
        report: {
          columns: action.payload.columns,
          rows: action.payload.rows,
          filename: action.payload.filename,
          searchTermColumnName: action.payload.searchTermColumnName,
          campaignColumnName: action.payload.campaignColumnName,
          adGroupColumnName: action.payload.adGroupColumnName,
          warnings: action.payload.warnings || [],
          error: null,
        },
        ui: {
          ...state.ui,
          markedRowIds: new Set(),
          // Keep the user's current mode, but reset selection sensibly
          selectedCampaign:
            state.ui.mode === "campaign" ? (campaigns[0] || UNKNOWN_CAMPAIGN) : "",
        },
        negatives: { items: [], byCampaign: {} },
      };
    }

    case "REPORT_ERROR": {
      return {
        ...state,
        report: {
          columns: [],
          rows: [],
          filename: action.payload.filename || null,
          searchTermColumnName: null,
          campaignColumnName: null,
          adGroupColumnName: null,
          warnings: [],
          error: action.payload.error || "Failed to load report",
        },
        ui: { ...state.ui, markedRowIds: new Set(), selectedCampaign: "" },
        negatives: { items: [], byCampaign: {} },
      };
    }

    case "SET_MODE": {
      const mode = action.payload.mode;
      if (mode !== "account" && mode !== "campaign") return state;

      let selectedCampaign = state.ui.selectedCampaign;
      if (mode === "campaign") {
        const campaigns = extractCampaigns(state.report.rows);
        if (!campaigns.includes(selectedCampaign)) {
          selectedCampaign = campaigns[0] || UNKNOWN_CAMPAIGN;
        }
      }

      return { ...state, ui: { ...state.ui, mode, selectedCampaign } };
    }

    case "SET_SELECTED_CAMPAIGN": {
      return { ...state, ui: { ...state.ui, selectedCampaign: action.payload.campaign } };
    }

    case "ADD_NEGATIVE": {
      const text = action.payload.text?.trim();
      if (!text) return state;

      const matchType = action.payload.matchType || "phrase";
      const scope = action.payload.scope || state.ui.mode;
      const campaign = normCampaignName(action.payload.campaign);

      const existsInList = (list) =>
        list.some((x) => normKey(x.text) === normKey(text));

      const nextMarked = new Set(state.ui.markedRowIds);
      if (action.payload.markRow && action.payload.rowId != null) {
        nextMarked.add(action.payload.rowId);
      }

      if (scope === "campaign") {
        const current = state.negatives.byCampaign[campaign] || [];

        if (existsInList(current)) {
          return { ...state, ui: { ...state.ui, markedRowIds: nextMarked } };
        }

        const next = [...current, { id: crypto.randomUUID(), text, matchType }];
        return {
          ...state,
          negatives: {
            ...state.negatives,
            byCampaign: { ...state.negatives.byCampaign, [campaign]: next },
          },
          ui: { ...state.ui, markedRowIds: nextMarked },
        };
      }

      // account scope
      if (existsInList(state.negatives.items)) {
        return { ...state, ui: { ...state.ui, markedRowIds: nextMarked } };
      }

      const nextItems = [...state.negatives.items, { id: crypto.randomUUID(), text, matchType }];
      return {
        ...state,
        negatives: { ...state.negatives, items: nextItems },
        ui: { ...state.ui, markedRowIds: nextMarked },
      };
    }

    case "REMOVE_NEGATIVE_BY_TEXT": {
      const text = (action.payload.text || "").trim().toLowerCase();
      if (!text) return state;

      const scope = action.payload.scope || state.ui.mode;
      const campaign = normCampaignName(action.payload.campaign);

      const removeFromList = (list) =>
        list.filter((x) => normKey(x.text) !== normKey(text));

      const nextMarked = new Set(state.ui.markedRowIds);
      if (action.payload.unmarkRow && action.payload.rowId != null) {
        nextMarked.delete(action.payload.rowId);
      }

      if (scope === "campaign") {
        const current = state.negatives.byCampaign[campaign] || [];
        const next = removeFromList(current);
        return {
          ...state,
          negatives: {
            ...state.negatives,
            byCampaign: { ...state.negatives.byCampaign, [campaign]: next },
          },
          ui: { ...state.ui, markedRowIds: nextMarked },
        };
      }

      const nextItems = removeFromList(state.negatives.items);
      return {
        ...state,
        negatives: { ...state.negatives, items: nextItems },
        ui: { ...state.ui, markedRowIds: nextMarked },
      };
    }

    case "REMOVE_NEGATIVE": {
      const { id } = action.payload;
      const scope = action.payload.scope || state.ui.mode;
      const campaign = normCampaignName(action.payload.campaign);

      let removed = null;
      let nextItems = state.negatives.items;
      let nextByCampaign = state.negatives.byCampaign;

      if (scope === "campaign") {
        const current = state.negatives.byCampaign[campaign] || [];
        removed = current.find((x) => x.id === id) || null;
        const next = current.filter((x) => x.id !== id);
        nextByCampaign = { ...state.negatives.byCampaign, [campaign]: next };
      } else {
        removed = state.negatives.items.find((x) => x.id === id) || null;
        nextItems = state.negatives.items.filter((x) => x.id !== id);
      }

      const nextMarked = new Set(state.ui.markedRowIds);
      if (removed) {
        state.report.rows.forEach((r) => {
          const sameText = normKey(r.searchTerm) === normKey(removed.text);
          const sameCampaign =
            scope !== "campaign" || normCampaignName(r.campaign) === campaign;

          if (sameText && sameCampaign) nextMarked.delete(r.__rowId);
        });
      }

      return {
        ...state,
        negatives: { ...state.negatives, items: nextItems, byCampaign: nextByCampaign },
        ui: { ...state.ui, markedRowIds: nextMarked },
      };
    }

    case "UPDATE_NEGATIVE_MATCH_TYPE": {
      const { id, matchType } = action.payload;
      const scope = action.payload.scope || state.ui.mode;
      const campaign = normCampaignName(action.payload.campaign);

      if (scope === "campaign") {
        const current = state.negatives.byCampaign[campaign] || [];
        const next = current.map((x) => (x.id === id ? { ...x, matchType } : x));
        return {
          ...state,
          negatives: {
            ...state.negatives,
            byCampaign: { ...state.negatives.byCampaign, [campaign]: next },
          },
        };
      }

      const nextItems = state.negatives.items.map((x) =>
        x.id === id ? { ...x, matchType } : x
      );
      return { ...state, negatives: { ...state.negatives, items: nextItems } };
    }

    default:
      return state;
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const campaigns = useMemo(() => extractCampaigns(state.report.rows), [state.report.rows]);

  // Keep selected campaign valid when report changes
  useEffect(() => {
    if (state.ui.mode !== "campaign") return;
    if (!campaigns.includes(state.ui.selectedCampaign)) {
      dispatch({ type: "SET_SELECTED_CAMPAIGN", payload: { campaign: campaigns[0] } });
    }
  }, [state.ui.mode, state.ui.selectedCampaign, campaigns.join("||")]);

  // Build lookup maps (account + per-campaign) for quick UI checks
  const negativeMaps = useMemo(() => {
    const account = new Map();
    for (const item of state.negatives.items) {
      account.set(normKey(item.text), item);
    }

    const byCampaign = {};
    for (const [campaign, list] of Object.entries(state.negatives.byCampaign || {})) {
      const map = new Map();
      for (const item of list || []) {
        map.set(normKey(item.text), item);
      }
      byCampaign[campaign] = map;
    }

    return { account, byCampaign };
  }, [state.negatives.items, state.negatives.byCampaign]);

  const EMPTY_MAP = useMemo(() => new Map(), []);

  function getNegativeMapForRow(row) {
    if (state.ui.mode === "account") return negativeMaps.account;
    const campaign = normCampaignName(row?.campaign);
    return negativeMaps.byCampaign[campaign] || EMPTY_MAP;
  }

  const activeCampaign =
    state.ui.mode === "campaign" ? normCampaignName(state.ui.selectedCampaign) : null;

  const activeItems = useMemo(() => {
    if (state.ui.mode === "account") return state.negatives.items;
    return state.negatives.byCampaign[activeCampaign] || [];
  }, [state.ui.mode, state.negatives.items, state.negatives.byCampaign, activeCampaign]);

  const formattedNegatives = useMemo(() => {
    return activeItems.map((x) => formatNegative(x.text, x.matchType));
  }, [activeItems]);

  const allCampaignCopyText = useMemo(() => {
    if (state.ui.mode !== "campaign") return "";

    const parts = [];
    for (const campaign of campaigns) {
      const list = state.negatives.byCampaign[campaign] || [];
      if (!list.length) continue;
      parts.push(`# ${campaign}`);
      for (const item of list) {
        const line = formatNegative(item.text, item.matchType);
        if (line) parts.push(line);
      }
      parts.push("");
    }

    return parts.join("\n").trim();
  }, [state.ui.mode, campaigns, state.negatives.byCampaign]);

  async function handleFile(file) {
    try {
      const parsed = await parseSearchTermsCsv(file);
      dispatch({
        type: "REPORT_LOADED",
        payload: { ...parsed, filename: file.name },
      });
    } catch (e) {
      dispatch({
        type: "REPORT_ERROR",
        payload: { filename: file.name, error: e?.message || String(e) },
      });
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <div className="title">Google Ads Negative Keywords Tool</div>
          <div className="subtitle">
            Upload Search Terms report → collect negative keywords.
          </div>
        </div>
      </header>

      <div className="grid">
        <section className="panel panel-blue">
          <div className="panelTitle">Google Ads UI</div>

          <ScopeControls
            mode={state.ui.mode}
            onChangeMode={(mode) => dispatch({ type: "SET_MODE", payload: { mode } })}
            campaigns={campaigns}
            selectedCampaign={state.ui.selectedCampaign}
            onChangeCampaign={(campaign) =>
              dispatch({ type: "SET_SELECTED_CAMPAIGN", payload: { campaign } })
            }
            hasCampaignColumn={!!state.report.campaignColumnName}
          />

          <UploadPanel
            onFile={handleFile}
            filename={state.report.filename}
            warnings={state.report.warnings}
            error={state.report.error}
          />

          <ReportTable
            columns={state.report.columns}
            rows={
              state.ui.mode === "campaign"
                ? state.report.rows.filter((r) =>
                    // Always keep special rows (meta/totals). Filter only data rows.
                    r?.__rowType !== "data" || normCampaignName(r.campaign) === activeCampaign
                  )
                : state.report.rows
            }
            searchTermColumnName={state.report.searchTermColumnName}
            markedRowIds={state.ui.markedRowIds}
            getNegativeMapForRow={getNegativeMapForRow}
            onAddFullTerm={(text, rowId, row) =>
              dispatch({
                type: "ADD_NEGATIVE",
                payload: {
                  text,
                  rowId,
                  markRow: true,
                  matchType: "exact", // full phrase default → exact
                  scope: state.ui.mode,
                  campaign: row?.campaign,
                },
              })
            }
            onRemoveFullTerm={(text, rowId, row) =>
              dispatch({
                type: "REMOVE_NEGATIVE_BY_TEXT",
                payload: {
                  text,
                  rowId,
                  unmarkRow: true,
                  scope: state.ui.mode,
                  campaign: row?.campaign,
                },
              })
            }
            onToggleWord={(text, row) => {
              const key = normKey(text);
              if (!key) return;

              const map = getNegativeMapForRow(row);
              const payloadBase = {
                text,
                unmarkRow: false,
                scope: state.ui.mode,
                campaign: row?.campaign,
              };

              if (map && map.has(key)) {
                dispatch({
                  type: "REMOVE_NEGATIVE_BY_TEXT",
                  payload: payloadBase,
                });
                return;
              }

              dispatch({
                type: "ADD_NEGATIVE",
                payload: {
                  text,
                  markRow: false,
                  matchType: "broad", // single word default → broad
                  scope: state.ui.mode,
                  campaign: row?.campaign,
                },
              });
            }}
          />
        </section>

        <section className="panel panel-yellow">
          <div className="panelTitle">Extension UI</div>

          <div className="stickyWrap">
            <NegativePanel
              mode={state.ui.mode}
              selectedCampaign={activeCampaign}
              items={activeItems}
              formattedLines={formattedNegatives}
              allCampaignCopyText={allCampaignCopyText}
              onRemove={(id) =>
                dispatch({
                  type: "REMOVE_NEGATIVE",
                  payload: { id, scope: state.ui.mode, campaign: activeCampaign },
                })
              }
              onChangeMatchType={(id, matchType) =>
                dispatch({
                  type: "UPDATE_NEGATIVE_MATCH_TYPE",
                  payload: { id, matchType, scope: state.ui.mode, campaign: activeCampaign },
                })
              }
            />
          </div>
        </section>
      </div>
    </div>
  );
}



