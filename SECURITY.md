# Security

Payload Formatter formats JSON, XML, and SOAP on the device. It does not upload note contents.

## Reporting

Please report a vulnerability through [GitHub Security Advisories](https://github.com/imRezaAlie/obsidiFormat/security/advisories/new) for this repository.

Include the plugin version, the Obsidian version, and a minimal payload that shows the problem. Do not include vault secrets or real customer data.

## What the plugin already refuses

- Markup declarations, including `<!DOCTYPE` and `<!ENTITY`, are rejected before XML is parsed.
- Named entity decoding accepts only `lt`, `gt`, `quot`, `apos`, and `amp`, plus numeric character references.
- JSON is tokenized. It is not evaluated as script.
- Formatting does not make a network request.

Saved editor text is optional and off by default. When enabled, it is stored unencrypted in the vault's plugin `data.json`.
