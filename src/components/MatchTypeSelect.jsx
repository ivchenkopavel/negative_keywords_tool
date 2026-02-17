import React from "react";

export default function MatchTypeSelect({ value, onChange, size }) {
  const cls = size === "sm" ? "select selectSm" : "select";
  return (
    <select className={cls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="exact">exact</option>
      <option value="phrase">phrase</option>
      <option value="broad">broad</option>
    </select>
  );
}
