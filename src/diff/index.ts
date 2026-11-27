/**
 * Structural payload diff. JSON is read with a small token reader so duplicate
 * keys and numbers outside IEEE-754 precision stay meaningful; XML is checked
 * before DOMParser runs so DTDs and external entities are never resolved.
 */
import { detect, process } from "../formatters";
import { builder, guard } from "../formatters/limits";
import { parseXml } from "../formatters/XmlFormatter";
import { FormatError, type SelectedFormat } from "../types";

export type DiffLanguage = "json" | "xml" | "soap";
export type DiffKind = "add" | "remove" | "change";

export interface DiffChange {
  kind: DiffKind;
  path: string;
  left: string | null;
  right: string | null;
}

export interface DiffResult {
  language: DiffLanguage;
  equal: boolean;
  changes: DiffChange[];
  report: string;
}

const MAX_CHANGES = 1000;
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

class ChangeCollector {
  readonly changes: DiffChange[] = [];
  truncated = false;

  add(change: DiffChange): void {
    if (this.changes.length >= MAX_CHANGES) {
      this.truncated = true;
      return;
    }
    this.changes.push(change);
  }
}

function languageOf(text: string, selected: SelectedFormat): DiffLanguage {
  const language = selected === "auto" ? detect(text) : selected;
  if (language === "encoded-xml") throw new FormatError("Decode encoded XML before comparing it.", text);
  if (language !== "json" && language !== "xml" && language !== "soap") throw new FormatError("Unsupported payload format.", text);
  return language;
}

function label(language: DiffLanguage): string {
  return language === "json" ? "JSON" : language === "soap" ? "SOAP" : "XML";
}

function summary(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Compare numeric spelling without floating-point rounding. */
function numberKey(token: string): string {
  const parts = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!parts) return token;
  const sign = parts[1] === "-" ? "-" : "";
  let digits = `${parts[2]}${parts[3] ?? ""}`.replace(/^0+/, "");
  let exponent = Number(parts[4] ?? 0) - (parts[3]?.length ?? 0);
  if (!digits) return "0";
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    exponent++;
  }
  return `${sign}${digits}${exponent === 0 ? "" : `e${exponent}`}`;
}

interface JsonPrimitive {
  kind: "primitive";
  type: "string" | "number" | "boolean" | "null";
  key: string;
  display: string;
}
interface JsonArray {
  kind: "array";
  items: JsonValue[];
}
interface JsonObject {
  kind: "object";
  entries: Map<string, JsonValue[]>;
}
type JsonValue = JsonPrimitive | JsonArray | JsonObject;

class JsonReader {
  private index = 0;

  constructor(private readonly text: string) {}

  parse(): JsonValue {
    this.skip();
    const value = this.value();
    this.skip();
    if (this.index !== this.text.length) this.fail("Unexpected content after the JSON value.");
    return value;
  }

  private fail(message: string, offset = this.index): never {
    throw new FormatError(message, this.text, offset);
  }

  private skip(): void {
    while (this.index < this.text.length && /[\x20\t\r\n]/.test(this.text[this.index] ?? "")) this.index++;
  }

  private string(): string {
    const start = this.index++;
    let out = "";
    const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
    while (this.index < this.text.length) {
      const ch = this.text[this.index++] ?? "";
      if (ch === '"') return out;
      if (ch !== "\\") {
        out += ch;
        continue;
      }
      const escape = this.text[this.index++] ?? "";
      if (escape === "u") {
        let code = 0;
        for (let digit = 0; digit < 4; digit++) {
          const hex = Number.parseInt(this.text[this.index++] ?? "", 16);
          if (!Number.isFinite(hex)) this.fail("Invalid Unicode escape in JSON string.", start);
          code = code * 16 + hex;
        }
        out += String.fromCharCode(code);
        continue;
      }
      const value = escapes[escape];
      if (value === undefined) this.fail("Invalid JSON escape sequence.", this.index - 1);
      out += value;
    }
    this.fail("Unterminated JSON string.", start);
  }

  private value(): JsonValue {
    this.skip();
    const ch = this.text[this.index];
    if (ch === "{") return this.object();
    if (ch === "[") return this.array();
    if (ch === '"') {
      const decoded = this.string();
      return { kind: "primitive", type: "string", key: `s:${decoded}`, display: JSON.stringify(decoded) };
    }
    if (ch === "-" || (ch !== undefined && ch >= "0" && ch <= "9")) {
      NUMBER.lastIndex = this.index;
      const matched = NUMBER.exec(this.text);
      if (!matched) this.fail("Invalid JSON number.");
      this.index = NUMBER.lastIndex;
      return { kind: "primitive", type: "number", key: `n:${numberKey(matched[0])}`, display: matched[0] };
    }
    if (this.text.startsWith("true", this.index) || this.text.startsWith("false", this.index)) {
      const token = this.text.startsWith("true", this.index) ? "true" : "false";
      this.index += token.length;
      return { kind: "primitive", type: "boolean", key: `b:${token}`, display: token };
    }
    if (this.text.startsWith("null", this.index)) {
      this.index += 4;
      return { kind: "primitive", type: "null", key: "null", display: "null" };
    }
    this.fail("Expected a JSON value.");
  }

