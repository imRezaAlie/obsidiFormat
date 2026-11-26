import { MarkdownView, Menu, MenuItem, Notice, Plugin, type Editor } from "obsidian";
import { process } from "./formatters";
import type { FormatHost } from "./host";
import { indentUnit, sanitizeSettings, selectedFormat } from "./settings-data";
import { ObsidiFormatSettingTab } from "./settings";
import {
  DEFAULT_SETTINGS,
  VIEW_TYPE,
  type FormatAction,
  type ObsidiFormatSettings,
  type SelectedFormat,
} from "./types";
import { copyText } from "./utils/clipboard";
import { errorMessage } from "./utils/validation";
import { ObsidiFormatView } from "./views/ObsidiFormatView";

export default class ObsidiFormatPlugin extends Plugin implements FormatHost {
  settings: ObsidiFormatSettings = { ...DEFAULT_SETTINGS };
  private readonly listeners = new Set<(settings: ObsidiFormatSettings) => void>();
  private notifying = false;
  private lastMarkdown: MarkdownView | null = null;

  async onload(): Promise<void> {
    const raw = (await this.loadData()) as unknown;
    this.settings = sanitizeSettings(raw);
    if (this.shouldScrubStoredContent(raw)) await this.saveData(this.settings);

    this.registerView(VIEW_TYPE, (leaf) => new ObsidiFormatView(leaf, this));
    this.addSettingTab(new ObsidiFormatSettingTab(this.app, this));

    this.addRibbonIcon("braces", "Open Payload Formatter", () => {
      void this.openView("tab");
    });

    this.addCommand({
      id: "open",
      name: "Open",
      callback: () => {
        void this.openView("tab");
      },
    });
    this.addCommand({
      id: "open-sidebar",
      name: "Open in sidebar",
      callback: () => {
        void this.openView("sidebar");
      },
    });
    this.addCommand({
      id: "format-selected-json",
      name: "Format selected JSON",
      editorCallback: (editor) => this.formatInEditor(editor, "beautify", "json"),
    });
    this.addCommand({
      id: "format-selected-xml",
      name: "Format selected XML",
      editorCallback: (editor) => this.formatInEditor(editor, "beautify", "xml"),
    });
    this.addCommand({
      id: "format-selected-soap",
      name: "Format selected SOAP",
      editorCallback: (editor) => this.formatInEditor(editor, "beautify", "soap"),
    });
    this.addCommand({
      id: "auto-format-selection",
      name: "Auto format selection",
      editorCallback: (editor) => this.formatInEditor(editor, "beautify", selectedFormat(this.settings)),
    });
    this.addCommand({
      id: "minify-selected-json",
      name: "Minify selected JSON",
      editorCallback: (editor) => this.formatInEditor(editor, "minify", "json"),
    });
    this.addCommand({
      id: "send-selection",
      name: "Send selection",
      editorCallback: (editor) => {
        void this.sendSelection(editor);
      },
    });
    this.addCommand({
      id: "insert-output",
      name: "Insert output",
      callback: () => this.insertOutput(),
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        this.addEditorMenu(menu, editor);
      }),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof MarkdownView) this.lastMarkdown = leaf.view;
      }),
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.enforceSingleView();
      }),
    );

    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) this.lastMarkdown = active;
  }

  onunload(): void {
    this.listeners.clear();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    if (this.notifying) return;
    this.notifying = true;
    try {
      for (const listener of this.listeners) listener(this.settings);
    } finally {
      this.notifying = false;
    }
  }

  onSettingsChange(listener: (settings: ObsidiFormatSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getMarkdownTarget(): MarkdownView | null {
    const active = this.editableMarkdown(this.app.workspace.getActiveViewOfType(MarkdownView));
    if (active) return active;
    const remembered = this.editableMarkdown(this.lastMarkdown);
    if (remembered) return remembered;
    let found: MarkdownView | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (found) return;
      if (leaf.view instanceof MarkdownView) found = this.editableMarkdown(leaf.view);
    });
    return found;
  }

  private editableMarkdown(view: MarkdownView | null): MarkdownView | null {
    if (!view || view.leaf.view !== view || view.getMode() !== "source") return null;
    try {
      return view.editor ? view : null;
    } catch {
      return null;
    }
  }

  private async openView(location: "tab" | "sidebar"): Promise<ObsidiFormatView | null> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    const leaf = existing[0] ?? (location === "sidebar" ? this.app.workspace.getRightLeaf(false) : this.app.workspace.getLeaf("tab"));
    if (!leaf) {
      new Notice("Unable to open Payload Formatter.");
      return null;
    }
    if (leaf.view.getViewType() !== VIEW_TYPE) {
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    this.enforceSingleView();
    return leaf.view instanceof ObsidiFormatView ? leaf.view : null;
  }

  private enforceSingleView(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length <= 1) return;
    const active = this.app.workspace.getActiveViewOfType(ObsidiFormatView);
    const keep = (active && leaves.find((leaf) => leaf.view === active)) || leaves[0];
    for (const leaf of leaves) {
      if (leaf !== keep) leaf.detach();
    }
  }

  private addEditorMenu(menu: Menu, editor: Editor): void {
    const hasSelection = editor.getSelection().trim().length > 0;
    const host = MenuItem.prototype as unknown as { setSubmenu?: () => Menu };
    if (typeof host.setSubmenu === "function") {
      menu.addItem((item) => {
        item.setTitle("Payload Formatter").setIcon("braces").setSection("obsidi-format");
        const submenu = (item as MenuItem & { setSubmenu: () => Menu }).setSubmenu();
        this.addFormatMenuItems(submenu, editor, hasSelection);
      });
      return;
    }
    this.addFormatMenuItems(menu, editor, hasSelection);
  }

  private addFormatMenuItems(menu: Menu, editor: Editor, hasSelection: boolean): void {
    const needsSelection = !hasSelection;
    this.menuItem(menu, "Open Payload Formatter", "braces", false, () => {
      void this.openView("tab");
    });
    this.menuItem(menu, "Auto format selection", "sparkles", needsSelection, () => {
      this.formatInEditor(editor, "beautify", selectedFormat(this.settings));
    });
    this.menuItem(menu, "Format selected JSON", "braces", needsSelection, () => {
      this.formatInEditor(editor, "beautify", "json");
    });
    this.menuItem(menu, "Format selected XML", "code", needsSelection, () => {
      this.formatInEditor(editor, "beautify", "xml");
    });
    this.menuItem(menu, "Format selected SOAP", "file-code", needsSelection, () => {
      this.formatInEditor(editor, "beautify", "soap");
    });
    this.menuItem(menu, "Minify selected JSON", "minimize-2", needsSelection, () => {
      this.formatInEditor(editor, "minify", "json");
    });
    this.menuItem(menu, "Send selection to Payload Formatter", "send", needsSelection, () => {
      void this.sendSelection(editor);
    });
    this.menuItem(menu, "Insert Payload Formatter output", "clipboard-paste", false, () => {
      this.insertOutput();
    });
  }

  private menuItem(menu: Menu, title: string, icon: string, disabled: boolean, onClick: () => void): void {
    menu.addItem((item) => {
      item.setTitle(title).setIcon(icon).setSection("obsidi-format").setDisabled(disabled).onClick(onClick);
    });
  }

  private formatInEditor(editor: Editor, action: FormatAction, selected: SelectedFormat): void {
    const original = editor.getSelection();
    if (!original.trim()) {
      new Notice("Select the JSON, XML, or SOAP text to format.");
      return;
    }
    try {
      const result = process(original, action, selected, indentUnit(this.settings));
      editor.replaceSelection(result.text);
      const language = result.soapVersion || (result.language === "json" ? "JSON" : result.language === "xml" ? "XML" : result.language === "soap" ? "SOAP" : result.language);
      new Notice(action === "minify" ? `Minified ${language}.` : `Formatted ${language}.`);
      if (this.settings.outputPreference === "panel-and-clipboard") {
        void copyText(result.text).then((copied) => {
          if (copied !== "clipboard") new Notice("Formatted the selection. Clipboard copy was denied.");
        });
      }
    } catch (error) {
      new Notice(errorMessage(error));
    }
  }

  private async sendSelection(editor: Editor): Promise<void> {
    const text = editor.getSelection();
    if (!text.trim()) {
      new Notice("Select text to send to Payload Formatter.");
      return;
    }
    const view = await this.openView("tab");
    if (!view) return;
    view.loadInput(text, "selection");
    new Notice("Selection sent to Payload Formatter.");
  }

  private insertOutput(): void {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (!(view instanceof ObsidiFormatView)) {
      new Notice("Open Payload Formatter before inserting its output.");
      return;
    }
    view.insertIntoActiveNote();
  }

  private shouldScrubStoredContent(raw: unknown): boolean {
    if (!raw || typeof raw !== "object") return false;
    const data = raw as { saveContent?: unknown; savedInput?: unknown; savedOutput?: unknown };
    return data.saveContent === false && (typeof data.savedInput === "string" || typeof data.savedOutput === "string") && (Boolean(data.savedInput) || Boolean(data.savedOutput));
  }
}
