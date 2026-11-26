import { FormatError } from "../types";
import type { XmlToken } from "./XmlFormatter";

const SOAP_11 = "http://schemas.xmlsoap.org/soap/envelope/";
const SOAP_12 = "http://www.w3.org/2003/05/soap-envelope";
const SOAP_NS = new Set([SOAP_11, SOAP_12]);
const XML_WS = /^[\x20\t\r\n]*$/;

/**
 * SOAP 1.1 and 1.2 structural checks. The document must already be well-formed.
 * Namespace-qualified SOAP 1.1 extension elements after Body are allowed.
 */
export function checkSoap(doc: Document, tokens: readonly XmlToken[], text: string): string {
  const root = doc.documentElement;
  if (!root) throw new FormatError("SOAP requires an Envelope in the SOAP 1.1 or SOAP 1.2 namespace.", text, 0);
  const ns = root.namespaceURI;
  const rootToken = tokens.find((token) => token.type === "start" || token.type === "self");
  function fail(message: string, el: Element = root): never {
    let pos = rootToken?.start ?? 0;
    if (el !== root) {
      const walker = doc.createTreeWalker(doc, 1);
      for (const tag of tokens) {
        if (tag.type !== "start" && tag.type !== "self") continue;
        if (walker.nextNode() === el) {
          pos = tag.start;
          break;
        }
      }
    }
    throw new FormatError(message, text, pos);
  }
  if (root.localName !== "Envelope" || !ns || !SOAP_NS.has(ns)) {
    fail("SOAP requires an Envelope in the SOAP 1.1 or SOAP 1.2 namespace.");
  }
  const children = Array.from(root.children);
  const is = (el: Element | undefined, name: string) => Boolean(el && el.localName === name && el.namespaceURI === ns);
  let index = 0;
  if (is(children[0], "Header")) index++;
  const body = children[index];
  if (!is(body, "Body")) fail("SOAP Envelope requires exactly one Body, after an optional Header.", body ?? root);
  for (const child of children.slice(index + 1)) {
    if (ns !== SOAP_11 || !child.namespaceURI || child.namespaceURI === ns) {
      fail("Unexpected element after the SOAP Body; Header and Body may not be repeated.", child);
    }
  }
  for (const child of Array.from(root.childNodes)) {
    if ((child.nodeType === 3 || child.nodeType === 4) && !XML_WS.test(child.nodeValue ?? "")) {
      fail("SOAP Envelope may not contain non-whitespace text outside Header and Body.");
    }
  }
  return ns.includes("2003/05") ? "SOAP 1.2" : "SOAP 1.1";
}
