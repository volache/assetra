import React from "react";
import { highlightPatternSource } from "../features/inventory/search";

// terms are search words (strings, wildcards and \ escapes allowed) or
// { cell: true } when the whole value is what matched, e.g. a comparison.
function highlightPlan(terms, numeric) {
  const sources = [
    ...new Set(
      terms
        .filter((term) => typeof term === "string")
        .map((term) => highlightPatternSource(term, { numeric }))
        .filter(Boolean),
    ),
  ].sort((a, b) => b.length - a.length);
  return {
    cell: terms.some((term) => term && typeof term === "object" && term.cell),
    pattern: sources.length
      ? new RegExp(sources.map((source) => `(?:${source})`).join("|"), "giu")
      : null,
  };
}

const isMeaningful = (text) => Boolean(text) && text !== "—";

export function HighlightText({ value, terms, numeric = false }) {
  const text = String(value ?? "");
  if (!text) return "—";
  const { cell, pattern } = highlightPlan(terms, numeric);
  if (cell && isMeaningful(text))
    return <mark>{text}</mark>;
  if (!pattern) return text;
  const nodes = [];
  let last = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (!match[0]) {
      pattern.lastIndex += 1;
      continue;
    }
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(<mark key={match.index}>{match[0]}</mark>);
    last = match.index + match[0].length;
  }
  if (!nodes.length) return text;
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
