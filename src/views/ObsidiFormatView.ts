import CodeMirror from "codemirror";
import type { Editor, EditorChange, EditorConfiguration, TextMarker } from "codemirror";
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import "codemirror/mode/javascript/javascript";
import "codemirror/mode/xml/xml";
import "codemirror/addon/dialog/dialog";
import "codemirror/addon/search/searchcursor";
import "codemirror/addon/search/search";
import "codemirror/addon/fold/foldcode";
import "codemirror/addon/fold/foldgutter";
import "codemirror/addon/fold/brace-fold";
import "codemirror/addon/fold/xml-fold";
import "codemirror/addon/edit/matchbrackets";
import "codemirror/addon/edit/closebrackets";
import "codemirror/addon/edit/matchtags";
import "codemirror/addon/selection/active-line";
import {
  decode,
  decodeXmlDocument,
  decodeXmlEntities,
  deepDecodeXml,
  detect,
  encodeXmlEntities,
  escapeString,
  extractEmbedded,
  looksEncodedXml,
  process,
  unescapeString,
} from "../formatters";
import type { FormatHost } from "../host";
import { clamp, fontSize, indentUnit, indentWidth, selectedFormat } from "../settings-data";
import {
  FormatError,
  MAX_INPUT,
  MAX_OUTPUT,
  MAX_SAVED_CHARS,
  VIEW_TYPE,
  type EditorSide,
  type FormatAction,
  type OutputKind,
} from "../types";
import { copyText, readClipboard } from "../utils/clipboard";
import { errorMessage } from "../utils/validation";
import { icon, mountIcons, setIcon } from "./icons";
import { SAMPLES } from "./samples";

const BASE_FONT = 14;

type Validation = "ready" | "valid" | "invalid" | "pending" | "transformed";

interface SideState {
  validation: Validation;
  language: string;
  mark: TextMarker | null;
  errorLine: number | null;
  modeSet: boolean;
}

interface LastError {
  side: EditorSide;
  line: number;
  ch: number;
}

let modesReady = false;

function installModes(): void {
  if (modesReady) return;
  modesReady = true;
  const enhance = (name: string, config: { name: string; json?: boolean; htmlMode?: boolean }, language: string) => {
    CodeMirror.defineMode(name, (editorConfig) => {
      const mode = CodeMirror.getMode(editorConfig, config);
      const original = mode.token?.bind(mode);
      mode.token = (stream, state) => {
        const style = original ? original(stream, state) ?? null : null;
        const value = stream.current();
        const classes = style ? style.split(" ") : [];
        let next = style ?? "";
        if (language === "json") {
          if (classes.includes("atom") && value === "null") next = `${next} null-literal`.trim();
          if (!style && "{}[],:".includes(value)) next = "punctuation";
        } else if ((classes.includes("tag") && !classes.includes("bracket")) || classes.includes("attribute")) {
          if (value.includes(":") || value === "xmlns") next = `${next} xml-namespace`.trim();
          if (language === "soap" && classes.includes("tag") && /^(?:[^:]+:)?(?:Envelope|Header|Body|Fault)$/.test(value)) {
            next = `${next} soap-node`.trim();
          }
        }
        return next || null;
      };
      return mode;
    });
  };
  enhance("beautifier-json", { name: "javascript", json: true }, "json");
  enhance("beautifier-xml", { name: "xml", htmlMode: false }, "xml");
  enhance("beautifier-soap", { name: "xml", htmlMode: false }, "soap");
}