  private object(): JsonValue {
    this.index++;
    const entries = new Map<string, JsonValue[]>();
    this.skip();
    if (this.text[this.index] === "}") {
      this.index++;
      return { kind: "object", entries };
    }
    while (this.index < this.text.length) {
      this.skip();
      const key = this.string();
      this.skip();
      if (this.text[this.index] !== ":") this.fail("Expected a colon after a property name.");
      this.index++;
      const value = this.value();
      const values = entries.get(key) ?? [];
      values.push(value);
      entries.set(key, values);
      this.skip();
      const next = this.text[this.index++];
      if (next === "}") return { kind: "object", entries };
      if (next !== ",") this.fail("Expected a comma or '}'.");
    }
    this.fail("Unterminated JSON object.");
  }

  private array(): JsonValue {
    this.index++;
    const items: JsonValue[] = [];
    this.skip();
    if (this.text[this.index] === "]") {
      this.index++;
      return { kind: "array", items };
    }
    while (this.index < this.text.length) {
      items.push(this.value());
      this.skip();
      const next = this.text[this.index++];
      if (next === "]") return { kind: "array", items };
      if (next !== ",") this.fail("Expected a comma or ']'.");
      this.skip();
    }
    this.fail("Unterminated JSON array.");
  }
}

function displayJson(value: JsonValue): string {
  if (value.kind === "primitive") return value.display;
  if (value.kind === "array") return `Array(${value.items.length})`;
  return `Object(${value.entries.size} key${value.entries.size === 1 ? "" : "s"})`;
}

function jsonPath(parent: string, key: string): string {
  return /^[A-Za-z_][\w-]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function compareJson(left: JsonValue, right: JsonValue, path: string, changes: ChangeCollector): void {
  if (left.kind !== right.kind) {
    changes.add({ kind: "change", path, left: displayJson(left), right: displayJson(right) });
    return;
  }
  if (left.kind === "primitive" && right.kind === "primitive") {
    if (left.key !== right.key) changes.add({ kind: "change", path, left: left.display, right: right.display });
    return;
  }
  if (left.kind === "array" && right.kind === "array") {
    const shared = Math.min(left.items.length, right.items.length);
    for (let index = 0; index < shared; index++) compareJson(left.items[index]!, right.items[index]!, `${path}[${index}]`, changes);
    for (let index = shared; index < left.items.length; index++) {
      changes.add({ kind: "remove", path: `${path}[${index}]`, left: displayJson(left.items[index]!), right: null });
    }
    for (let index = shared; index < right.items.length; index++) {
      changes.add({ kind: "add", path: `${path}[${index}]`, left: null, right: displayJson(right.items[index]!) });
    }
    return;
  }
  if (left.kind === "object" && right.kind === "object") {
    const keys = [...new Set([...left.entries.keys(), ...right.entries.keys()])].sort();
    for (const key of keys) {
      const childPath = jsonPath(path, key);
      const before = left.entries.get(key) ?? [];
      const after = right.entries.get(key) ?? [];
      if (!before.length) {
        for (const value of after) changes.add({ kind: "add", path: childPath, left: null, right: displayJson(value) });
        continue;
      }
      if (!after.length) {
        for (const value of before) changes.add({ kind: "remove", path: childPath, left: displayJson(value), right: null });
        continue;
      }
      if (before.length !== after.length) {
        changes.add({ kind: "change", path: childPath, left: `${before.length} value(s)`, right: `${after.length} value(s)` });
      }
      const shared = Math.min(before.length, after.length);
      for (let index = 0; index < shared; index++) compareJson(before[index]!, after[index]!, childPath, changes);
    }
  }
}

interface XmlElement {
  kind: "element";
  key: string;
  name: string;
  attrs: Map<string, { display: string; value: string }>;
  children: XmlNode[];
}
interface XmlText {
  kind: "text";
  value: string;
}
type XmlNode = XmlElement | XmlText;

function readXml(text: string): XmlElement {
  const document = parseXml(text);
  const root = document.documentElement;
  if (!root) throw new FormatError("Missing XML document element.", text);
  return elementNode(root);
}

function elementKey(element: Element): string {
  const namespace = element.namespaceURI ?? "";
  const local = element.localName ?? element.nodeName;
  return namespace ? `{${namespace}}${local}` : local;
}

function attributeKey(attribute: Attr): string {
  const namespace = attribute.namespaceURI ?? "";
  const local = attribute.localName ?? attribute.name;
  return namespace ? `{${namespace}}${local}` : local;
}

function elementNode(element: Element, inheritedPreserve = false): XmlElement {
  const attrs = new Map<string, { display: string; value: string }>();
  for (let index = 0; index < element.attributes.length; index++) {
    const attribute = element.attributes.item(index);
    if (!attribute || attribute.name === "xmlns" || attribute.name.startsWith("xmlns:")) continue;
    attrs.set(attributeKey(attribute), { display: attribute.localName ?? attribute.name, value: collapse(attribute.value) });
  }
  const space = element.getAttributeNS(XML_NS, "space");
  const preserve = space === "preserve" || (space !== "default" && inheritedPreserve);
  const children: XmlNode[] = [];
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1) {
      children.push(elementNode(node as Element, preserve));
      continue;
    }
    if (node.nodeType !== 3 && node.nodeType !== 4) continue;
    const raw = node.textContent ?? "";
    const value = preserve ? raw : collapse(raw);
    if (preserve ? value.length > 0 : value.length > 0) children.push({ kind: "text", value });
  }
  return { kind: "element", key: elementKey(element), name: element.localName ?? element.nodeName, attrs, children };
}

