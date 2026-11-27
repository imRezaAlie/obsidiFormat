# AGENTS.md

## Repo shape

- Obsidian plugin `obsidi-format` ("Payload Formatter"). `src/main.ts` registers views/commands; `src/views/ObsidiFormatView.ts` is the workspace UI; `src/formatters/index.ts` is the pure engine API (`process`, `decode`, `decodeXmlDocument`, `extractEmbedded`).
- Payload Diff is a separate `DIFF_VIEW_TYPE` ItemView (`src/views/PayloadDiffView.ts`) backed by the pure structural diff in `src/diff/index.ts`; `tests/diff.test.ts` is imported into the single test entrypoint.
- `src/host.ts` is intentionally the only plugin surface the formatter view uses; formatter tests must not import `obsidian`. `tests/formatters.test.ts` supplies `DOMParser`/`NodeFilter` from jsdom.
- Workspace editors are CodeMirror 5 (`codemirror` package), not Obsidian's editor/CM6. Obsidian's `Editor` is used only for selection commands and note insertion.

## Commands

- Node >= 18. `npm install`, `npm run dev` (esbuild watch only, no typecheck), `npm run build` (`tsc --noEmit --skipLibCheck`, then minified production bundle), `npm run typecheck`, `npm test`.
- `npm test` bundles only `tests/formatters.test.ts` into `.test-dist/formatters.test.cjs` via esbuild, then runs `node --test`. New tests must be imported from that entrypoint or the runner must change. Focused test: `node --test-name-pattern='<name>' .test-dist/formatters.test.cjs`.
- Builds generate root `main.js` and `styles.css`; edit `src/styles.css`, not generated CSS. `main.js` is gitignored; `styles.css` is tracked, so commit regenerated CSS when styles change.
- CI release workflow only runs on version tags and runs `npm install && npm run build`; it does not run tests. Run `npm test` locally before release.

## Constraints / gotchas

- Formatting preserves original JSON lexical tokens (duplicate keys, number spelling, escapes) and XML markup, entity, CDATA, and namespace spelling. Do not switch formatting to `JSON.parse`/`stringify` or DOM reserialization.
- XML `DOMParser` is only for well-formedness checks; `<!...` markup declarations are rejected before parsing so DTDs and external entities are never resolved. Entity-encoded XML must go through explicit decode tools, not `process`.
- Detection in `src/formatters/FormatDetector.ts` is structural (SOAP = root `Envelope`), not schema-based.
- Input cap is 20 Mi characters, output cap 64 Mi; persisted editor text is off by default and capped at 1,000,000 characters in `data.json`. Settings are sanitized on load in `src/settings-data.ts`.
- Note insertion requires a source-mode Markdown note; the plugin tracks the last active Markdown leaf because the formatter view steals focus. Only one formatter view is kept; `layout-change` detaches extras.
- Release version must match in `manifest.json`, `package.json`, and `versions.json` as plain `x.y.z`; the vault plugin folder must be `obsidi-format`.
