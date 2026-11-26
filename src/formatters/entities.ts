/**
 * XML entity transforms are explicit and lexical. They never parse HTML and
 * never resolve external entities.
 */
import { FormatError, MAX_OUTPUT } from "../types";
import { guard } from "./limits";

export const MAX_DECODE_LAYERS = 20;

const ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  amp: "&",
});

const ENTITY_PATTERN = /&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|quot|apos|amp);/g;

const ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
  "&": "&amp;",
});

export function validXmlCodePoint(n: number): boolean {
  return n === 9 || n === 10 || n === 13 || (n >= 0x20 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff);
}

export function decodeEntities(text: string): string {
  // A single replace pass is important: &amp;lt; becomes &lt;, not <.
  return text.replace(ENTITY_PATTERN, (whole, name: string) => {
    if (name[0] !== "#") return ENTITIES[name] ?? whole;
    const n = name[1] === "x" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return validXmlCodePoint(n) ? String.fromCodePoint(n) : whole;
  });
}

export function looksEncodedXml(text: string): boolean {
  let prefix = text.trimStart().slice(0, 2048);
  if (prefix[0] !== "&") return false;
  for (let i = 0; i < MAX_DECODE_LAYERS; i++) {
    const next = decodeEntities(prefix).trimStart();
    if (next === prefix) return false;
    if (next.startsWith("<")) return true;
    if (!next.startsWith("&")) return false;
    prefix = next;
  }
  return false;
}

export function decodeXmlEntities(text: string): string {
  guard(text);
  return decodeEntities(text);
}

export function encodeXmlEntities(text: string): string {
  guard(text);
  let size = text.length;
  for (const ch of text) {
    const escaped = ESCAPES[ch];
    if (escaped) size += escaped.length - 1;
  }
  if (size > MAX_OUTPUT) throw new FormatError("Encoded output exceeds the 64 Mi-character safety limit.", text);
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

export function deepDecodeXml(text: string): { text: string; layers: number } {
  guard(text);
  let value = text;
  let layers = 0;
  // Stop at the first exposed markup boundary. Further unescaping could turn
  // valid attribute or text entities such as AT&amp;T into invalid XML.
  while (layers < MAX_DECODE_LAYERS && !value.trimStart().startsWith("<")) {
    const next = decodeEntities(value);
    if (next === value) break;
    value = next;
    layers++;
  }
  return { text: value, layers };
}
