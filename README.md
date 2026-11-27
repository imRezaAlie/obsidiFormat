# Payload Formatter

Format, beautify, validate, and minify JSON, XML, and SOAP inside Obsidian. Everything runs on your device. Note text is never uploaded, and no external formatter is called.

<p align="center">
  <a href="https://github.com/imRezaAlie/obsidiFormat/releases">Release 1.0.5</a>
  &nbsp;·&nbsp;
  <a href="https://rezaalie.ir">rezaalie.ir</a>
  &nbsp;·&nbsp;
  <a href="./LICENSE">MIT License</a>
  &nbsp;·&nbsp;
  Obsidian 1.7.2+
</p>

<p align="center">
  <img src="./intro.gif" alt="A note showing formatted JSON above a highlighted SOAP envelope" width="760">
</p>

<p align="center">
  <em>Drop a payload in, get a readable document out, then insert it back into the note.</em>
</p>

| | | |
| --- | --- | --- |
| **Beautify** | **Validate** | **Stay local** |
| Indent JSON, XML, and SOAP 1.1 / 1.2 with 2, 4, or 8 spaces, or a tab. | See the failing line, then jump to it. A failed edit leaves the selection unchanged. | Parsing never leaves the device. DTDs and external entities are rejected before the parser runs. |

## Install in a minute

