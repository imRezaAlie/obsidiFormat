import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { SAMPLES } from "../src/views/samples";
import {
  FormatError,
  MAX_INPUT,
  decode,
  decodeXmlDocument,
  decodeXmlEntities,
  detect,
  encodeXmlEntities,
  escapeString,
  extractEmbedded,
  looksEncodedXml,
  process,
  unescapeString,
} from "../src/formatters";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { contentType: "text/html" });
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  NodeFilter: dom.window.NodeFilter,
});

const UNIT = "  ";

function beautify(text: string, format: "auto" | "json" | "xml" | "soap" = "auto", unit: "  " | "    " | "        " | "\t" = UNIT) {
  return process(text, "beautify", format, unit);
}
function minify(text: string, format: "auto" | "json" | "xml" | "soap" = "auto", unit: "  " | "    " | "        " | "\t" = UNIT) {
  return process(text, "minify", format, unit);
}

describe("JSON", () => {
  it("beautifies nested objects and arrays and keeps key order", () => {
    const formatted = beautify('{"z":1,"a":[true,false,null,{"k":"v"}]}').text;
    assert.equal(formatted, '{\n  "z": 1,\n  "a": [\n    true,\n    false,\n    null,\n    {\n      "k": "v"\n    }\n  ]\n}');
  });

  it("minifies and stays consistent with a second beautify", () => {
    const pretty = beautify(SAMPLES.json).text;
    const compact = minify(pretty).text;
    assert.equal(compact.includes("\n"), false);
    assert.equal(beautify(compact).text, pretty);
    assert.doesNotThrow(() => process(pretty, "validate", "json", UNIT));
  });

  it("rejects invalid JSON and reports a location", () => {
    assert.throws(() => beautify('{"a":1,}'), (error: unknown) => {
      assert.ok(error instanceof FormatError);
      assert.match(error.message, /Trailing commas/);
      assert.equal(error.line, 1);
      assert.ok((error.column ?? 0) > 0);
      return true;
    });
    assert.throws(() => beautify("{"), (error: unknown) => error instanceof FormatError);
  });

  it("preserves unicode, escapes, duplicate keys and lexical numbers", () => {
    const source = '{"name":"Café","esc":"\\u00e9","n":9007199254740993,"a":1,"a":2}';
    const pretty = beautify(source).text;
    assert.match(pretty, /Café/);
    assert.match(pretty, /\\u00e9/);
    assert.match(pretty, /9007199254740993/);
    assert.equal(pretty.split('"a"').length - 1, 2);
    assert.equal(minify(pretty).text.replace(/\s/g, ""), source);
  });

  it("rejects empty input", () => {
    assert.throws(() => process(" \n\t ", "validate", "auto", UNIT), (error: unknown) => {
      assert.ok(error instanceof FormatError);
      assert.match(error.message, /empty/i);
      return true;
    });
  });

  it("decodes and escapes JSON strings without executing them", () => {
    const payload = '{"ok":true,"html":"<script>alert(1)</script>"}';
    const escaped = escapeString(payload);
    assert.equal(unescapeString(escaped), payload);
    assert.equal(decode(JSON.stringify(payload), UNIT).text, beautify(payload).text);
    assert.match(beautify(payload).text, /<script>alert\(1\)<\/script>/);
  });
});

describe("detection", () => {
  it("detects JSON, XML, SOAP and encoded XML", () => {
    assert.equal(detect(SAMPLES.json), "json");
    assert.equal(detect(SAMPLES.xml), "xml");
    assert.equal(detect(SAMPLES["soap-request"]), "soap");
    assert.equal(detect(SAMPLES["soap-response"]), "soap");
    assert.equal(detect(`\n<!-- note --><?xml version="1.0"?><Envelope xmlns="urn:x"/>`), "soap");
    assert.equal(detect(SAMPLES["escaped-xml"]), "encoded-xml");
    assert.equal(looksEncodedXml(SAMPLES["double-xml"]), true);
    assert.equal(detect(""), "empty");
  });
});