function compareXml(left: XmlNode, right: XmlNode, parent: string, changes: ChangeCollector): void {
  if (left.kind !== right.kind) {
    changes.add({ kind: "change", path: parent || "/", left: left.kind === "text" ? summary(left.value) : left.name, right: right.kind === "text" ? summary(right.value) : right.name });
    return;
  }
  if (left.kind === "text" && right.kind === "text") {
    if (left.value !== right.value) changes.add({ kind: "change", path: parent, left: summary(left.value), right: summary(right.value) });
    return;
  }
  if (left.kind !== "element" || right.kind !== "element") return;
  const here = `${parent}/${left.name}`;
  if (left.key !== right.key) {
    changes.add({ kind: "change", path: here, left: left.name, right: right.name });
    return;
  }
  const attrKeys = [...new Set([...left.attrs.keys(), ...right.attrs.keys()])].sort((a, b) => {
    const leftName = left.attrs.get(a)?.display ?? right.attrs.get(a)?.display ?? a;
    const rightName = left.attrs.get(b)?.display ?? right.attrs.get(b)?.display ?? b;
    return leftName.localeCompare(rightName);
  });
  for (const key of attrKeys) {
    const before = left.attrs.get(key);
    const after = right.attrs.get(key);
    const path = `${here}/@${before?.display ?? after?.display ?? key}`;
    if (!before) changes.add({ kind: "add", path, left: null, right: summary(after?.value ?? "") });
    else if (!after) changes.add({ kind: "remove", path, left: summary(before.value), right: null });
    else if (before.value !== after.value) changes.add({ kind: "change", path, left: summary(before.value), right: summary(after.value) });
  }
  const shared = Math.min(left.children.length, right.children.length);
  for (let index = 0; index < shared; index++) {
    const before = left.children[index]!;
    const after = right.children[index]!;
    const childParent = before.kind === "text" ? `${here}/#text[${index}]` : here;
    compareXml(before, after, childParent, changes);
  }
  for (let index = shared; index < left.children.length; index++) {
    const before = left.children[index]!;
    changes.add({ kind: "remove", path: before.kind === "text" ? `${here}/#text[${index}]` : `${here}/${before.name}`, left: before.kind === "text" ? summary(before.value) : before.name, right: null });
  }
  for (let index = shared; index < right.children.length; index++) {
    const after = right.children[index]!;
    changes.add({ kind: "add", path: after.kind === "text" ? `${here}/#text[${index}]` : `${here}/${after.name}`, left: null, right: after.kind === "text" ? summary(after.value) : after.name });
  }
}

function reportOf(language: DiffLanguage, changes: ChangeCollector): string {
  const out = builder();
  const name = label(language);
  if (!changes.changes.length && !changes.truncated) return `${name}: no structural differences.\n`;
  const suffix = changes.truncated ? " (showing first 1,000)" : "";
  out.add(`${name}: ${changes.changes.length} structural difference${changes.changes.length === 1 ? "" : "s"}${suffix}\n\n`);
  for (const change of changes.changes) {
    const mark = change.kind === "add" ? "+" : change.kind === "remove" ? "-" : "~";
    out.add(`${mark} ${change.path}\n`);
    if (change.left !== null) out.add(`    left:  ${change.left}\n`);
    if (change.right !== null) out.add(`    right: ${change.right}\n`);
  }
  return out.text();
}

/** Compare two payloads structurally. Empty, invalid, or mixed-format input throws FormatError. */
export function diffPayloads(leftText: string, rightText: string, selected: SelectedFormat = "auto"): DiffResult {
  guard(leftText);
  guard(rightText);
  const language = languageOf(leftText, selected);
  const other = languageOf(rightText, selected);
  if (language !== other) throw new FormatError(`Cannot compare ${label(language)} with ${label(other)}.`, leftText);
  process(leftText, "validate", language, "  ");
  process(rightText, "validate", language, "  ");
  const changes = new ChangeCollector();
  if (language === "json") compareJson(new JsonReader(leftText).parse(), new JsonReader(rightText).parse(), "$", changes);
  else compareXml(readXml(leftText), readXml(rightText), "", changes);
  return { language, equal: changes.changes.length === 0, changes: changes.changes, report: reportOf(language, changes) };
}
