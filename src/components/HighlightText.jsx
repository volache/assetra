import React from "react";
import { normalized, variantRegexSource } from "../features/inventory/search";

export function HighlightText({ value, terms }) {
  const text = String(value || "");
  const needles = [
    ...new Set(
      terms
        .map((term) =>
          // \* \? \\ are literal characters; bare * and ? are wildcards.
          String(term)
            .replace(/^"|"$/g, "")
            .replace(/\\([*?\\])/g, "\u0000$1\u0000")
            .replace(/[?*]/g, "")
            .replace(/\u0000(.)\u0000/g, "$1")
            .trim(),
        )
        .filter(Boolean),
    ),
  ].sort((a, b) => b.length - a.length);
  if (!text || !needles.length) return text || "—";
  const pattern = new RegExp(
    `(${needles.map((term) => variantRegexSource(term)).join("|")})`,
    "giu",
  );
  return text
    .split(pattern)
    .map((part, index) =>
      normalized(part) &&
      needles.some((term) => normalized(part) === normalized(term)) ? (
        <mark key={index}>{part}</mark>
      ) : (
        part
      ),
    );
}
