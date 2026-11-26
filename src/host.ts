import type { MarkdownView } from "obsidian";
import type { ObsidiFormatSettings } from "./types";

/** Plugin surface the view needs. Kept separate so the formatter tests do not import Obsidian. */
export interface FormatHost {
  settings: ObsidiFormatSettings;
  saveSettings(): Promise<void>;
  onSettingsChange(listener: (settings: ObsidiFormatSettings) => void): () => void;
  getMarkdownTarget(): MarkdownView | null;
}