function labelLanguage(language: string): string {
  const labels: Record<string, string> = {
    json: "JSON",
    xml: "XML",
    soap: "SOAP",
    empty: "Auto",
    text: "Text",
    "encoded-xml": "Encoded XML",
  };
  return labels[language] ?? "Auto";
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(bytes / 1024 < 10 ? 2 : 1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

function button(parent: HTMLElement, className: string, label: string, action: string, iconName?: string, editor?: EditorSide): HTMLButtonElement {
  const node = createEl("button");
  node.type = "button";
  node.className = className;
  node.dataset.action = action;
  if (editor) node.dataset.editor = editor;
  if (iconName) icon(node, iconName);
  if (label) {
    const text = createSpan();
    text.textContent = label;
    node.append(text);
  }
  parent.append(node);
  return node;
}

export class ObsidiFormatView extends ItemView {
  private readonly plugin: FormatHost;
  private readonly disposers: Array<() => void> = [];
  private readonly editors: Partial<Record<EditorSide, Editor>> = {};
  private readonly side: Record<EditorSide, SideState> = {
    input: { validation: "ready", language: "empty", mark: null, errorLine: null, modeSet: false },
    output: { validation: "ready", language: "empty", mark: null, errorLine: null, modeSet: false },
  };
  private root!: HTMLElement;
  private workspace!: HTMLElement;
  private splitter!: HTMLElement;
  private formatSelect!: HTMLSelectElement;
  private indentSelect!: HTMLSelectElement;
  private sampleSelect!: HTMLSelectElement;
  private workspaceMode!: HTMLElement;
  private layoutButton!: HTMLButtonElement;
  private fullscreenButton!: HTMLButtonElement;
  private zoomDisplay!: HTMLButtonElement;
  private autoFormatInput!: HTMLInputElement;
  private messageBar!: HTMLElement;
  private messageText!: HTMLElement;
  private jumpError!: HTMLButtonElement;
  private messageIcon!: SVGSVGElement;
  private fileInput!: HTMLInputElement;
  private dropOverlay!: HTMLElement;
  private readonly dialogs = new Map<string, HTMLDialogElement>();
  private readonly pills: Partial<Record<EditorSide, HTMLElement>> = {};
  private readonly hints: Partial<Record<EditorSide, HTMLElement>> = {};
  private readonly dots: Partial<Record<EditorSide, HTMLElement>> = {};
  private readonly notes: Partial<Record<EditorSide, HTMLElement>> = {};
  private readonly counts: Partial<Record<EditorSide, HTMLElement>> = {};
  private readonly sizes: Partial<Record<EditorSide, HTMLElement>> = {};
  private statusScope!: HTMLElement;
  private statusValidation!: HTMLElement;
  private statusLanguage!: HTMLElement;
  private statusLines!: HTMLElement;
  private statusChars!: HTMLElement;
  private statusBytes!: HTMLElement;
  private statusCursor!: HTMLElement;
  private statusIndent!: HTMLElement;
  private statusZoom!: HTMLElement;
  private statusTime!: HTMLElement;
  private syncZoomInput!: HTMLInputElement;
  private formatOnPasteInput!: HTMLInputElement;
  private autoDecodeInput!: HTMLInputElement;
  private saveContentInput!: HTMLInputElement;
  private inputFontInput!: HTMLInputElement;
  private outputFontInput!: HTMLInputElement;
  private activeSide: EditorSide = "input";
  private outputKind: OutputKind | null = null;
  private sourceName = "";
  private lastTime: number | null = null;
  private maxPanel: EditorSide | null = null;
  private lastError: LastError | null = null;
  private suppress = 0;
  private writing = false;
  private saveLimitNotified = false;
  private dragId: number | null = null;
  private dragDepth = 0;
  private autoTimer = 0;
  private saveTimer = 0;
  private pendingFrame = 0;
  private wheelTime = 0;
  private resizeObserver: ResizeObserver | null = null;
  private readonly measureTimers: Partial<Record<EditorSide, number>> = {};
  private readonly encoder = new TextEncoder();

  constructor(leaf: WorkspaceLeaf, plugin: FormatHost) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Payload Formatter";
  }

  getIcon(): string {
    return "braces";
  }

  async onOpen(): Promise<void> {
    installModes();
    this.contentEl.empty();
    this.contentEl.addClass("obsidi-format-view");
    this.root = this.contentEl.createDiv({ cls: "obsidi-format" });
    const sprite = createSvg("svg");
    mountIcons(sprite);
    this.root.append(sprite);
    this.buildHeader();
    this.buildToolbar();
    this.buildWorkspaceHeading();
    this.buildWorkspace();
    this.buildMessage();
    this.buildStatus();
    this.buildDialogs();
    this.fileInput = createEl("input");
    this.fileInput.type = "file";
    this.fileInput.hidden = true;
    this.fileInput.accept = ".json,.xml,.soap,.txt,.request,.response,application/json,application/xml,text/xml,text/plain";
    this.root.append(this.fileInput);
    this.mountEditors();
    this.bindEvents();
    this.applyPrefs();
    this.restoreContent();
    this.active("input");
  }

  async onClose(): Promise<void> {
    window.clearTimeout(this.autoTimer);
    window.clearTimeout(this.saveTimer);
    for (const timer of Object.values(this.measureTimers)) window.clearTimeout(timer);
    if (this.plugin.settings.saveContent) this.writeContent();
    for (const dialog of this.dialogs.values()) {
      if (dialog.open) dialog.close();
    }
    if (document.fullscreenElement === this.root) {
      void document.exitFullscreen().catch(() => undefined);
    }
    this.dispose();
    for (const cm of Object.values(this.editors)) cm.getWrapperElement().remove();
    this.contentEl.empty();
    this.contentEl.removeClass("obsidi-format-view");
  }

  loadInput(text: string, name = "", forceFormat = false): boolean {
    if (text.length > MAX_INPUT) {
      new Notice("Input exceeds the 20 Mi-character limit.");
      return false;
    }
    window.clearTimeout(this.autoTimer);
    this.sourceName = name;
    this.lastTime = null;
    this.replace("input", text);
    if (this.maxPanel === "output") this.maximize("output");
    this.active("input");
    this.message("Input loaded. Choose Beautify, Minify or Validate.");
    if (forceFormat || this.plugin.settings.autoFormat) this.scheduleFormat();
    this.scheduleSave();
    return true;
  }

  insertIntoActiveNote(): void {
    const text = this.value("output");
    if (!text) {
      new Notice("Output is empty. Format or transform code first.");
      return;
    }
    const markdown = this.plugin.getMarkdownTarget();
    if (!markdown) {
      new Notice("Open a Markdown note in editing mode to insert the output.");
      return;
    }
    markdown.editor.replaceSelection(text);
    new Notice("Inserted formatted output into the note. The note was not saved.");
  }

  private buildHeader(): void {
    const header = createEl("header");
    header.className = "ff-header";
    const brand = createDiv();
    brand.className = "ff-brand";
    const mark = createDiv();
    mark.className = "ff-brand-icon";
    icon(mark, "braces");
    const titles = createDiv();
    const heading = createEl("h1");
    heading.append("Payload", createSpan({ text: "Formatter" }));
    const subtitle = createEl("p");
    subtitle.textContent = "FORMAT  ·  VALIDATE  ·  TRANSFORM";
    titles.append(heading, subtitle);
    brand.append(mark, titles);
    const end = createDiv();
    end.className = "ff-header-end";
    const privacy = createSpan();
    privacy.className = "ff-privacy";
    privacy.title = "No network requests. All code is processed on this device.";
    icon(privacy, "shield");
    privacy.append(createSpan({ text: "Local & private" }));
    const version = createSpan();
    version.className = "ff-version";
    version.textContent = "v1.0.3";
    const help = button(end, "ff-icon-button", "", "help", "keyboard");
    help.setAttribute("aria-label", "Keyboard shortcuts");
    help.title = "Keyboard shortcuts";
    end.prepend(privacy, version);
    header.append(brand, end);
    this.root.append(header);
  }

  private buildToolbar(): void {
    const bar = createDiv();
    bar.className = "ff-toolbar";
    const formatGroup = createDiv();
    formatGroup.className = "ff-group";
    formatGroup.append(this.labeledSelect("Format", "ff-format-select", [
      ["auto", "Auto detect"],
      ["json", "JSON"],
      ["xml", "XML"],
      ["soap", "SOAP"],
    ]));
    this.formatSelect = formatGroup.querySelector("select") as HTMLSelectElement;

    const actions = createDiv();
    actions.className = "ff-group";
    const beautify = button(actions, "ff-button mod-cta", "Beautify", "beautify", "format");
    const kbd = createEl("kbd");
    kbd.textContent = "Ctrl ↵";
    beautify.append(kbd);
    beautify.title = "Beautify (Ctrl+Enter)";
    button(actions, "ff-button", "Minify", "minify", "minify").title = "Minify (Ctrl+Shift+M)";
    button(actions, "ff-button", "Validate", "validate", "check").title = "Validate input";

    const files = createDiv();
    files.className = "ff-group";
    button(files, "ff-button", "Copy", "copy", "copy").title = "Copy output (Ctrl+Shift+C)";
    button(files, "ff-button", "Clear", "clear", "trash").title = "Clear both editors";
    button(files, "ff-button", "Upload", "upload", "upload").title = "Upload a local file";
    button(files, "ff-button", "Download", "download", "download").title = "Download output";
    button(files, "ff-button", "Insert", "insert", "note").title = "Insert output into the active note";

    const tools = createDiv();
    tools.className = "ff-group ff-group-end";
    tools.append(this.labeledSelect("Indent", "ff-indent-select", [
      ["2", "2 spaces"],
      ["4", "4 spaces"],
      ["8", "8 spaces"],
      ["tab", "Tab"],
    ]));
    this.indentSelect = tools.querySelector("select") as HTMLSelectElement;
    const zoom = createDiv();
    zoom.className = "ff-zoom";
    zoom.setAttribute("aria-label", "Active editor zoom");
    button(zoom, "ff-icon-button", "", "zoom-out", "minus").setAttribute("aria-label", "Zoom out");
    this.zoomDisplay = button(zoom, "ff-zoom-value", "100%", "zoom-reset");
    button(zoom, "ff-icon-button", "", "zoom-in", "plus").setAttribute("aria-label", "Zoom in");
    tools.append(zoom);
    this.layoutButton = button(tools, "ff-icon-button", "", "layout", "layout");
    this.layoutButton.setAttribute("aria-label", "Switch split layout");
    this.fullscreenButton = button(tools, "ff-icon-button", "", "fullscreen", "expand");
    this.fullscreenButton.setAttribute("aria-label", "Full screen");
    button(tools, "ff-icon-button", "", "settings", "settings").setAttribute("aria-label", "Settings");
    bar.append(formatGroup, actions, files, tools);
    this.root.append(bar);
  }

  private buildWorkspaceHeading(): void {
    const row = createDiv();
    row.className = "ff-workspace-head";
    const title = createDiv();
    title.className = "ff-workspace-title";
    const dot = createSpan();
    dot.className = "ff-live-dot";
    title.append(dot, "WORKSPACE", createSpan({ cls: "ff-divider", text: "/" }));
    this.workspaceMode = createSpan();
    this.workspaceMode.className = "ff-mode";
    this.workspaceMode.textContent = "Auto detect";
    title.append(this.workspaceMode);
    const options = createDiv();
    options.className = "ff-workspace-options";
    const label = createEl("label");
    label.className = "ff-toggle";
    label.title = "Format automatically after edits";
    this.autoFormatInput = createEl("input");
    this.autoFormatInput.type = "checkbox";
    const switchUi = createSpan();
    switchUi.className = "ff-switch";
    label.append(this.autoFormatInput, switchUi, "Auto format");
    options.append(label);
    const swap = button(options, "ff-text-button", "Swap", "swap", "swap");
    swap.title = "Swap input and output";
    row.append(title, options);
    this.root.append(row);
  }

  private buildWorkspace(): void {
    this.workspace = createDiv();
    this.workspace.className = "ff-workspace";
    this.workspace.setAttribute("aria-label", "Code editors");
    this.workspace.append(this.panel("input", "Raw Input", "01"), this.makeSplitter(), this.panel("output", "Formatted Output", "02"));
    this.root.append(this.workspace);
  }

  private panel(side: EditorSide, title: string, index: string): HTMLElement {
    const section = createEl("section");
    section.className = `ff-panel ff-panel-${side}`;
    const head = createDiv();
    head.className = "ff-panel-head";
    const heading = createDiv();
    heading.className = "ff-panel-title";
    const idx = createSpan();
    idx.className = "ff-index";
    idx.textContent = index;
    const h = createEl("h2");
    h.textContent = title;
    const pill = createSpan();
    pill.className = "ff-pill";
    pill.textContent = "AUTO";
    this.pills[side] = pill;
    heading.append(idx, h, pill);
    const actions = createDiv();
    actions.className = "ff-panel-actions";
    if (side === "input") button(actions, "ff-icon-button", "", "paste", "paste", side).setAttribute("aria-label", "Paste from clipboard");
    else button(actions, "ff-icon-button", "", "copy", "copy", side).setAttribute("aria-label", "Copy output");
    button(actions, "ff-icon-button", "", "search", "search", side).setAttribute("aria-label", `Search ${side}`);
    const wrap = button(actions, "ff-icon-button", "", "wrap", "wrap", side);
    wrap.setAttribute("aria-label", `Toggle ${side} word wrap`);
    wrap.setAttribute("aria-pressed", "false");
    const full = button(actions, "ff-icon-button", "", "panel-full", "expand", side);
    full.setAttribute("aria-label", `Maximize ${side} editor`);
    head.append(heading, actions);

    const sub = createDiv();
    sub.className = "ff-subbar";
    if (side === "input") {
      const sample = createEl("label");
      sample.className = "ff-sample";
      icon(sample, "file");
      this.sampleSelect = createEl("select");
      this.sampleSelect.title = "Load sample data";
      for (const [value, text] of [
        ["", "Load sample…"],
        ["json", "JSON object"],
        ["xml", "XML document"],
        ["soap-request", "SOAP request"],
        ["soap-response", "SOAP response"],
        ["escaped", "Escaped JSON"],
        ["escaped-xml", "Escaped XML"],
        ["double-xml", "Double-escaped XML"],
        ["embedded-soap", "SOAP with embedded XML"],
        ["embedded-json", "SOAP with embedded JSON"],
      ] as const) {
        const option = createEl("option");
        option.value = value;
        option.textContent = text;
        this.sampleSelect.append(option);
      }
      sample.append(this.sampleSelect);
      sub.append(sample);
    } else {
      const transforms = createDiv();
      transforms.className = "ff-transforms";
      button(transforms, "ff-text-button", "XML Tools", "xml-tools", "code").title = "XML entity and embedded payload tools";
      button(transforms, "ff-text-button", "Escape", "escape").title = "Escape input as a JSON string";
      button(transforms, "ff-text-button", "Unescape", "unescape").title = "Unescape a JSON string";
      button(transforms, "ff-text-button", "Decode JSON", "decode", "code").title = "Decode a string into a formatted JSON object or array";
      sub.append(transforms);
    }
    const right = createDiv();
    right.className = "ff-subbar-right";
    button(right, "ff-icon-button ff-tiny", "", "fold", "fold", side).setAttribute("aria-label", `Fold all ${side} nodes`);
    button(right, "ff-icon-button ff-tiny", "", "unfold", "unfold", side).setAttribute("aria-label", `Unfold all ${side} nodes`);
    const size = createSpan();
    size.className = "ff-size";
    size.textContent = "0 B";
    this.sizes[side] = size;
    right.append(size);
    sub.append(right);

    const body = createDiv();
    body.className = "ff-editor-body";
    body.dataset.editor = side;
    const hint = createDiv();
    hint.className = side === "input" ? "ff-hint" : "ff-hint ff-hint-output";
    if (side === "input") {
      hint.append(createSpan({ text: "Paste JSON, XML or SOAP here" }), createSpan({ text: "or drop a file to begin." }));
      this.dropOverlay = createDiv();
      this.dropOverlay.className = "ff-drop";
      icon(this.dropOverlay, "upload");
      const strong = createEl("strong");
      strong.textContent = "Drop your file here";
      const note = createSpan();
      note.textContent = "JSON / XML / SOAP / TXT";
      this.dropOverlay.append(strong, note);
      body.append(this.dropOverlay);
    } else {
      const glyph = createDiv();
      glyph.className = "ff-empty-icon";
      icon(glyph, "braces");
      const strong = createEl("strong");
      strong.textContent = "Formatted code appears here";
      const note = createSpan();
      note.textContent = "Run Beautify, Minify or a JSON / XML tool.";
      hint.append(glyph, strong, note);
    }
    this.hints[side] = hint;
    body.append(hint);

    const footer = createDiv();
    footer.className = "ff-footer";
    const left = createSpan();
    const dot = createSpan();
    dot.className = "ff-dot is-ready";
    const note = createSpan();
    note.textContent = side === "input" ? "Ready for input" : "Awaiting formatting";
    this.dots[side] = dot;
    this.notes[side] = note;
    left.append(dot, note);
    const count = createSpan();
    count.textContent = "1 line · 0 chars";
    this.counts[side] = count;
    footer.append(left, count);
    section.append(head, sub, body, footer);
    return section;
  }

  private makeSplitter(): HTMLElement {
    this.splitter = createDiv();
    this.splitter.className = "ff-splitter";
    this.splitter.tabIndex = 0;
    this.splitter.setAttribute("role", "separator");
    this.splitter.setAttribute("aria-label", "Resize editor panels");
    this.splitter.setAttribute("aria-orientation", "vertical");
    this.splitter.setAttribute("aria-valuemin", "15");
    this.splitter.setAttribute("aria-valuemax", "85");
    this.splitter.setAttribute("aria-valuenow", "50");
    const bar = createSpan();
    this.splitter.append(bar);
    return this.splitter;
  }

  private buildMessage(): void {
    this.messageBar = createDiv();
    this.messageBar.className = "ff-message is-info";
    this.messageBar.setAttribute("role", "status");
    this.messageIcon = icon(this.messageBar, "alert");
    this.messageText = createSpan();
    this.messageText.textContent = "Ready. Paste code or load a sample to get started.";
    this.jumpError = createEl("button");
    this.jumpError.type = "button";
    this.jumpError.className = "ff-text-button";
    this.jumpError.textContent = "Go to error";
    this.jumpError.hidden = true;
    const dismiss = button(createDiv(), "ff-icon-button", "", "dismiss", "close");
    dismiss.setAttribute("aria-label", "Dismiss message");
    this.messageBar.append(this.messageText, this.jumpError, dismiss);
    this.root.append(this.messageBar);
  }

  private buildStatus(): void {
    const bar = createEl("footer");
    bar.className = "ff-status";
    const left = createDiv();
    const right = createDiv();
    this.statusScope = this.statusItem(left, "INPUT");
    this.statusValidation = createSpan();
    this.statusValidation.textContent = "Ready";
    left.append(this.statusValidation);
    this.statusLanguage = this.statusItem(left, "Auto");
    this.statusLines = this.statusItem(left, "1 Ln");
    this.statusChars = this.statusItem(left, "0 Ch");
    this.statusBytes = this.statusItem(left, "0 B");
    this.statusCursor = this.statusItem(right, "Ln 1, Col 1");
    this.statusIndent = this.statusItem(right, "Spaces: 2");
    this.statusZoom = this.statusItem(right, "100%");
    this.statusTime = this.statusItem(right, "— ms");
    const local = createSpan();
    local.className = "ff-local";
    icon(local, "shield");
    local.append("Offline");
    right.append(local);
    bar.append(left, right);
    this.root.append(bar);
  }

  private statusItem(parent: HTMLElement, text: string): HTMLElement {
    const span = createSpan();
    span.textContent = text;
    parent.append(span);
    return span;
  }

  private buildDialogs(): void {
    this.dialogs.set("settings", this.settingsDialog());
    this.dialogs.set("help", this.helpDialog());
    this.dialogs.set("xml-tools", this.xmlDialog());
    for (const dialog of this.dialogs.values()) this.root.append(dialog);
  }

  private settingsDialog(): HTMLDialogElement {
    const dialog = this.dialogShell("settings", "WORKSPACE", "Settings");
    const body = dialog.querySelector(".ff-dialog-body") as HTMLElement;
    this.syncZoomInput = this.checkRow(body, "Synchronize editor zoom", "Apply zoom changes to both editors.");
    this.formatOnPasteInput = this.checkRow(body, "Auto format on paste", "Format valid input immediately after pasting.");
    this.autoDecodeInput = this.checkRow(body, "Auto-decode escaped XML", "Decode an entire entity-encoded XML document when beautifying or minifying. Entities inside valid XML stay untouched.");
    this.saveContentInput = this.checkRow(body, "Save editor contents locally", "Off by default. When enabled, code is stored unencrypted in this vault's plugin data. Turn off to delete saved content.");
    this.inputFontInput = this.numberRow(body, "Input font size", "10–40 px");
    this.outputFontInput = this.numberRow(body, "Output font size", "10–40 px");
    const foot = dialog.querySelector(".ff-dialog-foot") as HTMLElement;
    button(foot, "ff-button", "Reset preferences", "reset-preferences");
    const done = button(foot, "ff-button mod-cta", "Done", "noop");
    done.dataset.close = "settings";
    done.removeAttribute("data-action");
    return dialog;
  }

  private helpDialog(): HTMLDialogElement {
    const dialog = this.dialogShell("help", "PRODUCTIVITY", "Keyboard shortcuts");
    const body = dialog.querySelector(".ff-dialog-body") as HTMLElement;
    body.classList.add("ff-shortcuts");
    for (const [label, keys] of [
      ["Beautify", "Ctrl + Enter"],
      ["Minify", "Ctrl + Shift + M"],
      ["Copy output", "Ctrl + Shift + C"],
      ["Search active editor", "Ctrl + F"],
      ["Find next / previous", "Ctrl + G / Shift + Ctrl + G"],
      ["Zoom in / out", "Ctrl + + / -"],
      ["Reset zoom", "Ctrl + 0"],
      ["Editor wheel zoom", "Ctrl + Scroll"],
      ["Full screen", "F11"],
      ["Exit maximized panel", "Esc"],
    ] as const) {
      const row = createDiv();
      const name = createSpan();
      name.textContent = label;
      const kbd = createEl("kbd");
      kbd.textContent = keys;
      row.append(name, kbd);
      body.append(row);
    }
    const note = createEl("p");
    note.textContent = "On macOS, Cmd also works for Ctrl shortcuts while Payload Formatter is focused. Drag this tab into a sidebar to dock it. These shortcuts do not change the rest of the note.";
    body.append(note);
    return dialog;
  }

  private xmlDialog(): HTMLDialogElement {
    const dialog = this.dialogShell("xml-tools", "TRANSFORM / XML", "XML Tools");
    const body = dialog.querySelector(".ff-dialog-body") as HTMLElement;
    const tools: Array<[string, string, string, string, boolean]> = [
      ["xml-beautify", "format", "Decode & Beautify XML", "Decode up to 20 layers, validate and format a complete XML or SOAP document.", true],
      ["xml-extract", "file", "Extract Embedded XML", "Find and format XML stored as escaped text or CDATA inside SOAP/XML.", true],
      ["json-extract", "braces", "Extract Embedded JSON", "Find and format JSON objects or arrays stored as text inside SOAP/XML.", false],
      ["xml-decode", "code", "XML Decode (one layer)", "Convert &lt;, &gt;, &quot;, &amp; and numeric references to literal characters.", false],
      ["xml-deep", "unfold", "Deep Decode XML", "Decode up to 20 layers; stop when XML markup is exposed to preserve inner entities.", false],
      ["xml-encode", "code", "XML Encode", "Escape ampersands, angle brackets, quotes and apostrophes for XML text.", false],
    ];
    for (const [action, iconName, title, detail, safe] of tools) {
      const card = createEl("button");
      card.type = "button";
      card.className = safe ? "ff-tool is-safe" : "ff-tool";
      card.dataset.action = action;
      icon(card, iconName);
      const copy = createSpan();
      const strong = createEl("strong");
      strong.textContent = title;
      const small = createEl("small");
      small.textContent = detail;
      copy.append(strong, small);
      card.append(copy);
      if (safe) {
        const tag = createSpan();
        tag.className = "ff-tool-tag";
        tag.textContent = "SAFE";
        card.append(tag);
      }
      body.append(card);
    }
    return dialog;
  }

  private dialogShell(name: string, eyebrow: string, title: string): HTMLDialogElement {
    const dialog = createEl("dialog");
    dialog.className = "ff-dialog";
    dialog.dataset.dialog = name;
    const head = createDiv();
    head.className = "ff-dialog-head";
    const titles = createDiv();
    const eye = createSpan();
    eye.className = "ff-eyebrow";
    eye.textContent = eyebrow;
    const h = createEl("h2");
    h.textContent = title;
    titles.append(eye, h);
    const close = button(createDiv(), "ff-icon-button", "", "noop", "close");
    close.dataset.close = name;
    close.removeAttribute("data-action");
    close.setAttribute("aria-label", `Close ${title}`);
    head.append(titles, close);
    const body = createDiv();
    body.className = "ff-dialog-body";
    const foot = createDiv();
    foot.className = "ff-dialog-foot";
    if (name !== "settings") {
      const done = button(foot, "ff-button", "Close", "noop");
      done.dataset.close = name;
      done.removeAttribute("data-action");
    }
    dialog.append(head, body, foot);
    return dialog;
  }

  private checkRow(parent: HTMLElement, title: string, description: string): HTMLInputElement {
    const row = createDiv();
    row.className = "ff-setting-row";
    const copy = createDiv();
    const strong = createEl("strong");
    strong.textContent = title;
    const p = createEl("p");
    p.textContent = description;
    copy.append(strong, p);
    const label = createEl("label");
    label.className = "ff-toggle";
    const input = createEl("input");
    input.type = "checkbox";
    input.setAttribute("aria-label", title);
    const ui = createSpan();
    ui.className = "ff-switch";
    label.append(input, ui);
    row.append(copy, label);
    parent.append(row);
    return input;
  }

  private numberRow(parent: HTMLElement, title: string, description: string): HTMLInputElement {
    const row = createDiv();
    row.className = "ff-setting-row";
    const copy = createDiv();
    const strong = createEl("strong");
    strong.textContent = title;
    const p = createEl("p");
    p.textContent = description;
    copy.append(strong, p);
    const label = createEl("label");
    label.className = "ff-number";
    const input = createEl("input");
    input.type = "number";
    input.min = "10";
    input.max = "40";
    input.step = "1";
    input.setAttribute("aria-label", title);
    const unit = createSpan();
    unit.textContent = "px";
    label.append(input, unit);
    row.append(copy, label);
    parent.append(row);
    return input;
  }

  private labeledSelect(label: string, className: string, options: Array<[string, string]>): HTMLLabelElement {
    const field = createEl("label");
    field.className = `ff-select ${className}`;
    const span = createSpan();
    span.textContent = label;
    const select = createEl("select");
    select.setAttribute("aria-label", label);
    for (const [value, text] of options) {
      const option = createEl("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    field.append(span, select);
    return field;
  }

  private mountEditors(): void {
    for (const side of ["input", "output"] as const) {
      const host = this.root.querySelector(`.ff-panel-${side} .ff-editor-body`);
      if (!(host instanceof HTMLElement)) continue;
      const settings = this.plugin.settings;
      const width = indentWidth(settings);
      const options = {
        value: "",
        mode: settings.syntaxHighlighting ? "beautifier-json" : null,
        theme: "devtool",
        lineNumbers: true,
        styleActiveLine: true,
        indentUnit: width,
        tabSize: width,
        indentWithTabs: settings.indentType === "tabs",
        smartIndent: true,
        matchBrackets: true,
        autoCloseBrackets: true,
        lineWrapping: side === "input" ? settings.inputWrap : settings.outputWrap,
        foldGutter: true,
        gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter", "error-gutter"],
        viewportMargin: 10,
        inputStyle: "textarea",
        extraKeys: {
          Tab: (editor: Editor) => {
            if (editor.somethingSelected()) editor.indentSelection("add");
            else if (editor.getOption("indentWithTabs")) editor.replaceSelection("\t", "end");
            else editor.replaceSelection(" ".repeat(editor.getOption("indentUnit") ?? 2), "end");
          },
          "Shift-Tab": "indentLess",
          "Ctrl-F": "findPersistent",
          "Cmd-F": "findPersistent",
          "Ctrl-G": "findNext",
          "Cmd-G": "findNext",
          "Shift-Ctrl-G": "findPrev",
          "Shift-Cmd-G": "findPrev",
        },
      } as EditorConfiguration;
      const cm = CodeMirror(host, options);
      cm.setOption("maxHighlightLength", 20000);
      this.editors[side] = cm;
      cm.getInputField().setAttribute("aria-label", side === "input" ? "Raw input code" : "Formatted output code");
      cm.getWrapperElement().style.fontSize = `${side === "input" ? settings.inputFont : settings.outputFont}px`;
      const onFocus = () => this.active(side);
      const onCursor = () => {
        if (this.activeSide === side) this.updateStatus();
      };
      const onChange = (_editor: Editor, change: EditorChange) => this.onChange(side, change);
      const onBefore = (editor: Editor, change: EditorChange & { cancel(): void }) => this.onBeforeChange(side, editor, change);
      cm.on("focus", onFocus);
      cm.on("cursorActivity", onCursor);
      cm.on("change", onChange);
      cm.on("beforeChange", onBefore);
      this.disposers.push(() => {
        cm.off("focus", onFocus);
        cm.off("cursorActivity", onCursor);
        cm.off("change", onChange);
        cm.off("beforeChange", onBefore);
      });
      this.listen(cm.getWrapperElement(), "pointerdown", () => this.active(side));
      this.listen(
        cm.getWrapperElement(),
        "wheel",
        (event) => {
          if (!(event instanceof WheelEvent) || (!event.ctrlKey && !event.metaKey)) return;
          event.preventDefault();
          event.stopPropagation();
          this.active(side);
          const now = performance.now();
          if (now - this.wheelTime < 45) return;
          this.wheelTime = now;
          if (event.deltaY) this.zoom(event.deltaY < 0 ? 1 : -1, side);
        },
        { passive: false },
      );
    }
  }

  private bindEvents(): void {
    this.listen(this.root, "click", (event) => this.onClick(event));
    this.listen(this.root, "keydown", (event) => this.onKeyDown(event), true);
    this.listen(this.formatSelect, "change", () => this.onFormatChange());
    this.listen(this.indentSelect, "change", () => this.onIndentChange());
    this.listen(this.sampleSelect, "change", () => this.onSample());
    this.listen(this.fileInput, "change", () => {
      const file = this.fileInput.files?.[0];
      void this.upload(file);
      this.fileInput.value = "";
    });
    this.listen(this.autoFormatInput, "change", () => {
      this.plugin.settings.autoFormat = this.autoFormatInput.checked;
      this.persist(false);
      if (this.plugin.settings.autoFormat) this.scheduleFormat();
      else window.clearTimeout(this.autoTimer);
    });
    this.listen(this.autoDecodeInput, "change", () => {
      this.plugin.settings.autoDecodeXml = this.autoDecodeInput.checked;
      this.persist(false);
      if (this.plugin.settings.autoFormat) this.scheduleFormat();
    });
    this.listen(this.formatOnPasteInput, "change", () => {
      this.plugin.settings.formatOnPaste = this.formatOnPasteInput.checked;
      this.persist(false);
    });
    this.listen(this.syncZoomInput, "change", () => {
      this.plugin.settings.syncZoom = this.syncZoomInput.checked;
      if (this.plugin.settings.syncZoom) this.setZoom(this.activeSide, this.fontOf(this.activeSide));
      else this.persist(false);
    });
    this.listen(this.saveContentInput, "change", () => {
      this.plugin.settings.saveContent = this.saveContentInput.checked;
      window.clearTimeout(this.saveTimer);
      if (this.plugin.settings.saveContent) {
        this.writeContent();
        new Notice("Local content saving enabled.");
      } else {
        this.plugin.settings.savedInput = "";
        this.plugin.settings.savedOutput = "";
        this.plugin.settings.sourceName = "";
        this.plugin.settings.outputKind = null;
        this.persist(false);
        new Notice("Saved editor contents removed.");
      }
    });
    this.listen(this.inputFontInput, "change", () => this.setZoom("input", fontSize(Number(this.inputFontInput.value))));
    this.listen(this.outputFontInput, "change", () => this.setZoom("output", fontSize(Number(this.outputFontInput.value))));
    this.listen(this.jumpError, "click", () => this.jumpToError());
    this.bindSplitter();
    this.bindDrop();
    this.listen(document, "fullscreenchange", () => this.syncFullscreenButton());
    this.resizeObserver = new ResizeObserver(() => this.applyLayout());
    this.resizeObserver.observe(this.root);
    this.disposers.push(() => this.resizeObserver?.disconnect());
    this.disposers.push(this.plugin.onSettingsChange(() => this.applyExternalSettings()));
  }

  private bindSplitter(): void {
    const resizeTo = (value: number) => {
      this.plugin.settings.split = clamp(value, 15, 85);
      this.workspace.style.setProperty("--split", `${this.plugin.settings.split}%`);
      this.splitter.setAttribute("aria-valuenow", String(Math.round(this.plugin.settings.split)));
      this.refresh();
    };
    this.listen(this.splitter, "pointerdown", (event) => {
      if (!(event instanceof PointerEvent) || event.button !== 0) return;
      event.preventDefault();
      this.dragId = event.pointerId;
      this.splitter.setPointerCapture(event.pointerId);
      this.splitter.classList.add("is-dragging");
    });
    this.listen(this.splitter, "pointermove", (event) => {
      if (!(event instanceof PointerEvent) || this.dragId !== event.pointerId) return;
      const rect = this.workspace.getBoundingClientRect();
      const styles = getComputedStyle(this.workspace);
      const stacked = this.isStacked();
      const start = stacked ? rect.top + Number.parseFloat(styles.paddingTop) : rect.left + Number.parseFloat(styles.paddingLeft);
      const size = stacked
        ? rect.height - Number.parseFloat(styles.paddingTop) - Number.parseFloat(styles.paddingBottom)
        : rect.width - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight);
      if (size <= 0) return;
      resizeTo((((stacked ? event.clientY : event.clientX) - start) / size) * 100);
    });
    const endDrag = () => {
      if (this.dragId === null) return;
      this.dragId = null;
      this.splitter.classList.remove("is-dragging");
      this.persist(false);
      this.refresh();
    };
    this.listen(this.splitter, "pointerup", endDrag);
    this.listen(this.splitter, "pointercancel", endDrag);
    this.listen(this.splitter, "lostpointercapture", endDrag);
    this.listen(this.splitter, "dblclick", () => {
      resizeTo(50);
      this.persist(false);
    });
    this.listen(this.splitter, "keydown", (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      const stacked = this.isStacked();
      const minus = stacked ? "ArrowUp" : "ArrowLeft";
      const plus = stacked ? "ArrowDown" : "ArrowRight";
      if (![minus, plus, "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 15 : event.key === "End" ? 85 : this.plugin.settings.split + (event.key === minus ? -3 : 3);
      resizeTo(next);
      this.persist(false);
    });
  }

  private bindDrop(): void {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    this.listen(
      this.root,
      "dragenter",
      (event) => {
        if (!(event instanceof DragEvent) || !hasFiles(event)) return;
        event.preventDefault();
        this.dragDepth++;
        this.dropOverlay.classList.add("is-visible");
      },
      true,
    );
    this.listen(
      this.root,
      "dragover",
      (event) => {
        if (!(event instanceof DragEvent) || !hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      },
      true,
    );
    this.listen(
      this.root,
      "dragleave",
      (event) => {
        if (!(event instanceof DragEvent) || !hasFiles(event)) return;
        this.dragDepth = Math.max(0, this.dragDepth - 1);
        if (!this.dragDepth) this.dropOverlay.classList.remove("is-visible");
      },
      true,
    );
    this.listen(
      this.root,
      "drop",
      (event) => {
        if (!(event instanceof DragEvent) || !hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        this.dragDepth = 0;
        this.dropOverlay.classList.remove("is-visible");
        void this.upload(event.dataTransfer?.files[0]);
      },
      true,
    );
  }

  private onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest("button");
    if (!(control instanceof HTMLButtonElement) || !this.root.contains(control)) return;
    const closeName = control.dataset.close;
    if (closeName) {
      this.dialogs.get(closeName)?.close();
      return;
    }
    const action = control.dataset.action;
    if (!action || action === "noop") return;
    const editorName = control.dataset.editor;
    const side: EditorSide | undefined = editorName === "input" || editorName === "output" ? editorName : undefined;
    if (side) this.active(side);
    this.runAction(action, side);
  }

  private onKeyDown(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    const target = event.target;
    if (!(target instanceof Node) || !this.root.contains(target)) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const dialogOpen = [...this.dialogs.values()].some((dialog) => dialog.open);
    if (event.key === "Escape" && !dialogOpen && this.maxPanel && !this.root.querySelector(".CodeMirror-dialog")) {
      event.preventDefault();
      this.maximize(this.maxPanel);
      return;
    }
    if (dialogOpen) return;
    let action: string | null = null;
    if (event.key === "F11") action = "fullscreen";
    else if (mod && event.key === "Enter") action = "beautify";
    else if (mod && event.shiftKey && key === "m") action = "minify";
    else if (mod && event.shiftKey && key === "c") action = "copy";
    else if (mod && !event.shiftKey && key === "f" && !(target.instanceOf(Element) && target.closest(".CodeMirror-dialog"))) action = "search";
    else if (mod && (key === "+" || key === "=" || event.code === "NumpadAdd")) action = "zoom-in";
    else if (mod && (key === "-" || event.code === "NumpadSubtract")) action = "zoom-out";
    else if (mod && key === "0") action = "zoom-reset";
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === "search") this.search(this.activeSide);
    else this.runAction(action);
  }

  private runAction(action: string, side?: EditorSide): void {
    const actions: Record<string, () => void> = {
      beautify: () => this.runFormat("beautify"),
      minify: () => this.runFormat("minify"),
      validate: () => this.runFormat("validate"),
      copy: () => void this.copyOutput(),
      clear: () => this.clearAll(),
      upload: () => this.fileInput.click(),
      download: () => this.download(),
      insert: () => this.insertIntoActiveNote(),
      paste: () => void this.pasteInput(),
      swap: () => this.swap(),
      escape: () => this.transform("escape"),
      unescape: () => this.transform("unescape"),
      decode: () => this.transform("decode"),
      "xml-tools": () => this.openDialog("xml-tools"),
      "xml-beautify": () => this.xmlTransform("xml-beautify"),
      "xml-extract": () => this.xmlTransform("xml-extract"),
      "json-extract": () => this.xmlTransform("json-extract"),
      "xml-encode": () => this.xmlTransform("xml-encode"),
      "xml-decode": () => this.xmlTransform("xml-decode"),
      "xml-deep": () => this.xmlTransform("xml-deep"),
      "zoom-in": () => this.zoom(1),
      "zoom-out": () => this.zoom(-1),
      "zoom-reset": () => this.zoom(0),
      layout: () => this.switchLayout(),
      fullscreen: () => void this.fullscreen(),
      settings: () => this.openDialog("settings"),
      help: () => this.openDialog("help"),
      dismiss: () => {
        this.messageBar.hidden = true;
        this.refresh();
      },
      search: () => this.search(side ?? this.activeSide),
      "panel-full": () => this.maximize(side ?? this.activeSide),
      wrap: () => this.toggleWrap(side ?? this.activeSide),
      fold: () => this.folding(side ?? this.activeSide, true),
      unfold: () => this.folding(side ?? this.activeSide, false),
      "reset-preferences": () => this.resetPreferences(),
    };
    actions[action]?.();
  }

  private runFormat(action: FormatAction, quiet = false): void {
    window.clearTimeout(this.autoTimer);
    const started = performance.now();
    const text = this.value("input");
    this.measure("input");
    if (!text.trim()) {
      this.message("Input is empty. Paste code or load a sample to begin.");
      if (!quiet) new Notice("Nothing to format or validate.");
      return;
    }
    try {
      const settings = this.plugin.settings;
      const chosen = selectedFormat(settings);
      const decodeFirst = action !== "validate" && settings.autoDecodeXml && chosen !== "json" && looksEncodedXml(text);
      const result = decodeFirst ? decodeXmlDocument(text, action, indentUnit(settings), chosen) : process(text, action, chosen, indentUnit(settings));
      if (decodeFirst) {
        this.clearError("input");
        this.side.input.validation = "transformed";
        this.updatePanelStatus("input");
      } else this.markValid("input", result.language);
      if (action !== "validate") {
        this.replace("output", result.text, this.asOutputKind(result.language));
        this.markValid("output", result.language);
      }
      this.lastTime = performance.now() - started;
      this.updateStatus();
      const language = result.soapVersion || labelLanguage(result.language);
      const notice = action === "validate" ? `${language} is valid.` : `${decodeFirst ? `Decoded ${result.layers ?? 0} layer(s). ` : ""}${language} ${action === "minify" ? "compacted" : "formatted"} successfully.`;
      this.message(notice, "success");
      if (!quiet) new Notice(notice);
      if (action !== "validate" && settings.outputPreference === "panel-and-clipboard") void this.copyOutput(true);
    } catch (error) {
      this.lastTime = performance.now() - started;
      this.showError("input", error, quiet);
    }
  }

  private transform(action: "escape" | "unescape" | "decode"): void {
    window.clearTimeout(this.autoTimer);
    const started = performance.now();
    const text = this.value("input");
    this.measure("input");
    if (!text.trim()) {
      this.message("Input is empty. Paste a JSON string or load a sample.");
      new Notice("Nothing to transform.");
      return;
    }
    try {
      const unit = indentUnit(this.plugin.settings);
      let result: string;
      let language = "text";
      let valid = false;
      if (action === "escape") {
        result = escapeString(text);
        language = "json";
        valid = true;
      } else if (action === "decode") {
        result = decode(text, unit).text;
        language = "json";
        valid = true;
      } else {
        result = unescapeString(text);
        if (result.trim()) {
          try {
            language = process(result, "validate", "auto", unit).language;
            valid = true;
          } catch {
            /* Plain text is a legitimate unescape result. */
          }
        }
      }
      this.clearError("input");
      this.invalidate("input", text);
      this.replace("output", result, this.asOutputKind(language));
      if (valid) this.markValid("output", language);
      else {
        this.side.output.validation = "transformed";
        this.updatePanelStatus("output");
      }
      this.lastTime = performance.now() - started;
      this.updateStatus();
      const notice = { escape: "Escaped input into a JSON string literal.", unescape: "JSON string unescaped.", decode: "Decoded and formatted JSON object or array." }[action];
      this.message(notice, "success");
      new Notice(notice);
    } catch (error) {
      this.lastTime = performance.now() - started;
      this.showError("input", error);
    }
  }

  private xmlTransform(action: string): void {
    window.clearTimeout(this.autoTimer);
    this.dialogs.get("xml-tools")?.close();
    const started = performance.now();
    const text = this.value("input");
    this.measure("input");
    if (!text.trim()) {
      this.message("Input is empty. Paste XML, SOAP or escaped text first.");
      new Notice("Nothing to transform.");
      return;
    }
    try {
      const unit = indentUnit(this.plugin.settings);
      let result = "";
      let language = "text";
      let valid = false;
      let notice = "";
      if (action === "xml-beautify") {
        const doc = decodeXmlDocument(text, "beautify", unit);
        result = doc.text;
        language = doc.language;
        valid = true;
        notice = `Decoded ${doc.layers ?? 0} layer(s) and formatted ${doc.soapVersion || labelLanguage(language)}. Input unchanged.`;
      } else if (action === "xml-extract" || action === "json-extract") {
        const kind = action === "xml-extract" ? "xml" : "json";
        const doc = extractEmbedded(text, kind, unit);
        result = doc.text;
        language = doc.language;
        valid = language !== "text";
        notice = `Extracted ${doc.count ?? 0} embedded ${kind.toUpperCase()} document(s) as a separate ${(doc.count ?? 0) > 1 ? "text report" : "preview"}. SOAP input unchanged.${doc.skipped ? ` ${doc.skipped} invalid candidate(s) skipped.` : ""}`;
      } else if (action === "xml-encode") {
        result = encodeXmlEntities(text);
        language = "encoded-xml";
        notice = "XML entities encoded. Output is escaped text, not a standalone XML document.";
      } else {
        const decoded = action === "xml-deep" ? deepDecodeXml(text) : { text: decodeXmlEntities(text), layers: 0 };
        result = decoded.text;
        if (action === "xml-decode") decoded.layers = result === text ? 0 : 1;
        if (result.trimStart().startsWith("<")) {
          try {
            language = process(result, "validate", "auto", unit).language;
            valid = true;
          } catch {
            /* Raw text is allowed when the decode does not produce valid XML. */
          }
        } else if (looksEncodedXml(result)) language = "encoded-xml";
        notice = `Decoded ${decoded.layers} layer(s). ${valid ? "Output is valid XML." : "Output is text or incomplete/invalid XML; validate before using."}`;
      }
      this.invalidate("input", text);
      this.replace("output", result, this.asOutputKind(language));
      if (valid) this.markValid("output", language);
      else {
        this.side.output.validation = "transformed";
        this.updatePanelStatus("output");
      }
      this.lastTime = performance.now() - started;
      this.updateStatus();
      this.message(notice, valid ? "success" : "info");
      new Notice(notice);
    } catch (error) {
      this.lastTime = performance.now() - started;
      this.showError("input", error);
    }
  }

  private showError(side: EditorSide, error: unknown, quiet = false): void {
    this.clearError(side);
    const cm = this.editor(side);
    const state = this.side[side];
    state.validation = "invalid";
    const formatError = error instanceof FormatError ? error : null;
    const detail = errorMessage(error);
    if (formatError && Number.isFinite(formatError.line) && Number.isFinite(formatError.column)) {
      const line = clamp((formatError.line ?? 1) - 1, 0, cm.lastLine());
      const ch = clamp((formatError.column ?? 1) - 1, 0, cm.getLine(line).length);
      state.errorLine = line;
      cm.addLineClass(line, "background", "error-line");
      const marker = createDiv();
      marker.className = "ff-error-gutter";
      marker.textContent = "!";
      marker.title = formatError.message;
      cm.setGutterMarker(line, "error-gutter", marker);
      if (cm.getLine(line).length) {
        const start = Math.min(ch, cm.getLine(line).length - 1);
        state.mark = cm.markText(CodeMirror.Pos(line, start), CodeMirror.Pos(line, start + 1), { className: "cm-error-mark", title: formatError.message });
      }
      this.lastError = { side, line, ch };
    }
    this.message(detail, "error", Boolean(this.lastError && this.lastError.side === side));
    this.updatePanelStatus(side);
    this.updateStatus();
    if (!quiet) new Notice(detail);
  }

  private clearError(side: EditorSide): void {
    const state = this.side[side];
    const cm = this.editors[side];
    state.mark?.clear();
    state.mark = null;
    if (cm && state.errorLine !== null) {
      cm.removeLineClass(state.errorLine, "background", "error-line");
      cm.clearGutter("error-gutter");
    }
    state.errorLine = null;
    if (this.lastError?.side === side) {
      this.lastError = null;
      this.jumpError.hidden = true;
    }
  }

  private jumpToError(): void {
    if (!this.lastError) return;
    const { side, line, ch } = this.lastError;
    if (this.maxPanel && this.maxPanel !== side) this.maximize(side);
    this.active(side);
    const cm = this.editor(side);
    cm.setCursor(line, ch);
    cm.scrollIntoView(CodeMirror.Pos(line, ch), 90);
    cm.focus();
  }

  private markValid(side: EditorSide, language: string): void {
    this.clearError(side);
    this.side[side].validation = "valid";
    this.setLanguage(side, language);
    this.updatePanelStatus(side);
  }

  private invalidate(side: EditorSide, text: string): void {
    this.clearError(side);
    this.side[side].validation = text.length ? "pending" : "ready";
    this.updatePanelStatus(side);
  }

  private replace(side: EditorSide, text: string, kind: OutputKind | null = null): void {
    const cm = this.editor(side);
    if (side === "output") this.outputKind = kind;
    this.withSilent(() => {
      this.clearError(side);
      if (cm.getValue() !== text) cm.setValue(text);
      cm.setCursor(0, 0);
      cm.scrollTo(0, 0);
    });
    this.invalidate(side, text);
    this.measure(side);
    this.scheduleSave();
  }

  private onChange(side: EditorSide, change: EditorChange): void {
    if (this.suppress) return;
    if (side === "output") this.outputKind = null;
    const cm = this.editor(side);
    this.invalidate(side, cm.lineCount() > 1 || cm.getLine(0).length ? "x" : "");
    if (side === "input" && (this.plugin.settings.autoFormat || (this.plugin.settings.formatOnPaste && change.origin === "paste"))) this.scheduleFormat();
    if (this.messageBar.classList.contains("is-error") || this.messageBar.classList.contains("is-success")) {
      this.message("Code changed. Validate or format to update the result.");
    }
    this.measureLater(side);
    this.scheduleSave();
    this.updateStatus();
  }

  private onBeforeChange(side: EditorSide, editor: Editor, change: EditorChange & { cancel(): void }): void {
    if (this.suppress) return;
    const inserted = change.text.reduce((sum, line) => sum + line.length, Math.max(0, change.text.length - 1));
    const end = editor.lastLine();
    const current = editor.indexFromPos(CodeMirror.Pos(end, editor.getLine(end).length));
    const removed = editor.indexFromPos(change.to) - editor.indexFromPos(change.from);
    const next = current - removed + inserted;
    if (next > MAX_OUTPUT || (next > MAX_INPUT && next > current && side === "input")) {
      change.cancel();
      new Notice("Editor size limit reached. Use a smaller payload.");
    }
  }

  private scheduleFormat(): void {
    window.clearTimeout(this.autoTimer);
    this.autoTimer = window.setTimeout(() => {
      if (this.value("input").trim()) this.runFormat("beautify", true);
    }, 380);
  }

  private async copyOutput(silent = false): Promise<void> {
    const text = this.value("output");
    if (!text) {
      if (!silent) new Notice("Output is empty.");
      return;
    }
    const copied = await copyText(text);
    if (copied === "clipboard") {
      if (!silent) new Notice("Output copied to clipboard.");
      return;
    }
    this.editors.output?.focus();
    this.editors.output?.execCommand("selectAll");
    new Notice("Clipboard access denied. Output selected; press Ctrl+C to copy.");
  }

  private async pasteInput(): Promise<void> {
    try {
      const text = await readClipboard();
      if (text === null) throw new Error("Clipboard unavailable");
      if (!text) {
        new Notice("Clipboard is empty.");
        return;
      }
      if (this.loadInput(text, "", this.plugin.settings.formatOnPaste)) new Notice("Clipboard pasted into input.");
    } catch {
      this.editors.input?.focus();
      new Notice("Clipboard read permission is unavailable. Press Ctrl+V in the input editor.");
    }
  }

  private async upload(file: File | undefined): Promise<void> {
    if (!file) return;
    if (file.size > MAX_INPUT) {
      new Notice("File exceeds the 20 MiB upload limit.");
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let encoding = "utf-8";
      if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
      const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      if (this.loadInput(text, file.name)) new Notice(`Loaded ${file.name}.`);
    } catch {
      new Notice("Unable to read the file. Use a UTF-8 or BOM-marked UTF-16 text file.");
    }
  }

  private download(): void {
    const text = this.value("output");
    if (!text) {
      new Notice("Output is empty. Format or transform code first.");
      return;
    }
    const kind = this.outputKind || detect(text);
    const ext = kind === "json" ? "json" : kind === "soap" || kind === "xml" ? "xml" : "txt";
    const type = ext === "json" ? "application/json" : ext === "xml" ? "application/xml" : "text/plain";
    const base = (this.sourceName.replace(/\.[^.]+$/, "") || "payload").replace(/[^\w.-]+/g, "_").slice(0, 100);
    let exportText = text;
    if (ext === "xml") exportText = text.replace(/^(\uFEFF?<\?xml\b[^?]*?\bencoding\s*=\s*)(['"])[^'"]+\2/i, "$1$2UTF-8$2");
    const url = URL.createObjectURL(new Blob([exportText], { type: `${type};charset=utf-8` }));
    const link = createEl("a");
    link.href = url;
    link.download = `${base}-formatted.${ext}`;
    this.root.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    new Notice("Output downloaded.");
  }

  private clearAll(): void {
    window.clearTimeout(this.autoTimer);
    this.lastTime = null;
    this.sourceName = "";
    this.replace("input", "");
    this.replace("output", "", null);
    this.plugin.settings.savedInput = "";
    this.plugin.settings.savedOutput = "";
    this.plugin.settings.sourceName = "";
    this.plugin.settings.outputKind = null;
    if (this.maxPanel === "output") this.maximize("output");
    this.active("input");
    this.editors.input?.focus();
    this.message("Both editors cleared.");
    new Notice("Workspace cleared.");
    this.persist(false);
  }

  private swap(): void {
    window.clearTimeout(this.autoTimer);
    const input = this.value("input");
    const output = this.value("output");
    if (!input && !output) {
      new Notice("Both editors are empty.");
      return;
    }
    const oldLanguage = this.side.input.language;
    this.replace("input", output);
    this.replace("output", input, oldLanguage === "empty" ? null : this.asOutputKind(oldLanguage));
    this.lastTime = null;
    this.sourceName = "";
    if (this.maxPanel === "output") this.maximize("output");
    this.active("input");
    this.message("Input and output swapped. Validate or format the new input.");
    new Notice("Editors swapped.");
    if (this.plugin.settings.autoFormat && output.trim()) this.scheduleFormat();
  }

  private active(side: EditorSide): void {
    if (!this.editors[side]) return;
    this.activeSide = side;
    for (const name of ["input", "output"] as const) {
      this.root.querySelector(`.ff-panel-${name}`)?.classList.toggle("is-active", name === side);
    }
    this.updateStatus();
  }

  private setLanguage(side: EditorSide, language: string): void {
    const state = this.side[side];
    const cm = this.editor(side);
    if (state.language !== language || !state.modeSet) {
      state.language = language;
      state.modeSet = true;
      const mode = this.modeFor(side, language);
      if (cm.getOption("mode") !== mode) cm.setOption("mode", mode);
      const matchTags = this.plugin.settings.syntaxHighlighting && (language === "xml" || language === "soap") ? { bothTags: true } : false;
      cm.setOption("matchTags", matchTags);
    }
    const pill = this.pills[side];
    if (pill) {
      pill.textContent = labelLanguage(language).toUpperCase();
      pill.dataset.language = language;
    }
    if (side === "input") {
      const chosen = selectedFormat(this.plugin.settings);
      this.workspaceMode.textContent = language === "empty" ? (chosen === "auto" ? "Auto detect" : labelLanguage(chosen)) : `${labelLanguage(language)}${chosen === "auto" ? " detected" : " selected"}`;
    }
  }

  private modeFor(side: EditorSide, language: string): string | null {
    if (!this.plugin.settings.syntaxHighlighting) return null;
    if (language === "json" || language === "xml" || language === "soap") return `beautifier-${language}`;
    if (language === "empty" && side === "input") {
      const chosen = selectedFormat(this.plugin.settings);
      if (chosen !== "auto") return `beautifier-${chosen}`;
    }
    return language === "empty" ? "beautifier-json" : null;
  }

  private measure(side: EditorSide): void {
    const cm = this.editors[side];
    if (!cm) return;
    const text = cm.getValue();
    const language = this.currentLanguage(side, text);
    const hint = this.hints[side];
    if (hint) hint.hidden = text.length > 0;
    const size = this.sizes[side];
    const count = this.counts[side];
    const bytes = text.length > 2_000_000 ? text.length : this.encoder.encode(text).length;
    if (size) size.textContent = bytesLabel(bytes);
    if (count) count.textContent = `${cm.lineCount().toLocaleString()} ${cm.lineCount() === 1 ? "line" : "lines"} · ${text.length.toLocaleString()} chars`;
    this.setLanguage(side, language);
    this.updatePanelStatus(side);
    if (this.activeSide === side) {
      this.statusLines.textContent = `${cm.lineCount().toLocaleString()} Ln`;
      this.statusChars.textContent = `${text.length.toLocaleString()} Ch`;
      this.statusBytes.textContent = bytesLabel(bytes);
      this.updateStatus();
    }
  }

  private measureLater(side: EditorSide): void {
    const pending = this.measureTimers[side];
    if (pending) window.clearTimeout(pending);
    this.measureTimers[side] = window.setTimeout(() => this.measure(side), 90);
  }

  private currentLanguage(side: EditorSide, text: string): string {
    if (!text.trim()) return "empty";
    if (side === "input" && !this.plugin.settings.autoDetect) return this.plugin.settings.defaultFormatter;
    if (side === "output" && this.outputKind) return this.outputKind;
    return detect(text);
  }

  private updatePanelStatus(side: EditorSide): void {
    const state = this.side[side];
    const dot = this.dots[side];
    const note = this.notes[side];
    if (dot) dot.className = `ff-dot is-${state.validation}`;
    if (!note) return;
    const language = labelLanguage(state.language);
    if (state.validation === "valid") note.textContent = `Valid ${language}`;
    else if (state.validation === "invalid") note.textContent = `Invalid ${language}`;
    else if (state.validation === "pending") note.textContent = "Not validated";
    else if (state.validation === "transformed") note.textContent = "Transformed text";
    else note.textContent = side === "input" ? "Ready for input" : "Awaiting formatting";
  }

  private updateStatus(): void {
    const side = this.activeSide;
    const cm = this.editors[side];
    if (!cm) return;
    const state = this.side[side];
    const cursor = cm.getCursor();
    this.statusScope.textContent = side.toUpperCase();
    this.statusValidation.textContent = { valid: "Valid", invalid: "Invalid", pending: "Unvalidated", transformed: "Transformed", ready: "Ready" }[state.validation];
    this.statusValidation.className = `is-${state.validation}`;
    this.statusLanguage.textContent = labelLanguage(state.language);
    this.statusCursor.textContent = `Ln ${cursor.line + 1}, Col ${cursor.ch + 1}`;
    const settings = this.plugin.settings;
    this.statusIndent.textContent = settings.indentType === "tabs" ? "Tab: 4" : `Spaces: ${settings.indentSize}`;
    const zoom = `${Math.round((this.fontOf(side) / BASE_FONT) * 100)}%`;
    this.statusZoom.textContent = zoom;
    this.zoomDisplay.textContent = zoom;
    this.statusTime.textContent = this.lastTime === null ? "— ms" : `${this.lastTime < 10 ? this.lastTime.toFixed(2) : this.lastTime.toFixed(1)} ms`;
  }

  private message(text: string, type: "info" | "success" | "error" = "info", canJump = false): void {
    this.messageBar.hidden = false;
    this.messageBar.className = `ff-message is-${type}`;
    this.messageText.textContent = text;
    setIcon(this.messageIcon, type === "success" ? "check" : "alert");
    this.jumpError.hidden = !canJump;
  }

  private applyExternalSettings(): void {
    if (this.writing) return;
    this.applyPrefs();
  }

  private applyPrefs(): void {
    const settings = this.plugin.settings;
    this.formatSelect.value = selectedFormat(settings);
    this.indentSelect.value = settings.indentType === "tabs" ? "tab" : String(settings.indentSize);
    this.autoFormatInput.checked = settings.autoFormat;
    this.autoDecodeInput.checked = settings.autoDecodeXml;
    this.syncZoomInput.checked = settings.syncZoom;
    this.formatOnPasteInput.checked = settings.formatOnPaste;
    this.saveContentInput.checked = settings.saveContent;
    this.inputFontInput.value = String(settings.inputFont);
    this.outputFontInput.value = String(settings.outputFont);
    for (const side of ["input", "output"] as const) {
      const cm = this.editors[side];
      if (!cm) continue;
      cm.getWrapperElement().style.fontSize = `${this.fontOf(side)}px`;
      cm.setOption("lineWrapping", side === "input" ? settings.inputWrap : settings.outputWrap);
      cm.setOption("indentUnit", indentWidth(settings));
      cm.setOption("tabSize", indentWidth(settings));
      cm.setOption("indentWithTabs", settings.indentType === "tabs");
      this.root.querySelector(`[data-action="wrap"][data-editor="${side}"]`)?.setAttribute("aria-pressed", side === "input" ? String(settings.inputWrap) : String(settings.outputWrap));
      this.side[side].modeSet = false;
      this.measure(side);
    }
    this.applyLayout();
    this.updateStatus();
  }

  private onFormatChange(): void {
    const value = this.formatSelect.value;
    if (value === "auto") this.plugin.settings.autoDetect = true;
    else if (value === "json" || value === "xml" || value === "soap") {
      this.plugin.settings.autoDetect = false;
      this.plugin.settings.defaultFormatter = value;
    }
    this.invalidate("input", this.value("input"));
    this.side.input.modeSet = false;
    this.measure("input");
    this.persist(false);
    this.message("Input format changed.");
    if (this.plugin.settings.autoFormat) this.scheduleFormat();
  }

  private onIndentChange(): void {
    const value = this.indentSelect.value;
    if (value === "tab") this.plugin.settings.indentType = "tabs";
    else if (value === "2" || value === "4" || value === "8") {
      this.plugin.settings.indentType = "spaces";
      this.plugin.settings.indentSize = Number(value) as 2 | 4 | 8;
    }
    for (const cm of Object.values(this.editors)) {
      cm.setOption("indentUnit", indentWidth(this.plugin.settings));
      cm.setOption("tabSize", indentWidth(this.plugin.settings));
      cm.setOption("indentWithTabs", this.plugin.settings.indentType === "tabs");
    }
    this.persist(false);
    this.updateStatus();
    if (this.plugin.settings.autoFormat) this.scheduleFormat();
  }

  private onSample(): void {
    const value = this.sampleSelect.value;
    if (!value) return;
    const sample = SAMPLES[value];
    this.sampleSelect.value = "";
    if (!sample) return;
    this.plugin.settings.autoDetect = true;
    this.formatSelect.value = "auto";
    this.persist(false);
    this.replace("output", "", null);
    this.loadInput(sample, `sample-${value}`);
    new Notice("Sample loaded.");
  }

  private fontOf(side: EditorSide): number {
    return side === "input" ? this.plugin.settings.inputFont : this.plugin.settings.outputFont;
  }

  private setZoom(side: EditorSide, size: number): void {
    const next = fontSize(size);
    if (this.plugin.settings.syncZoom) {
      this.plugin.settings.inputFont = next;
      this.plugin.settings.outputFont = next;
    } else if (side === "input") this.plugin.settings.inputFont = next;
    else this.plugin.settings.outputFont = next;
    this.inputFontInput.value = String(this.plugin.settings.inputFont);
    this.outputFontInput.value = String(this.plugin.settings.outputFont);
    for (const name of ["input", "output"] as const) {
      this.editors[name]?.getWrapperElement().style.setProperty("font-size", `${this.fontOf(name)}px`);
    }
    this.persist(false);
    this.updateStatus();
    this.refresh();
  }

  private zoom(delta: number, side: EditorSide = this.activeSide): void {
    this.setZoom(side, delta === 0 ? BASE_FONT : this.fontOf(side) + delta);
  }

  private isStacked(): boolean {
    const layout = this.plugin.settings.layout;
    return layout === "stacked" || (layout === "auto" && this.root.clientWidth > 0 && this.root.clientWidth <= 760);
  }

  private applyLayout(): void {
    const stacked = this.isStacked();
    this.workspace.classList.toggle("is-stacked", stacked);
    this.workspace.style.setProperty("--split", `${this.plugin.settings.split}%`);
    this.splitter.setAttribute("aria-orientation", stacked ? "horizontal" : "vertical");
    this.splitter.setAttribute("aria-valuenow", String(Math.round(this.plugin.settings.split)));
    setIcon(iconOf(this.layoutButton), stacked ? "stack" : "layout");
    const title = stacked ? "Switch to side-by-side editors" : "Switch to stacked editors";
    this.layoutButton.title = title;
    this.layoutButton.setAttribute("aria-label", title);
    this.refresh();
  }

  private switchLayout(): void {
    this.plugin.settings.layout = this.isStacked() ? "side" : "stacked";
    this.persist(false);
    this.applyLayout();
  }

  private maximize(side: EditorSide): void {
    this.maxPanel = this.maxPanel === side ? null : side;
    this.workspace.classList.toggle("is-max-input", this.maxPanel === "input");
    this.workspace.classList.toggle("is-max-output", this.maxPanel === "output");
    for (const el of this.root.querySelectorAll('[data-action="panel-full"]')) {
      if (!el.instanceOf(HTMLButtonElement)) continue;
      const on = this.maxPanel === el.dataset.editor;
      const svg = el.querySelector("svg");
      if (svg instanceof SVGSVGElement) setIcon(svg, on ? "collapse" : "expand");
      const label = on ? "Restore split editors (Esc)" : `Maximize ${el.dataset.editor ?? "editor"} editor`;
      el.title = label;
      el.setAttribute("aria-label", label);
      el.setAttribute("aria-pressed", String(on));
    }
    if (this.maxPanel) this.active(side);
    this.refresh();
  }

  private async fullscreen(): Promise<void> {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        new Notice("Use the workspace control to exit full screen.");
      }
      return;
    }
    try {
      await this.root.requestFullscreen();
    } catch {
      new Notice("Full screen is unavailable. Maximize an editor instead.");
    }
  }

  private syncFullscreenButton(): void {
    const on = document.fullscreenElement === this.root;
    setIcon(iconOf(this.fullscreenButton), on ? "collapse" : "expand");
    this.fullscreenButton.setAttribute("aria-pressed", String(on));
    this.fullscreenButton.title = on ? "Exit full screen" : "Full screen (F11)";
    this.refresh();
  }

  private toggleWrap(side: EditorSide): void {
    const next = side === "input" ? !this.plugin.settings.inputWrap : !this.plugin.settings.outputWrap;
    if (side === "input") this.plugin.settings.inputWrap = next;
    else this.plugin.settings.outputWrap = next;
    this.editors[side]?.setOption("lineWrapping", next);
    this.root.querySelector(`[data-action="wrap"][data-editor="${side}"]`)?.setAttribute("aria-pressed", String(next));
    this.persist(false);
    this.refresh();
  }

  private search(side: EditorSide): void {
    this.active(side);
    const cm = this.editors[side];
    cm?.focus();
    cm?.execCommand("findPersistent");
  }

  private folding(side: EditorSide, fold: boolean): void {
    this.active(side);
    this.editors[side]?.execCommand(fold ? "foldAll" : "unfoldAll");
  }

  private openDialog(name: string): void {
    const dialog = this.dialogs.get(name);
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  private resetPreferences(): void {
    window.clearTimeout(this.autoTimer);
    window.clearTimeout(this.saveTimer);
    const settings = this.plugin.settings;
    settings.indentSize = 2;
    settings.indentType = "spaces";
    settings.autoDetect = true;
    settings.defaultFormatter = "json";
    settings.outputPreference = "panel";
    settings.syntaxHighlighting = true;
    settings.layout = "auto";
    settings.split = 50;
    settings.inputFont = 14;
    settings.outputFont = 14;
    settings.syncZoom = true;
    settings.autoFormat = false;
    settings.autoDecodeXml = false;
    settings.formatOnPaste = false;
    settings.saveContent = false;
    settings.inputWrap = false;
    settings.outputWrap = false;
    settings.savedInput = "";
    settings.savedOutput = "";
    settings.sourceName = "";
    settings.outputKind = null;
    this.persist(false);
    for (const side of ["input", "output"] as const) this.invalidate(side, this.value(side));
    this.applyPrefs();
    new Notice("Preferences reset. Saved payloads removed.");
  }

  private restoreContent(): void {
    const settings = this.plugin.settings;
    if (!settings.saveContent) return;
    if (!settings.savedInput && !settings.savedOutput) return;
    this.replace("input", settings.savedInput);
    this.replace("output", settings.savedOutput, settings.outputKind);
    this.sourceName = settings.sourceName;
    this.message("Locally saved workspace restored.");
  }

  private scheduleSave(): void {
    if (!this.plugin.settings.saveContent) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.writeContent(), 400);
  }

  private writeContent(): void {
    const settings = this.plugin.settings;
    if (!settings.saveContent) return;
    const input = this.value("input");
    const output = this.value("output");
    if (input.length > MAX_SAVED_CHARS || output.length > MAX_SAVED_CHARS) {
      if (!this.saveLimitNotified) {
        this.saveLimitNotified = true;
        new Notice("Editor contents are too large to store in plugin data. Preferences are still saved.");
      }
      return;
    }
    settings.savedInput = input;
    settings.savedOutput = output;
    settings.sourceName = this.sourceName;
    settings.outputKind = this.outputKind;
    this.persist(false);
  }

  private persist(writingAlreadySet: boolean): void {
    if (!writingAlreadySet) this.writing = true;
    void this.plugin.saveSettings().finally(() => {
      this.writing = false;
    });
  }

  private refresh(): void {
    window.cancelAnimationFrame(this.pendingFrame);
    this.pendingFrame = window.requestAnimationFrame(() => {
      for (const cm of Object.values(this.editors)) {
        cm.refresh();
        cm.setSize("100%", "100%");
      }
    });
  }

  private value(side: EditorSide): string {
    return this.editors[side]?.getValue() ?? "";
  }

  private editor(side: EditorSide): Editor {
    const cm = this.editors[side];
    if (!cm) throw new Error("Payload Formatter editor is not ready.");
    return cm;
  }

  private withSilent<T>(fn: () => T): T {
    this.suppress++;
    try {
      return fn();
    } finally {
      this.suppress--;
    }
  }

  private asOutputKind(language: string): OutputKind | null {
    if (language === "json" || language === "xml" || language === "soap" || language === "text" || language === "encoded-xml") return language;
    return null;
  }

  private listen(target: EventTarget, type: string, handler: EventListener, options?: boolean | AddEventListenerOptions): void {
    target.addEventListener(type, handler, options);
    this.disposers.push(() => target.removeEventListener(type, handler, options));
  }

  private dispose(): void {
    cancelAnimationFrame(this.pendingFrame);
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* Listeners may already be gone with the leaf. */
      }
    }
  }
}

function iconOf(buttonNode: HTMLButtonElement): SVGSVGElement {
  const svg = buttonNode.querySelector("svg");
  if (!(svg instanceof SVGSVGElement)) throw new Error("Missing icon.");
  return svg;
}
