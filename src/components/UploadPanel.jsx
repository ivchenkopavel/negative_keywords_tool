import React, { useRef } from "react";

export default function UploadPanel({ onFile, filename, warnings, error }) {
  const inputRef = useRef(null);

  async function handlePickedFile(file) {
    if (!file) return;
    await onFile(file);

    // Allow picking the same file again (otherwise onChange won't fire)
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handlePickedFile(file);
  }

  return (
    <div
      className="card"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      title="Tip: you can also drag & drop a CSV file here"
    >
      <div className="cardRow">
        <div>
          <div className="cardTitle">1) Upload Search Terms report (CSV)</div>
          <div className="cardHint">
            Export from Google Ads → Search terms → Download.
          </div>
          {filename ? <div className="pill">Loaded: {filename}</div> : null}
          {error ? (
            <div className="pill pillDanger" style={{ marginTop: 8 }}>
              {error}
            </div>
          ) : null}
          {!error && warnings?.length ? (
            <div className="pill" style={{ marginTop: 8 }}>
              {warnings[0]}
            </div>
          ) : null}
        </div>

        <div className="actions">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handlePickedFile(file);
            }}
          />
          <button className="btn" onClick={() => inputRef.current?.click()}>
            Choose CSV
          </button>
        </div>
      </div>

      <div className="subSmall" style={{ marginTop: 10 }}>
        Drag & drop also works.
      </div>
    </div>
  );
}
