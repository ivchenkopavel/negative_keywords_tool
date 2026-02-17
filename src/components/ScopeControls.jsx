import React from "react";

export default function ScopeControls({
  mode,
  onChangeMode,
  campaigns,
  selectedCampaign,
  onChangeCampaign,
  hasCampaignColumn,
}) {
  const canUseCampaignMode = hasCampaignColumn || (campaigns && campaigns.length);

  return (
    <div className="card">
      <div className="cardRow" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="cardTitle">0) Mode</div>
          <div className="cardHint">
            Choose how you want to collect negatives: one list for the whole account, or separate lists per campaign.
          </div>
          {!canUseCampaignMode ? (
            <div className="subSmall" style={{ marginTop: 8 }}>
              Campaign mode will work best if your CSV contains a <b>Campaign</b> column.
            </div>
          ) : null}
        </div>

        <div className="actions" style={{ alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            <select className="select" value={mode} onChange={(e) => onChangeMode(e.target.value)}>
              <option value="account">Account mode (one list)</option>
              <option value="campaign">Campaign mode (separate lists)</option>
            </select>

            {mode === "campaign" ? (
              <select
                className="select"
                value={selectedCampaign}
                onChange={(e) => onChangeCampaign(e.target.value)}
              >
                {campaigns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
