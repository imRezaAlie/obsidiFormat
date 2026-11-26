# ObsidiFormat

Website: [rezaalie.ir](https://rezaalie.ir)

Repository: [github.com/imRezaAlie/obsidiFormat](https://github.com/imRezaAlie/obsidiFormat)

ObsidiFormat formats, beautifies, validates, and minifies JSON, XML, and SOAP inside Obsidian. Processing stays on the device. The plugin does not upload note contents or call an external formatter.

## Features

- Beautify, minify, and validate JSON, XML, and SOAP 1.1 / SOAP 1.2.
- Detect the format automatically, or pin JSON, XML, or SOAP.
- Choose 2, 4, or 8 spaces, or a tab.
- Preserve unicode, duplicate JSON keys, lexical numbers, namespace prefixes, attributes, CDATA, comments, and `xml:space="preserve"`.
- Reject DTDs and entity declarations before parsing, so external entities are not resolved.
- Decode or encode XML entities, including nested escaping, without rewriting entities inside an already-valid document unless you ask.
- Extract XML or JSON embedded in SOAP leaf text or CDATA.
- Escape, unescape, and decode JSON strings.
- Copy output, download it, or insert it into the active Markdown note.
- Format an editor selection in place, with undo. A failed format leaves the selection unchanged.
- Open the workspace in a tab or the right sidebar. Drag the tab to either sidebar.
- Follow the active light or dark theme.

## Manual installation

1. Build the plugin, or download `main.js`, `manifest.json`, and `styles.css` from a release.
2. Create a folder in your vault:

   ```text
   <vault>/.obsidian/plugins/obsidi-format/
   ```

3. Copy these files into that folder:

   - `main.js`
   - `manifest.json`
   - `styles.css`

4. Reload Obsidian, open **Settings → Community plugins**, and enable **ObsidiFormat**.
5. Click the braces icon in the ribbon, or run **Open ObsidiFormat**.

To build those files yourself:

```bash
npm install
npm run build
```

## Usage

Open **ObsidiFormat**. Paste, drop, or upload JSON, XML, or SOAP, then choose **Beautify**, **Minify**, or **Validate**. The message bar reports success and parsing errors. **Go to error** moves the cursor to the reported line when a location is available.

**Insert** puts the output at the cursor of the last Markdown note that was in editing mode. It replaces that note's selection when one exists, and it does not save the note.

**XML Tools** decodes entity-encoded documents, extracts embedded payloads, and encodes text. The input editor is left unchanged; the result is written to the output panel.

Turn on **Auto format** to reformat after edits, or **Auto-decode escaped XML** in the view settings when the whole input is an entity-encoded document. Entities inside XML that is already well-formed are not decoded automatically.

While the ObsidiFormat tab is focused:

| Action | Shortcut |
| --- | --- |
| Beautify | Ctrl/Cmd + Enter |
| Minify | Ctrl/Cmd + Shift + M |
| Copy output | Ctrl/Cmd + Shift + C |
| Search the active editor | Ctrl/Cmd + F |
| Find next / previous | Ctrl/Cmd + G / Shift + Ctrl/Cmd + G |
| Zoom | Ctrl/Cmd + plus, minus, or 0 |
| Full screen | F11 |
| Restore a maximized editor | Esc |

## Commands

| Command | What it does |
| --- | --- |
| Open ObsidiFormat | Opens the workspace in a tab, or focuses it if it is already open. |
| Open ObsidiFormat in sidebar | Opens it in the right sidebar when it is not already open. |
| Format Selected JSON | Beautifies the selection as JSON and replaces that selection. |
| Format Selected XML | Beautifies the selection as XML. |
| Format Selected SOAP | Beautifies the selection as SOAP. |
| Auto Format Selection | Detects the format, or uses the default formatter when detection is off. |
| Minify Selected JSON | Compacts the selected JSON. |
| Send Selection to ObsidiFormat | Loads the selection into the input editor. |
| Insert ObsidiFormat Output | Inserts the output panel into the active Markdown editor. |

Selection commands do nothing to the rest of the note. If parsing fails, the selection is kept and a notice explains the error.

The same actions are on the editor right-click menu under **ObsidiFormat**. Format actions stay disabled until text is selected. On older Obsidian releases that cannot show a submenu, the actions are listed directly in the menu.

## Configuration

Open **Settings → ObsidiFormat**.

| Setting | Purpose |
| --- | --- |
| Indentation size | 2, 4, or 8 spaces. |
| Indentation type | Spaces or tabs. Tabs indent with one tab character. |
| Automatic format detection | Detect JSON, XML, or SOAP. |
| Default formatter | JSON, XML, or SOAP when detection is off. |
| Output preference | Keep output in the panel, or also copy it. |
| Syntax highlighting | Color the ObsidiFormat editors. Turn this off for very large payloads. |

The view's own settings store zoom, word wrap, layout, auto-format, format-on-paste, XML auto-decode, and optional local content. Saved editor text is off by default. When enabled, it is stored unencrypted in the plugin's `data.json` and is limited to about one million characters per editor. Preferences are saved with Obsidian's `loadData` / `saveData`.

## Development

Requirements: Node.js 18 or newer.

```bash
npm install
npm run dev      # watch main.js and styles.css
npm run build    # typecheck and production bundle
npm test         # formatter unit tests
npm run typecheck
```

`npm run dev` keeps running. Copy or symlink the plugin directory into a vault's `.obsidian/plugins/obsidi-format` folder, then reload the plugin after a rebuild. The production bundle writes:

- `main.js`
- `styles.css`
- `manifest.json` is already at the repository root

The formatter tests run in Node with a DOM parser. They cover valid and invalid JSON, nesting, unicode, namespaces, SOAP 1.1 and 1.2, CDATA, mixed content, malformed XML, entity handling, large input, and beautify/minify consistency.

Layout and editor behavior still needs a pass inside Obsidian on desktop and mobile. See the limitations below.

## Release

1. Bump `version` in `manifest.json`, `package.json`, and `versions.json`. The `versions.json` value is the minimum Obsidian version for that release.
2. Run `npm test` and `npm run build`.
3. Tag the commit and attach `main.js`, `manifest.json`, and `styles.css` to the GitHub release. The tag must match the manifest version, including the `v` prefix Obsidian expects (`1.0.0` in the manifest, often the tag `1.0.0`).
4. To list the plugin in the community directory, open a pull request against `obsidianmd/obsidian-releases` with the repository URL, a release that contains those three files, and a README that describes what the plugin does.

Before submission, confirm the plugin loads and unloads cleanly, that commands are undoable, and that no network requests are made while formatting.

## Assumptions

- Minimum Obsidian version is 1.4.0 because the view uses workspace leaves, the editor selection API, and theme CSS variables that have been stable since that generation.
- CodeMirror 5 is bundled for the ObsidiFormat editors so folding, search, and bracket matching from the original application still work. It is themed with Obsidian CSS variables and is not the editor used for Markdown notes.
- XML well-formedness uses the platform `DOMParser` after markup declarations have been rejected. Obsidian desktop and mobile both provide that browser API.
- Only one ObsidiFormat view is kept open. Use the sidebar command before it is open, or drag the tab afterward.
- Editor-content persistence is capped so `data.json` cannot grow to the in-memory 20 million character processing limit.
- The author field is the project name because the standalone file did not name a maintainer.

## Known limitations

- Full screen uses the view's Fullscreen API and may be ignored on mobile.
- Downloading output depends on the webview accepting a generated file link. If that fails, use **Copy** or **Insert**.
- Syntax highlighting is lexical and optional. It is not a replacement for an Obsidian code block language mode.
- The in-view shortcuts only run while ObsidiFormat is focused, and Obsidian may already have claimed some of them.
- Saved workspace text is not encrypted.
- The original standalone file is not loaded by the plugin.
