/** Shared types for the ObsidiFormat plugin. The formatter never sends text off-device. */

export type FormatAction = "beautify" | "minify" | "validate";
export type SelectedFormat = "auto" | "json" | "xml" | "soap";
export type DetectedFormat = "json" | "xml" | "soap" | "encoded-xml" | "empty" | "text";
export type IndentUnit = "  " | "    " | "        " | "\t";
export type OutputKind = "json" | "xml" | "soap" | "text" | "encoded-xml";
export type EditorSide = "input" | "output";

export const FORMAT_ACTIONS: readonly FormatAction[] = ["beautify", "minify", "validate"];
export const SELECTED_FORMATS: readonly SelectedFormat[] = ["auto", "json", "xml", "soap"];
export const INDENT_UNITS: readonly IndentUnit[] = ["  ", "    ", "        ", "\t"];
export const OUTPUT_KINDS: readonly OutputKind[] = ["json", "xml", "soap", "text", "encoded-xml"];

export const MAX_INPUT = 20 * 1024 * 1024;
export const MAX_OUTPUT = 64 * 1024 * 1024;
/** Cap persisted editor text so Obsidian's data.json cannot grow without bound. */
export const MAX_SAVED_CHARS = 1_000_000;

export const VIEW_TYPE = "obsidi-format-view";

export interface FormatLocation {
  line: number;
  column: number;
}

export interface FormatResult {
  text: string;
  language: string;
  soapVersion?: string | null;
  layers?: number;
  count?: number;
  skipped?: number;
  paths?: string[];
}

export interface EmbeddedMatch {
  path: string;
  text: string;
  language: string;
}

/**
 * Parsing or safety failure. `line` and `column` are 1-based when the engine
 * can point at the offending input. Callers must keep the previous editor text.
 */
export class FormatError extends Error {
  readonly offset?: number;
  readonly line?: number;
  readonly column?: number;

  constructor(
    message: string,
    text: string,
    offset: number | null = null,
    location: FormatLocation | null = null,
  ) {
    super(message);
    this.name = "FormatError";
    if (location) {
      this.line = location.line;
      this.column = location.column;
    } else if (offset !== null) {
      const clamped = Math.max(0, Math.min(offset, text.length));
      this.offset = clamped;
      const lines = text.slice(0, clamped).split(/\r\n|\r|\n/);
      const last = lines[lines.length - 1] ?? "";
      this.line = lines.length;
      this.column = last.length + 1;
    }
  }
}

export interface ObsidiFormatSettings {
  indentSize: 2 | 4 | 8;
  indentType: "spaces" | "tabs";
  autoDetect: boolean;
  defaultFormatter: "json" | "xml" | "soap";
  /** `panel` shows output in ObsidiFormat. `panel-and-clipboard` also copies it. */
  outputPreference: "panel" | "panel-and-clipboard";
  syntaxHighlighting: boolean;
  layout: "auto" | "side" | "stacked";
  split: number;
  inputFont: number;
  outputFont: number;
  syncZoom: boolean;
  autoFormat: boolean;
  autoDecodeXml: boolean;
  formatOnPaste: boolean;
  saveContent: boolean;
  inputWrap: boolean;
  outputWrap: boolean;
  savedInput: string;
  savedOutput: string;
  sourceName: string;
  outputKind: OutputKind | null;
}

export const DEFAULT_SETTINGS: ObsidiFormatSettings = {
  indentSize: 2,
  indentType: "spaces",
  autoDetect: true,
  defaultFormatter: "json",
  outputPreference: "panel",
  syntaxHighlighting: true,
  layout: "auto",
  split: 50,
  inputFont: 14,
  outputFont: 14,
  syncZoom: true,
  autoFormat: false,
  autoDecodeXml: false,
  formatOnPaste: false,
  saveContent: false,
  inputWrap: false,
  outputWrap: false,
  savedInput: "",
  savedOutput: "",
  sourceName: "",
  outputKind: null,
};
