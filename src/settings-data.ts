import {
  DEFAULT_SETTINGS,
  MAX_SAVED_CHARS,
  type IndentUnit,
  type ObsidiFormatSettings,
  type OutputKind,
  type SelectedFormat,
  OUTPUT_KINDS,
} from "./types";

const BASE_FONT = 14;

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export function fontSize(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? clamp(Math.round(n), 10, 40) : BASE_FONT;
}

export function indentUnit(settings: Pick<ObsidiFormatSettings, "indentSize" | "indentType">): IndentUnit {
  if (settings.indentType === "tabs") return "\t";
  if (settings.indentSize === 8) return "        ";
  if (settings.indentSize === 4) return "    ";
  return "  ";
}

export function indentWidth(settings: Pick<ObsidiFormatSettings, "indentSize" | "indentType">): number {
  return settings.indentType === "tabs" ? 4 : settings.indentSize;
}

/** Format passed to the engine from the current settings. */
export function selectedFormat(settings: Pick<ObsidiFormatSettings, "autoDetect" | "defaultFormatter">): SelectedFormat {
  return settings.autoDetect ? "auto" : settings.defaultFormatter;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOutputKind(value: unknown): value is OutputKind {
  return typeof value === "string" && (OUTPUT_KINDS as readonly string[]).includes(value);
}

/** Accepts untrusted plugin data and returns a complete settings object. */
export function sanitizeSettings(raw: unknown): ObsidiFormatSettings {
  const saved = isRecord(raw) ? raw : {};
  const settings: ObsidiFormatSettings = { ...DEFAULT_SETTINGS };

  if (saved.indentSize === 2 || saved.indentSize === 4 || saved.indentSize === 8) {
    settings.indentSize = saved.indentSize;
  }
  if (saved.indentType === "spaces" || saved.indentType === "tabs") settings.indentType = saved.indentType;
  if (typeof saved.autoDetect === "boolean") settings.autoDetect = saved.autoDetect;
  if (saved.defaultFormatter === "json" || saved.defaultFormatter === "xml" || saved.defaultFormatter === "soap") {
    settings.defaultFormatter = saved.defaultFormatter;
  }
  if (saved.outputPreference === "panel" || saved.outputPreference === "panel-and-clipboard") {
    settings.outputPreference = saved.outputPreference;
  }
  if (typeof saved.syntaxHighlighting === "boolean") settings.syntaxHighlighting = saved.syntaxHighlighting;
  if (saved.layout === "auto" || saved.layout === "side" || saved.layout === "stacked") settings.layout = saved.layout;
  if (typeof saved.split === "number" && Number.isFinite(saved.split)) settings.split = clamp(saved.split, 15, 85);

  if (typeof saved.inputFont === "number") settings.inputFont = fontSize(saved.inputFont);
  if (typeof saved.outputFont === "number") settings.outputFont = fontSize(saved.outputFont);
  for (const key of ["syncZoom", "autoFormat", "autoDecodeXml", "formatOnPaste", "saveContent", "inputWrap", "outputWrap"] as const) {
    if (typeof saved[key] === "boolean") settings[key] = saved[key];
  }
  if (settings.syncZoom) settings.outputFont = settings.inputFont;

  if (settings.saveContent) {
    if (typeof saved.savedInput === "string") settings.savedInput = saved.savedInput.slice(0, MAX_SAVED_CHARS);
    if (typeof saved.savedOutput === "string") settings.savedOutput = saved.savedOutput.slice(0, MAX_SAVED_CHARS);
    if (typeof saved.sourceName === "string") settings.sourceName = saved.sourceName.slice(0, 200);
    settings.outputKind = isOutputKind(saved.outputKind) ? saved.outputKind : null;
  }

  return settings;
}