1. Download [`main.js`](https://github.com/imRezaAlie/obsidiFormat/releases), `manifest.json`, and `styles.css` from the latest release.
2. Place them in `<vault>/.obsidian/plugins/obsidi-format/`.
3. Turn off Restricted mode under **Settings → Community plugins**, then enable **Payload Formatter**.
4. Click the braces icon, or run **Open**.

The folder name must be `obsidi-format`. That is the plugin id.

To build the three files yourself:

```bash
npm install
npm run build
```

## Two ways to format

**Beside the note.** The workspace has an input editor and an output editor. Paste, drop, or upload a file, then choose Beautify, Minify, or Validate. Copy the result, download it, or insert it into a source-mode note. Insert replaces the current selection and does not save the note.

**On the selection.** Right-click selected JSON, XML, or SOAP, or use a command. Only that selection changes, and the change can be undone. If the text cannot be parsed, it stays as it was and a notice explains why.

Detection can run automatically, or you can pin JSON, XML, or SOAP.

## Payload Diff

Run **Open Payload Diff** from the command palette or use the compare icon in the ribbon. `Open Payload Diff in sidebar` docks it on the right. Paste or upload two payloads into A and B, then choose **Compare**. Ctrl/Cmd+Enter compares; Ctrl/Cmd+Shift+C copies the report.

The comparison is structural: JSON key order, numeric spelling, and whitespace are ignored; XML and SOAP indentation, attribute order, and namespace prefixes are ignored. The report lists added (`+`), removed (`-`), and changed (`~`) paths. Mixed formats, encoded XML, DTDs, and external entities are rejected before parsing. Nothing is uploaded.

## What is preserved

- Unicode, duplicate JSON keys, and numbers that must not be rewritten as floating point.
- Namespace prefixes, attributes, comments, CDATA, and `xml:space="preserve"`.
- Nested XML escaping. Entities inside a document that is already well-formed are left alone unless you decode them.

**XML Tools** decode an entity-encoded document, extract XML or JSON hidden in SOAP text or CDATA, and encode text. The input editor is not modified. The result goes to the output panel.

Turn on **Auto format** to reformat after edits. **Auto-decode escaped XML** runs only when the entire input is entity-encoded.

## Shortcuts

Active only while the Payload Formatter tab is focused. On macOS, Cmd replaces Ctrl.

| Action | Keys |
| --- | --- |
| Beautify | Ctrl/Cmd + Enter |
| Minify | Ctrl/Cmd + Shift + M |
| Copy output | Ctrl/Cmd + Shift + C |
| Search | Ctrl/Cmd + F |
| Find next / previous | Ctrl/Cmd + G / Shift + Ctrl/Cmd + G |
| Zoom | Ctrl/Cmd + plus, minus, or 0 |
| Full screen | F11 |
| Restore a maximized editor | Esc |

Obsidian may already be using some of these keys.

## Commands

In the command palette, each name appears next to **Payload Formatter**.

| Command | Effect |
| --- | --- |
| Open | Open the workspace in a tab, or focus it. |
| Open in sidebar | Open it in the right sidebar when it is not already open. |
| Open Payload Diff | Open the two-pane structural diff in a tab, or focus it. |
| Open Payload Diff in sidebar | Open it in the right sidebar when it is not already open. |
| Format selected JSON | Beautify the selection as JSON. |
| Format selected XML | Beautify the selection as XML. |
| Format selected SOAP | Beautify the selection as SOAP. |
| Auto format selection | Detect the format, or use the default formatter when detection is off. |
| Minify selected JSON | Compact the selected JSON. |
| Send selection | Load the selection into the input editor. |
| Insert output | Insert the output into a source-mode note, without saving. |

The same actions are on the editor right-click menu. The menu also opens Payload Diff and sends the selection to side A or B. Format and send actions stay disabled until something is selected.

## Settings

**Settings → Community plugins → Payload Formatter.** On Obsidian 1.13 and later, these rows also appear in settings search.

| Setting | Choices |
| --- | --- |
| Indentation size | 2, 4, or 8 spaces |
| Indentation type | Spaces, or one tab character |
| Automatic format detection | On or off |
| Default formatter | JSON, XML, or SOAP |
| Output preference | Panel only, or panel and clipboard |
| Syntax highlighting | On, or off for very large payloads |

Zoom, word wrap, layout, auto-format, format-on-paste, and XML auto-decode live in the workspace settings. Saving editor text is off by default. When enabled, each editor keeps at most 1,000,000 characters, unencrypted, in `data.json`.

## Security

Payload Formatter is built to format text, not to fetch it or run it.

- **No network.** Formatting does not call a server, a webhook, or an external beautifier.
- **No code execution.** JSON is tokenized for formatting. `JSON.parse` is used only by the explicit unescape and decode tools, and it parses data rather than running it. XML and SOAP are serialized from the original text after a well-formedness check.
- **External entities are refused.** A `<!DOCTYPE`, `<!ENTITY`, or other markup declaration is rejected before `DOMParser` runs, so an external entity cannot be loaded.
- **Entities are decoded from a fixed list.** Named entities are only `lt`, `gt`, `quot`, `apos`, and `amp`, plus numeric character references. One decode pass does not turn an inner escape into live markup.
- **Your text stays in the vault.** Optional saved editor content is off by default. When you turn it on, it is stored unencrypted in the plugin's `data.json` inside the vault. Turn the setting off to delete it.
- **Clipboard only when you ask.** Copy, and the "panel and clipboard" output preference, read or write the system clipboard. Formatting itself does not.

Report a security problem through [GitHub Security Advisories](https://github.com/imRezaAlie/obsidiFormat/security) or by opening an issue if the report is not sensitive.

## Good to know

- Input longer than 20 × 1024 × 1024 characters is refused before parsing.
- Only one workspace stays open. Drag the tab into either sidebar after it is open.
- Full screen can be ignored on mobile. If download fails, use Copy or Insert.
- Highlighting is lexical. It does not change how a Markdown code block is rendered.
- Minimum Obsidian version: **1.7.2**.

## For developers

Node.js 18 or newer.

```bash
npm install
npm run dev       # rebuild while you work
npm test          # formatter tests
npm run build     # typecheck and production bundle
```

Point the vault plugin folder at this repository, then reload the plugin after a build. Tests cover nesting, unicode, namespaces, SOAP 1.1 and 1.2, CDATA, mixed content, malformed XML, entities, large input, and beautify/minify consistency.

To publish, bump `version` in `manifest.json`, `package.json`, and `versions.json` (`x.y.z`, no `v` prefix), then tag that version. The release workflow attaches `main.js`, `manifest.json`, and `styles.css`. Actions needs read and write permission. The [community directory](https://community.obsidian.md) reads the manifest on the default branch and installs the release with the same tag.

Author: [Reza Ali](https://rezaalie.ir) · Source: [github.com/imRezaAlie/obsidiFormat](https://github.com/imRezaAlie/obsidiFormat)

## License

[MIT](./LICENSE) © 2026 Reza Ali.
