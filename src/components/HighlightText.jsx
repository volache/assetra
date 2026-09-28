import React from "react";
import { normalized } from "../features/inventory/search";

export function HighlightText({ value, terms }) {
  const text = String(value || "");
  const needles = [
    ...new Set(
      terms
        .map((term) =>
          String(term).replace(/^"|"$/g, "").replace(/[?*]/g, "").trim(),
        )
        .filter(Boolean),
    ),
  ].sort((a, b) => b.length - a.length);
  if (!text || !needles.length) return text || "—";
  const pattern = new RegExp(
    `(${needles.map((term) => term.replace(/[.*+^${}()|[\]\\]/g, "\\$&")).join("|")})`,
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
