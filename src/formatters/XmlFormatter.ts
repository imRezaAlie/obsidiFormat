/**
 * XML formatting keeps the original tag, attribute, namespace, entity, and
 * CDATA spelling. DOMParser is used only to validate structure and to read
 * xml:space. Markup declarations are rejected before the parser runs, so
 * external entities and DTDs are never resolved.
 */
import { FormatError, type FormatAction, type FormatResult, type IndentUnit } from "../types";
import { builder, indentString } from "./limits";
import { checkSoap } from "./SoapFormatter";

const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XML_WS = /^[\x20\t\r\n]*$/;

export type XmlTokenType = "text" | "comment" | "cdata" | "pi" | "end" | "self" | "start";

export interface XmlToken {
  type: XmlTokenType;
  start: number;
  end: number;
  preserve?: boolean;
  markup?: boolean;
  mixed?: boolean;
  index?: number;
  close?: number;
}

export function xmlTokens(text: string): XmlToken[] {
  const tokens: XmlToken[] = [];
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  function fail(message: string, offset = i): never {
    throw new FormatError(message, text, offset);
  }
  while (i < text.length) {
    const start = i;
    let type: XmlTokenType;
    const ch = text[i];
    if (ch !== "<") {
      type = "text";
      const next = text.indexOf("<", i);
      i = next < 0 ? text.length : next;
    } else if (text.startsWith("<!--", i) || text.startsWith("<![CDATA[", i) || text.startsWith("<?", i)) {
      const prefix = text.startsWith("<!--", i)
        ? (["comment", 4, "-->"] as const)
        : text.startsWith("<![CDATA[", i)
          ? (["cdata", 9, "]]>" ] as const)
          : (["pi", 2, "?>"] as const);
      type = prefix[0];
      const end = text.indexOf(prefix[2], i + prefix[1]);
      if (end < 0) fail(`Unterminated XML ${type === "pi" ? "processing instruction" : type}.`);
      i = end + prefix[2].length;
    } else if (text.startsWith("<!", i)) {
      fail("DTD, ENTITY and other XML markup declarations are disabled for security.");
    } else {
      let quote = "";
      i++;
      while (i < text.length) {
        const c = text[i++] ?? "";
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
        else if (c === "<") fail("Unexpected opening angle bracket inside an XML tag.", i - 1);
      }
      if (quote || text[i - 1] !== ">") fail("Unterminated XML tag.", start);
      const lead = text[start + 1];
      const closer = text[i - 2];
      type = lead === "/" ? "end" : closer === "/" ? "self" : "start";
    }
    tokens.push({ type, start, end: i });
  }
  return tokens;
}

export function parseXml(text: string): Document {
  if (typeof DOMParser === "undefined") {
    throw new FormatError("This environment cannot validate XML.", text);
  }
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, "application/xml");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid XML syntax.";
    throw new FormatError(message, text);
  }
  const firefoxError = Array.from(doc.getElementsByTagNameNS("http://www.mozilla.org/newlayout/xml/parsererror.xml", "parsererror")).find((el) =>
    /XML Parsing Error|Line Number|This page contains the following errors/i.test(el.textContent ?? ""),
  );
  const chromiumError = Array.from(doc.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "parsererror")).find((el) => {
    const heading = el.firstElementChild;
    return heading?.localName === "h3" && /This page contains the following errors/i.test(heading.textContent ?? "");
  });
  const error = firefoxError ?? chromiumError;
  if (error || !doc.documentElement) {
    const message = (error?.textContent ?? "Missing XML document element.").trim();
    const match = /(?:line(?:\s+number)?\s*[:=]?\s*)(\d+)[\s,]*(?:at\s+)?(?:column\s*[:=]?\s*)(\d+)/i.exec(message);
    const detail = message.replace(/Below is a rendering[\s\S]*/i, "").replace(/^This page contains the following errors:\s*/i, "").trim();
    throw new FormatError(detail || "Invalid XML syntax.", text, null, match ? { line: Number(match[1]), column: Number(match[2]) } : null);
  }
  return doc;
}

export function formatXml(text: string, action: FormatAction, unit: IndentUnit, language: "xml" | "soap"): FormatResult {
  const tokens = xmlTokens(text);
  const doc = parseXml(text);
  const soapVersion = language === "soap" ? checkSoap(doc, tokens, text) : null;
  if (action === "validate") return { text, language, soapVersion };

  const walker = doc.createTreeWalker(doc, 1);
  const stack: XmlToken[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;
    const parent = stack[stack.length - 1];
    if (token.type === "start" || token.type === "self") {
      const el = walker.nextNode() as Element | null;
      const space = el?.getAttributeNS(XML_NS, "space");
      token.preserve = space === "preserve" || (space !== "default" && Boolean(parent?.preserve));
      if (parent) parent.markup = true;
      if (token.type === "start") {
        token.index = index;
        stack.push(token);
      }
    } else if (token.type === "end") {
      const opening = stack.pop();
      if (!opening) throw new FormatError("Unexpected XML end tag.", text, token.start);
      opening.close = index;
    } else if (parent) {
      if (token.type === "cdata" || (token.type === "text" && !XML_WS.test(text.slice(token.start, token.end)))) parent.mixed = true;
      else if (token.type !== "text") parent.markup = true;
    }
  }
  if (stack.length) {
    const unclosed = stack[stack.length - 1];
    throw new FormatError("Unclosed XML element.", text, unclosed?.start ?? 0);
  }

  const out = builder();
  const pretty = action === "beautify";
  let depth = 0;
  let first = true;
  const emit = (value: string) => {
    if (pretty) {
      if (!first) out.add("\n");
      out.add(indentString(unit, depth));
    }
    first = false;
    out.add(value);
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;
    if (token.type === "text" && XML_WS.test(text.slice(token.start, token.end))) continue;
    if (token.type === "start") {
      if (token.close === undefined) throw new FormatError("Unclosed XML element.", text, token.start);
      const closing = tokens[token.close];
      if (!closing) throw new FormatError("Unclosed XML element.", text, token.start);
      if (token.preserve || token.mixed || !token.markup) {
        emit(text.slice(token.start, closing.end));
        index = token.close;
      } else {
        emit(text.slice(token.start, token.end));
        depth++;
      }
    } else if (token.type === "end") {
      depth--;
      emit(text.slice(token.start, token.end));
    } else emit(text.slice(token.start, token.end));
  }
  return { text: out.text(), language, soapVersion };
}
