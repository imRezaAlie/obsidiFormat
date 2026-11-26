import {
  FORMAT_ACTIONS,
  INDENT_UNITS,
  SELECTED_FORMATS,
  FormatError,
  MAX_INPUT,
  MAX_OUTPUT,
  type FormatAction,
  type FormatResult,
  type IndentUnit,
  type SelectedFormat,
} from "../types";
import { detect } from "./FormatDetector";
import { decodeJson, formatJson } from "./JsonFormatter";
import { guard } from "./limits";
import { deepDecodeXml, looksEncodedXml } from "./entities";
import { formatXml, parseXml } from "./XmlFormatter";

export { detect } from "./FormatDetector";
export { escapeString, unescapeString } from "./JsonFormatter";
export { decodeXmlEntities, encodeXmlEntities, deepDecodeXml, looksEncodedXml } from "./entities";
export { FormatError, MAX_INPUT, MAX_OUTPUT };

function assertAction(action: string): asserts action is FormatAction {
  if (!(FORMAT_ACTIONS as readonly string[]).includes(action)) throw new Error("Unsupported operation.");
}
function assertFormat(selected: string): asserts selected is SelectedFormat {
  if (!(SELECTED_FORMATS as readonly string[]).includes(selected)) throw new Error("Unsupported format.");
}
function assertUnit(unit: string): asserts unit is IndentUnit {
  if (!(INDENT_UNITS as readonly string[]).includes(unit)) throw new Error("Unsupported indentation.");
}

export function process(text: string, action: FormatAction = "beautify", selected: SelectedFormat = "auto", unit: IndentUnit = "  "): FormatResult {
  guard(text);
  assertAction(action);
  assertFormat(selected);
  assertUnit(unit);
  const language = selected === "auto" ? detect(text) : selected;
  if (language === "encoded-xml") {
    throw new FormatError("Input is entity-encoded XML. Use XML Tools > Decode & Beautify, or enable auto-decode in Settings.", text);
  }
  if (language === "empty") throw new FormatError("Input is empty. Paste code or load a sample to begin.", text);
  if (language === "json") return formatJson(text, action, unit);
  if (language === "xml" || language === "soap") return formatXml(text, action, unit, language);
  throw new FormatError("Unsupported format.", text);
}

export function decode(text: string, unit: IndentUnit): FormatResult {
  return decodeJson(text, unit, (value) => process(value, "beautify", "json", unit));
}

export function decodeXmlDocument(text: string, action: FormatAction = "beautify", unit: IndentUnit = "  ", selected: SelectedFormat = "auto"): FormatResult {
  guard(text);
  assertAction(action);
  assertFormat(selected);
  assertUnit(unit);
  const decoded = deepDecodeXml(text);
  if (!decoded.text.trimStart().startsWith("<")) {
    throw new FormatError("No complete XML document exposed within 20 decoding layers.", text);
  }
  const language: SelectedFormat = selected === "soap" || selected === "xml" ? selected : "auto";
  try {
    return { ...process(decoded.text, action, language, unit), layers: decoded.layers };
  } catch (error) {
    if (!decoded.layers) throw error;
    const message = error instanceof Error ? error.message : "Invalid XML.";
    const line = error instanceof FormatError ? error.line : undefined;
    const column = error instanceof FormatError ? error.column : undefined;
    throw new FormatError(`Decoded XML is invalid: ${message}${line ? ` (decoded line ${line}, column ${column})` : ""}`, text);
  }
}

function elementPath(el: Element): string {
  const names: string[] = [];
  for (let node: Element | null = el; node && names.length < 24; node = node.parentElement) names.push(node.nodeName);
  return (names.length === 24 ? ".../" : "/") + names.reverse().join("/");
}

export function extractEmbedded(text: string, kind: "xml" | "json" = "xml", unit: IndentUnit = "  "): FormatResult {
  guard(text);
  if (kind !== "xml" && kind !== "json") throw new Error("Unsupported embedded format.");
  const outer = decodeXmlDocument(text, "validate", unit);
  const doc = parseXml(outer.text);
  const walker = doc.createTreeWalker(doc, 1);
  const matches: Array<{ path: string; text: string; language: string }> = [];
  let skipped = 0;
  let total = 0;
  for (let el = walker.nextNode() as Element | null; el; el = walker.nextNode() as Element | null) {
    if (el.childElementCount) continue;
    const value = (el.textContent ?? "").trim();
    if (!value) continue;
    const candidate = kind === "xml" ? value.startsWith("<") || looksEncodedXml(value) : /^[{["\\]/.test(value);
    if (!candidate) continue;
    let result: FormatResult;
    try {
      result = kind === "xml" ? decodeXmlDocument(value, "beautify", unit) : decode(value, unit);
    } catch {
      skipped++;
      continue;
    }
    const path = elementPath(el);
    total += result.text.length + path.length + 80;
    if (total > MAX_OUTPUT || matches.length >= 1000) {
      throw new FormatError("Embedded preview exceeds its safety limit (64 Mi characters or 1,000 documents).", text);
    }
    matches.push({ path, text: result.text, language: result.language });
  }
  if (!matches.length) {
    throw new FormatError(
      `No valid embedded ${kind.toUpperCase()} document found in leaf text or CDATA.${skipped ? ` ${skipped} candidate(s) were invalid or blocked.` : ""}`,
      text,
    );
  }
  const result =
    matches.length === 1
      ? { text: matches[0]?.text ?? "", language: matches[0]?.language ?? kind }
      : {
          text: matches.map((match, index) => `--- Embedded ${kind.toUpperCase()} ${index + 1}: ${match.path} ---\n${match.text}`).join("\n\n"),
          language: "text",
        };
  return { ...result, count: matches.length, skipped, paths: matches.map((match) => match.path) };
}

