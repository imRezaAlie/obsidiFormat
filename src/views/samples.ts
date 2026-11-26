/** Sample payloads copied from the original beautifier. They stay on device. */
export const SAMPLES: Record<string, string> = {
  json: '{"requestId":"REQ-2026-001","status":"success","service":{"name":"Customer API","version":"2.4","active":true},"customers":[{"id":1001,"name":"Alex Morgan","email":"alex@example.test","balance":1250.75,"tags":["premium","verified"]},{"id":1002,"name":"Jordan Lee","email":null,"balance":0,"tags":[]}],"metadata":{"total":2,"cached":false,"durationMs":18}}',
  xml: '<?xml version="1.0" encoding="UTF-8"?><catalog xmlns="urn:example:catalog" xmlns:meta="urn:example:metadata"><!-- Product inventory --><product id="A100" meta:active="true"><name>Developer Toolkit</name><price currency="USD">49.95</price><description><![CDATA[Works with JSON & XML <payloads>.]]></description></product><product id="A200"><name>API Client</name><price currency="USD">29.50</price></product></catalog>',
  "soap-request":
    '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cus="urn:example:customer:v1"><soapenv:Header><cus:RequestContext><cus:RequestId>REQ-2026-001</cus:RequestId><cus:Channel>WEB</cus:Channel></cus:RequestContext></soapenv:Header><soapenv:Body><cus:GetCustomerRequest><cus:CustomerId>1001</cus:CustomerId><cus:IncludeDetails>true</cus:IncludeDetails></cus:GetCustomerRequest></soapenv:Body></soapenv:Envelope>',
  "soap-response":
    '<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope" xmlns:c="urn:example:customer:v1"><env:Header><c:CorrelationId>REQ-2026-001</c:CorrelationId></env:Header><env:Body><c:GetCustomerResponse><c:Status>SUCCESS</c:Status><c:Customer id="1001"><c:Name>Alex Morgan</c:Name><c:Active>true</c:Active><c:Notes><![CDATA[Premium customer & partner.]]></c:Notes></c:Customer></c:GetCustomerResponse></env:Body></env:Envelope>',
  escaped: JSON.stringify('{"message":"Hello, world!","success":true,"items":[1,2,3]}'),
  "escaped-xml": "&lt;EVENT&gt;&lt;REQUEST EXTERNAL_USER=&quot;demo&quot; REQUEST_TYPE=&quot;QEO&quot;/&gt;&lt;/EVENT&gt;",
  "double-xml": "&amp;lt;EVENT&amp;gt;&amp;lt;REQUEST ID=&amp;quot;42&amp;quot;/&amp;gt;&amp;lt;/EVENT&amp;gt;",
  "embedded-soap":
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Header/><s:Body><XmlData>&lt;EVENT&gt;&lt;REQUEST ID=&quot;42&quot; COMPANY=&quot;AT&amp;amp;T&quot;/&gt;&lt;/EVENT&gt;</XmlData></s:Body></s:Envelope>',
  "embedded-json":
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><JsonData><![CDATA[{"id":42,"status":"ok","items":[1,2,3]}]]></JsonData></s:Body></s:Envelope>',
};