describe("XML and SOAP", () => {
  it("formats namespaces, attributes, comments and CDATA without rewriting them", () => {
    const pretty = beautify(SAMPLES.xml, "xml").text;
    assert.match(pretty, /xmlns="urn:example:catalog"/);
    assert.match(pretty, /xmlns:meta="urn:example:metadata"/);
    assert.match(pretty, /meta:active="true"/);
    assert.match(pretty, /<!-- Product inventory -->/);
    assert.match(pretty, /<!\[CDATA\[Works with JSON & XML <payloads>\.\]\]>/);
    assert.equal(minify(pretty, "xml").text.includes("<catalog"), true);
    assert.equal(beautify(minify(pretty, "xml").text, "xml").text, pretty);
  });

  it("preserves meaningful whitespace and mixed content", () => {
    const source = "<root>\n  <p>Hello <b>world</b>  </p>\n  <note xml:space=\"preserve\">  keep\n\tme  </note>\n</root>";
    const pretty = beautify(source, "xml").text;
    assert.match(pretty, /<p>Hello <b>world<\/b> {2}<\/p>/);
    assert.match(pretty, /<note xml:space="preserve"> {2}keep\n\tme {2}<\/note>/);
    const compact = minify(source, "xml").text;
    assert.equal(compact.startsWith("<root><p>"), true);
    assert.match(compact, /<note xml:space="preserve"> {2}keep\n\tme {2}<\/note>/);
  });

  it("formats SOAP 1.1 and SOAP 1.2 envelopes", () => {
    const request = beautify(SAMPLES["soap-request"], "soap");
    assert.equal(request.soapVersion, "SOAP 1.1");
    assert.match(request.text, /soapenv:Envelope/);
    assert.match(request.text, /xmlns:cus="urn:example:customer:v1"/);
    assert.match(request.text, /<soapenv:Header>/);
    assert.match(request.text, /<soapenv:Body>/);
    const response = beautify(SAMPLES["soap-response"], "auto");
    assert.equal(response.language, "soap");
    assert.equal(response.soapVersion, "SOAP 1.2");
    assert.match(response.text, /<!\[CDATA\[Premium customer & partner\.\]\]>/);
    assert.doesNotThrow(() => process(request.text, "validate", "soap", UNIT));
  });

  it("rejects a SOAP envelope without a Body and a header after the body", () => {
    assert.throws(() => beautify('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Header/></s:Envelope>', "soap"), /Body/);
    assert.throws(
      () =>
        beautify(
          '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body/><s:Header/></s:Envelope>',
          "soap",
        ),
      /after the SOAP Body/,
    );
  });

  it("allows a SOAP 1.1 extension element after Body and rejects envelope text", () => {
    const extended = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:x="urn:x"><s:Body/><x:Extra/></s:Envelope>';
    assert.equal(beautify(extended, "soap").soapVersion, "SOAP 1.1");
    assert.throws(
      () => beautify('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body/>text</s:Envelope>', "soap"),
      /non-whitespace text/,
    );
  });

  it("rejects malformed XML and markup declarations without resolving entities", () => {
    assert.throws(() => beautify("<root><child></root>", "xml"), (error: unknown) => error instanceof FormatError);
    assert.throws(() => beautify("<root>", "xml"), (error: unknown) => error instanceof FormatError);
    assert.throws(() => beautify('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>', "xml"), (error: unknown) => {
      assert.ok(error instanceof FormatError);
      assert.match(error.message, /DTD, ENTITY/);
      assert.equal(error.message.includes("root:"), false);
      return true;
    });
  });

  it("decodes entity layers without turning inner entities into markup", () => {
    assert.equal(decodeXmlEntities("&amp;lt;"), "&lt;");
    assert.equal(decodeXmlEntities("&#65;&#x42;"), "AB");
    const decoded = decodeXmlDocument(SAMPLES["double-xml"], "beautify", UNIT, "xml");
    assert.ok((decoded.layers ?? 0) >= 2);
    assert.match(decoded.text, /<EVENT>/);
    assert.match(decoded.text, /ID="42"/);
    const embedded = extractEmbedded(SAMPLES["embedded-soap"], "xml", UNIT);
    assert.equal(embedded.count, 1);
    assert.match(embedded.text, /COMPANY="AT&amp;T"/);
    const json = extractEmbedded(SAMPLES["embedded-json"], "json", UNIT);
    assert.match(json.text, /"status": "ok"/);
  });

  it("encodes XML text and leaves a script payload inert", () => {
    assert.equal(encodeXmlEntities(`<script>"a" & 'b'</script>`), "&lt;script&gt;&quot;a&quot; &amp; &apos;b&apos;&lt;/script&gt;");
  });
});

describe("limits and indentation", () => {
  it("supports 4-space and tab indentation", () => {
    assert.equal(beautify('{"a":1}', "json", "    ").text, '{\n    "a": 1\n}');
    assert.equal(beautify('{"a":1}', "json", "\t").text, '{\n\t"a": 1\n}');
  });

  it("rejects an over-long input before parsing it", () => {
    const huge = "x".repeat(MAX_INPUT + 1);
    assert.throws(() => process(huge, "validate", "json", UNIT), /20 Mi-character/);
  });

  it("formats a large nested payload and minifies it back", () => {
    const items = Array.from({ length: 2000 }, (_, index) => `{"id":${index},"name":"項目${index}"}`).join(",");
    const source = `{"items":[${items}]}`;
    assert.ok(source.length > 20000);
    const pretty = beautify(source).text;
    assert.match(pretty, /項目1999/);
    const compact = minify(pretty).text;
    assert.equal(beautify(compact).text, pretty);
  });

  it("does not treat a forced JSON selection of XML as success", () => {
    assert.throws(() => process(SAMPLES.xml, "beautify", "json", UNIT), (error: unknown) => error instanceof FormatError);
  });
});
