import type { DetectedFormat } from "../types";
import { looksEncodedXml } from "./entities";

/**
 * Cheap structural detection. SOAP is an Envelope element; everything else
 * that starts with `<` is XML. Entity-encoded documents are reported separately
 * so the engine does not unescape them unless the user asks.
 */
export function detect(text: string): DetectedFormat {
  const sample = text.trimStart();
  if (!sample) return "empty";
  if (sample[0] !== "<") return looksEncodedXml(sample) ? "encoded-xml" : "json";
  let p = 0;
  while (p < sample.length) {
    while (/\s/.test(sample[p] ?? "") && p < sample.length) p++;
    const close = sample.startsWith("<?", p) ? "?>" : sample.startsWith("<!--", p) ? "-->" : null;
    if (!close) break;
    const end = sample.indexOf(close, p + 2);
    if (end < 0) return "xml";
    p = end + close.length;
  }
  const name = /^<([^\s/>]+)/.exec(sample.slice(p));
  return name && name[1]?.split(":").pop() === "Envelope" ? "soap" : "xml";
}
