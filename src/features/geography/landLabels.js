export function landAssetNumberParts(value) {
  const parts = String(value || "")
    .split("-")
    .filter(Boolean);
  if (parts.length >= 3)
    return { primary: parts.slice(-3, -1).join("-"), serial: parts.at(-1) };
  return { primary: String(value || "—"), serial: "" };
}

export function parcelLabel(section, landNumber) {
  return [section, landNumber].filter(Boolean).join(" ") || "—";
}
