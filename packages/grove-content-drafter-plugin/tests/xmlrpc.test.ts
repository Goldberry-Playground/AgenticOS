import { describe, it, expect } from "vitest";
import {
  buildMethodCall,
  serializeValue,
  parseMethodResponse,
  XmlRpcFault,
} from "../src/xmlrpc.js";

describe("serializeValue", () => {
  it("encodes scalars by type", () => {
    expect(serializeValue("hi")).toBe("<value><string>hi</string></value>");
    expect(serializeValue(7)).toBe("<value><int>7</int></value>");
    expect(serializeValue(1.5)).toBe("<value><double>1.5</double></value>");
    expect(serializeValue(true)).toBe("<value><boolean>1</boolean></value>");
    expect(serializeValue(false)).toBe("<value><boolean>0</boolean></value>");
    expect(serializeValue(null)).toBe("<value><nil/></value>");
  });

  it("escapes special chars in strings", () => {
    expect(serializeValue("a & b < c > d")).toBe("<value><string>a &amp; b &lt; c &gt; d</string></value>");
  });

  it("encodes arrays and structs recursively", () => {
    expect(serializeValue([1, "x"])).toBe(
      "<value><array><data><value><int>1</int></value><value><string>x</string></value></data></array></value>",
    );
    expect(serializeValue({ a: 1 })).toBe(
      "<value><struct><member><name>a</name><value><int>1</int></value></member></struct></value>",
    );
  });

  it("builds a methodCall document", () => {
    const xml = buildMethodCall("authenticate", ["db", "u", "p", {}]);
    expect(xml).toContain("<methodName>authenticate</methodName>");
    expect(xml).toContain("<value><string>db</string></value>");
    expect(xml).toContain("<struct></struct>");
  });
});

describe("parseMethodResponse", () => {
  it("parses an int (authenticate uid)", () => {
    const xml = `<?xml version="1.0"?><methodResponse><params><param><value><int>7</int></value></param></params></methodResponse>`;
    expect(parseMethodResponse(xml)).toBe(7);
  });

  it("parses a bare string value with no type tag", () => {
    const xml = `<methodResponse><params><param><value>hello</value></param></params></methodResponse>`;
    expect(parseMethodResponse(xml)).toBe("hello");
  });

  it("parses an array of ids", () => {
    const xml = `<methodResponse><params><param><value><array><data><value><int>3</int></value><value><int>9</int></value></data></array></value></param></params></methodResponse>`;
    expect(parseMethodResponse(xml)).toEqual([3, 9]);
  });

  it("parses a struct with nested many2one array, booleans, and unescaping", () => {
    const xml = `<methodResponse><params><param><value><array><data><value><struct>
      <member><name>name</name><value><string>Fig &amp; Co</string></value></member>
      <member><name>categ_id</name><value><array><data><value><int>4</int></value><value><string>Plants / Fruit</string></value></data></array></value></member>
      <member><name>grove_soil</name><value><boolean>0</boolean></value></member>
      <member><name>grove_facts_provenance</name><value><struct><member><name>grove_zone_min</name><value><struct><member><name>source</name><value><string>usda</string></value></member></struct></value></member></struct></value></member>
    </struct></value></data></array></value></param></params></methodResponse>`;
    const out = parseMethodResponse(xml) as any[];
    expect(out[0].name).toBe("Fig & Co");
    expect(out[0].categ_id).toEqual([4, "Plants / Fruit"]);
    expect(out[0].grove_soil).toBe(false);
    expect(out[0].grove_facts_provenance.grove_zone_min.source).toBe("usda");
  });

  it("throws XmlRpcFault on an access error", () => {
    const xml = `<methodResponse><fault><value><struct>
      <member><name>faultCode</name><value><int>3</int></value></member>
      <member><name>faultString</name><value><string>AccessError</string></value></member>
    </struct></value></fault></methodResponse>`;
    expect(() => parseMethodResponse(xml)).toThrow(XmlRpcFault);
  });
});
