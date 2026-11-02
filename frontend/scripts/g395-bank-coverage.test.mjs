import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BankCoverage, BankResults, ConnectionNotice, bankCoverageAdvisory, bankCoverageLabel } from "../components/bank-connect/BankConnectionParts.tsx";

const h = React.createElement;
const bank = (overrides = {}) => ({ id: "example", name: "Example Bank", logo: "", ...overrides });

assert.equal(bankCoverageLabel(bank({ supported_kinds: ["current", "savings", "card"] })), null, "full coverage has no extra row line");
assert.equal(bankCoverageAdvisory(bank({ supported_kinds: ["current", "savings", "card"], coverage_captured_on: "2026-11-02" })), "Finexer listing captured 2 Nov 2026. Coverage is not a guarantee.", "full coverage keeps its dated review advisory");
assert.equal(bankCoverageLabel(bank({ supported_kinds: ["current"] })), "Current accounts only", "partial coverage is factual");
assert.equal(bankCoverageLabel(bank({ supported_kinds: [] })), "Coverage unavailable for this bank", "unknown coverage is explicit");
assert.equal(bankCoverageAdvisory(bank({ supported_kinds: [], coverage_captured_on: "2026-11-02" })), null, "unknown coverage remains unavailable without a dated claim");
assert.equal(bankCoverageAdvisory(bank({ supported_kinds: ["current"], coverage_captured_on: "2026-11-02" })), "Finexer listing captured 2 Nov 2026. Coverage is not a guarantee.", "valid API date is rendered in British format");
assert.equal(bankCoverageAdvisory(bank({ supported_kinds: ["current"], coverage_captured_on: "2026-02-30" })), "Coverage is not a guarantee.", "invalid API date never fabricates a capture date");

const partial = bank({ supported_kinds: ["current"] });
const coverageMarkup = renderToStaticMarkup(h(BankCoverage, { bank: partial }));
assert.match(coverageMarkup, /^<span[^>]*data-bank-coverage/, "coverage line is valid inline content for a bank-name span");
assert.match(coverageMarkup, /block text-xs/, "coverage line retains its own visual row");

const rowsMarkup = renderToStaticMarkup(h(BankResults, {
  banks: [partial], query: "", setQuery() {}, searchRef: { current: null }, onChoose() {}, selected: null,
}));
assert.match(rowsMarkup, /aria-label="Choose Example Bank, Current accounts only"/, "the row exposes its coverage in its accessible name");
assert.match(rowsMarkup, /<span[^>]*data-bank-coverage[^>]*>Current accounts only<\/span>/, "the visible coverage stays inside valid span content");
assert.ok(!/<span[^>]*><p/.test(rowsMarkup), "a bank row never nests a paragraph inside a span");

const reviewMarkup = renderToStaticMarkup(h(ConnectionNotice, { bank: { ...partial, coverage_captured_on: "2026-11-02" } }));
assert.match(reviewMarkup, /Finexer listing captured 2 Nov 2026\. Coverage is not a guarantee\./, "the selected-bank review shows the supplied capture date");
const unknownReviewMarkup = renderToStaticMarkup(h(ConnectionNotice, { bank: bank({ supported_kinds: [], coverage_captured_on: null }) }));
assert.match(unknownReviewMarkup, /We cannot show the data available for this bank yet\./, "unknown review coverage remains unavailable");
assert.ok(!unknownReviewMarkup.includes("Finexer listing captured"), "unknown review coverage never invents a capture date");

console.log("G395 bank coverage passed");
