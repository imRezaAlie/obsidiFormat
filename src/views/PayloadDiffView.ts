import CodeMirror from "codemirror";
import type { Editor } from "codemirror";
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import "codemirror/mode/javascript/javascript";
import "codemirror/mode/xml/xml";
import { diffPayloads, type DiffResult } from "../diff";
import { DIFF_VIEW_TYPE, MAX_INPUT, type SelectedFormat } from "../types";
import { copyText, readClipboard } from "../utils/clipboard";
import { errorMessage } from "../utils/validation";
import { icon, mountIcons } from "./icons";

type Side = "left" | "right";
const SIDES: readonly Side[] = ["left", "right"];

function button(parent: HTMLElement, className: string, label: string, action: string, iconName?: string, editor?: Side): HTMLButtonElement {
  const node = createEl("button");
  node.type = "button";
  node.className = className;
  node.dataset.action = action;
  if (editor) node.dataset.editor = editor;
  if (iconName) icon(node, iconName);
  if (label) node.append(createSpan({ text: label }));
  parent.append(node);
  return node;
}

export class PayloadDiffView extends ItemView {
  private readonly editors: Partial<Record<Side, Editor>> = {};
  private readonly fileInputs: Partial<Record<Side, HTMLInputElement>> = {};
  private readonly disposers: Array<() => void> = [];
  private root!: HTMLElement;
  private format!: HTMLSelectElement;
  private summary!: HTMLElement;
  private report!: HTMLElement;
  private lastResult: DiffResult | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return DIFF_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Payload Diff";
  }

  getIcon(): string {
    return "git-compare";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("obsidi-format-view", "obsidi-format-diff-view");
    const sprite = createSvg("svg");
    mountIcons(sprite);
    this.contentEl.append(sprite);

    this.root = this.contentEl.createDiv({ cls: "obsidi-format ff-diff-view" });
    this.buildToolbar();
    this.buildEditors();
    this.buildResult();
    this.mountEditors();
    this.bindEvents();
    this.applyMode();
  }

  async onClose(): Promise<void> {
    for (const dispose of this.disposers.splice(0)) dispose();
    for (const editor of Object.values(this.editors)) editor?.getWrapperElement().remove();
    this.contentEl.empty();
    this.contentEl.removeClass("obsidi-format-view", "obsidi-format-diff-view");
  }

  /** Used by commands that want to seed one side of the comparison. */
  loadInput(text: string, side: Side = "left"): void {
    this.editor(side)?.setValue(text.slice(0, MAX_INPUT));
  }

  private buildToolbar(): void {
    const bar = this.root.createDiv({ cls: "ff-toolbar ff-diff-toolbar" });
    const formatGroup = bar.createDiv({ cls: "ff-group" });
    formatGroup.append(createSpan({ text: "Format" }));
    this.format = formatGroup.createEl("select", { cls: "ff-select" });
    for (const [value, label] of [
      ["auto", "Auto detect"],
      ["json", "JSON"],
      ["xml", "XML"],
      ["soap", "SOAP"],
    ] as const) {
      const option = createEl("option");
      option.value = value;
      option.textContent = label;
      this.format.append(option);
    }
    this.format.title = "Format used for both payloads";

    const actions = bar.createDiv({ cls: "ff-group" });
    const compare = button(actions, "ff-button mod-cta", "Compare", "compare", "diff");
    compare.append(createEl("kbd", { text: "Ctrl ↵" }));
    compare.title = "Compare structurally (Ctrl+Enter)";
    button(actions, "ff-button", "Swap", "swap", "swap").title = "Swap A and B";
    button(actions, "ff-button", "Copy report", "copy", "copy").title = "Copy the diff report";
    button(actions, "ff-button", "Clear", "clear", "trash").title = "Clear both editors and the report";

    const local = bar.createDiv({ cls: "ff-group ff-group-end ff-local" });
    icon(local, "shield");
    local.append("Offline");
  }

  private buildEditors(): void {
    const workspace = this.root.createDiv({ cls: "ff-diff-grid" });
    for (const side of SIDES) {
      const section = createEl("section", { cls: `ff-diff-panel ff-diff-panel-${side}` });
      const head = section.createDiv({ cls: "ff-panel-head" });
      const title = createDiv();
      title.className = "ff-panel-title";
      const index = createSpan({ cls: "ff-index", text: side === "left" ? "A" : "B" });
      const heading = createEl("h2", { text: side === "left" ? "First payload" : "Second payload" });
      title.append(index, heading);
      const actions = section.createDiv({ cls: "ff-panel-actions" });
      button(actions, "ff-icon-button", "", "paste", "paste", side).setAttribute("aria-label", `Paste into ${side === "left" ? "A" : "B"}`);
      button(actions, "ff-icon-button", "", "upload", "upload", side).setAttribute("aria-label", `Upload into ${side === "left" ? "A" : "B"}`);
      head.append(title, actions);

      const body = section.createDiv({ cls: "ff-editor-body ff-diff-editor" });
      body.dataset.editor = side;
      section.append(head, body);
      workspace.append(section);

      const input = createEl("input");
      input.type = "file";
      input.hidden = true;
      input.accept = ".json,.xml,.soap,.txt,application/json,application/xml,text/xml,text/plain";
      this.fileInputs[side] = input;
      this.root.append(input);
    }
  }

  private buildResult(): void {
    const panel = this.root.createDiv({ cls: "ff-diff-result" });
    const head = panel.createDiv({ cls: "ff-panel-head" });
    const title = createDiv();
    title.className = "ff-panel-title";
    title.append(createSpan({ cls: "ff-index", text: "Δ" }), createEl("h2", { text: "Structural diff" }));
    this.summary = createSpan({ cls: "ff-diff-summary", text: "Ready" });
    head.append(title, this.summary);
    this.report = panel.createEl("pre", { cls: "ff-diff-report" });
    this.report.textContent = "Paste two payloads, then choose Compare. Formatting, key order, and attribute order are ignored.";
    panel.append(this.report);
  }

  private mountEditors(): void {
    for (const side of SIDES) {
      const host = this.root.querySelector(`.ff-diff-panel-${side} .ff-editor-body`);
      if (!(host instanceof HTMLElement)) continue;
      const editor = CodeMirror(host, {
        value: "",
        theme: "devtool",
        lineNumbers: true,
        lineWrapping: true,
        indentUnit: 2,
        inputStyle: "textarea",
      });
      this.editors[side] = editor;
    }
  }

  private bindEvents(): void {
    this.listen(this.root, "click", (event) => this.onClick(event));
    this.listen(this.root, "keydown", (event) => this.onKeyDown(event), true);
    this.listen(this.format, "change", () => this.applyMode());
    for (const side of SIDES) {
      const input = this.fileInputs[side];
      if (!input) continue;
      this.listen(input, "change", () => {
        const file = input.files?.[0];
        input.value = "";
        if (file) void this.upload(file, side);
      });
    }
  }

  private listen(target: EventTarget, type: string, handler: EventListener, options?: boolean | AddEventListenerOptions): void {
    target.addEventListener(type, handler, options);
    this.disposers.push(() => target.removeEventListener(type, handler, options));
  }

  private onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest("button");
    if (!(control instanceof HTMLButtonElement) || !this.root.contains(control)) return;
    const action = control.dataset.action;
    if (!action) return;
    const name = control.dataset.editor;
    const side: Side | undefined = name === "left" || name === "right" ? name : undefined;
    if (action === "compare") this.compare();
    else if (action === "swap") this.swap();
    else if (action === "copy") void this.copyReport();
    else if (action === "clear") this.clear();
    else if (action === "paste" && side) void this.paste(side);
    else if (action === "upload") this.fileInputs[side ?? "left"]?.click();
  }

  private onKeyDown(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    const target = event.target;
    if (!(target instanceof Node) || !this.root.contains(target)) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    let handled = true;
    if (mod && event.key === "Enter") this.compare();
    else if (mod && event.shiftKey && key === "c") void this.copyReport();
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  private selectedFormat(): SelectedFormat {
    const value = this.format.value;
    return value === "json" || value === "xml" || value === "soap" ? value : "auto";
  }

  private applyMode(): void {
    const selected = this.selectedFormat();
    const mode = selected === "xml" || selected === "soap" ? { name: "xml", htmlMode: false } : { name: "javascript", json: true };
    for (const editor of Object.values(this.editors)) editor?.setOption("mode", mode);
  }

  private compare(): void {
    try {
      const result = diffPayloads(this.value("left"), this.value("right"), this.selectedFormat());
      this.lastResult = result;
      this.report.textContent = result.report;
      this.report.classList.toggle("is-equal", result.equal);
      this.summary.textContent = result.equal ? "No differences" : `${result.changes.length} difference${result.changes.length === 1 ? "" : "s"}`;
      new Notice(result.equal ? "Payloads are structurally identical." : `Found ${result.changes.length} structural difference${result.changes.length === 1 ? "" : "s"}.`);
    } catch (error) {
      this.lastResult = null;
      this.report.textContent = errorMessage(error);
      this.report.classList.remove("is-equal");
      this.summary.textContent = "Could not compare";
      new Notice(errorMessage(error));
    }
  }

  private swap(): void {
    const left = this.value("left");
    this.set("left", this.value("right"));
    this.set("right", left);
    this.invalidate();
  }

  private clear(): void {
    this.set("left", "");
    this.set("right", "");
    this.invalidate();
    this.report.textContent = "Paste two payloads, then choose Compare. Formatting, key order, and attribute order are ignored.";
  }

  private invalidate(): void {
    this.lastResult = null;
    this.report.classList.remove("is-equal");
    this.summary.textContent = "Ready";
  }

  private async copyReport(): Promise<void> {
    const text = this.report.textContent ?? "";
    if (!text.trim()) {
      new Notice("Nothing to copy yet.");
      return;
    }
    const outcome = await copyText(text);
    new Notice(outcome === "clipboard" ? "Diff report copied." : "Clipboard access denied; select the report to copy it manually.");
  }

  private async paste(side: Side): Promise<void> {
    const text = await readClipboard();
    if (text === null) {
      new Notice("Clipboard unavailable; paste directly into the editor.");
      return;
    }
    this.set(side, text.slice(0, MAX_INPUT));
    this.invalidate();
  }

  private async upload(file: File, side: Side): Promise<void> {
    if (file.size > MAX_INPUT) {
      new Notice("That file exceeds the 20 Mi-character input limit.");
      return;
    }
    const text = await file.text();
    this.set(side, text.slice(0, MAX_INPUT));
    this.invalidate();
  }

  private editor(side: Side): Editor | undefined {
    return this.editors[side];
  }

  private value(side: Side): string {
    return this.editor(side)?.getValue() ?? "";
  }

  private set(side: Side, value: string): void {
    this.editor(side)?.setValue(value);
  }
}
