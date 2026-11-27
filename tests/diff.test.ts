import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffPayloads } from "../src/diff";

describe("Payload diff", () => {
  it("treats JSON key order and numeric spelling as equal", () => {
    const result = diffPayloads('{ "b": 1.0, "a": [1, 2e0] }', '{"a":[1,2],"b":1}');
    assert.equal(result.language, "json");
    assert.equal(result.equal, true);
    assert.deepEqual(result.changes, []);
    assert.match(result.report, /no structural differences/);
  });

  it("reports added, removed, and changed JSON paths", () => {
    const result = diffPayloads('{"a":1,"nested":{"x":true},"gone":1}', '{"a":2,"nested":{"x":false},"added":3}');
    const paths = result.changes.map((change) => `${change.kind}:${change.path}`).sort();
    assert.deepEqual(paths, ["add:$.added", "change:$.a", "change:$.nested.x", "remove:$.gone"]);
    assert.equal(result.equal, false);
    assert.match(result.report, /4 structural differences/);
  });

  it("handles JSON arrays and duplicate keys", () => {
    const array = diffPayloads('{"a":[1,2]}', '{"a":[1,3,4]}');
    assert.deepEqual(array.changes.map((change) => `${change.kind}:${change.path}`), ["change:$.a[1]", "add:$.a[2]"]);
    const duplicate = diffPayloads('{"a":1,"a":2}', '{"a":1}');
    assert.equal(duplicate.changes.length, 1);
    assert.match(duplicate.changes[0]?.left ?? "", /2 value/);
  });

  it("ignores XML prefixes, attribute order, and indentation", () => {
    const result = diffPayloads(
      '<a:x xmlns:a="urn:example" b="2" a="1"><a:y>value</a:y></a:x>',
      '<q:x xmlns:q="urn:example" a="1" b="2">\n  <q:y>value</q:y>\n</q:x>',
    );
    assert.equal(result.language, "xml");
    assert.equal(result.equal, true);
  });

  it("honors inherited xml:space preserve", () => {
    const preserved = diffPayloads('<root xml:space="preserve"><x>  a  </x></root>', '<root xml:space="preserve"><x> a </x></root>', "xml");
    assert.equal(preserved.equal, false);
    assert.match(preserved.report, /\/root\/x\/#text\[0\]/);
    const collapsed = diffPayloads("<root><x>  a  </x></root>", "<root><x> a </x></root>", "xml");
    assert.equal(collapsed.equal, true);
  });

  it("reports XML attribute, text, and element changes", () => {
    const result = diffPayloads('<root a="1"><item>old</item></root>', '<root a="2"><item>new</item><extra/></root>');
    const paths = result.changes.map((change) => `${change.kind}:${change.path}`);
    assert.deepEqual(paths, ["change:/root/@a", "change:/root/item/#text[0]", "add:/root/extra"]);
  });

  it("compares SOAP envelopes by namespace, not prefix", () => {
    const left = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><x>1</x></s:Body></s:Envelope>';
    const right = '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><x>2</x></soap:Body></soap:Envelope>';
    const result = diffPayloads(left, right);
    assert.equal(result.language, "soap");
    assert.deepEqual(result.changes.map((change) => change.path), ["/Envelope/Body/x/#text[0]"]);
  });

  it("rejects encoded XML, external entities, and mixed formats", () => {
    assert.throws(() => diffPayloads("&lt;root/&gt;", "<root/>"), /Decode encoded XML/);
    assert.throws(
      () => diffPayloads('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>', "<root/>"),
      /DTD, ENTITY/,
    );
    assert.throws(() => diffPayloads('{"a":1}', "<root/>"), /Cannot compare JSON with XML/);
  });
});
