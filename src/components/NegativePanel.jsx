import React from "react";
import MatchTypeSelect from "./MatchTypeSelect.jsx";

export default function NegativePanel({
  mode,
  selectedCampaign,
  items,
  formattedLines,
  allCampaignCopyText,
  onRemove,
  onChangeMatchType,
}) {
  async function copyText(text) {
    const t = String(text || "");
    if (!t.trim()) return;

    try {
      await navigator.clipboard.writeText(t);
      alert("Copied to clipboard ✅");
      return;
    } catch (e) {
      // Fallback for non-secure contexts / older permissions
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      alert("Copied to clipboard ✅");
    }
  }

  async function copyCurrent() {
    const text = formattedLines.filter(Boolean).join("\n");
    await copyText(text);
  }

  async function copyAllCampaigns() {
    await copyText(allCampaignCopyText);
  }

  return (
    <div className="card stickyCard">
      <div className="cardRow">
        <div>
          <div className="cardTitle">Negative keywords</div>
          <div className="cardHint">
            Defaults: <b>full term → exact</b>, <b>word → broad</b>. You can change each item.
          </div>
          {mode === "campaign" ? (
            <div className="subSmall" style={{ marginTop: 6 }}>
              Campaign: <b>{selectedCampaign}</b>
            </div>
          ) : null}
        </div>

        <div className="actions">
          <button className="btn" onClick={copyCurrent} disabled={!items.length}>
            Copy list
          </button>

          {mode === "campaign" ? (
            <button
              className="btn"
              onClick={copyAllCampaigns}
              disabled={!allCampaignCopyText || !allCampaignCopyText.trim()}
              title="Copy a grouped list for every campaign"
            >
              Copy all
            </button>
          ) : null}
        </div>
      </div>

      {!items.length ? (
        <div className="empty">No negatives yet. Add some from the table.</div>
      ) : (
        <div className="negList">
          {items.map((x, idx) => (
            <div key={x.id} className="negItem negItemRed">
              <div className="negLeft">
                <div className="mono">{formattedLines[idx]}</div>
                <div className="subSmall">raw: {x.text}</div>
              </div>

              <div className="negRight">
                <MatchTypeSelect
                  value={x.matchType}
                  onChange={(v) => onChangeMatchType(x.id, v)}
                  size="sm"
                />
                <button className="iconBtn danger" onClick={() => onRemove(x.id)}>
                  x
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


