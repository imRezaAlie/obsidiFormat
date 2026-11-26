import { FormatError, MAX_INPUT, MAX_OUTPUT } from "../types";

export interface TextBuilder {
  add(value: string): void;
  text(): string;
}

export function guard(text: string): void {
  if (typeof text !== "string") throw new TypeError("Expected text.");
  if (text.length > MAX_INPUT) throw new FormatError("Input exceeds the 20 Mi-character processing limit.", text);
  if (!text.trim()) throw new FormatError("Input is empty. Paste code or load a sample to begin.", text);
}

export function builder(): TextBuilder {
  const pieces: string[] = [];
  let length = 0;
  return {
    add(value: string) {
      length += value.length;
      if (length > MAX_OUTPUT) {
        throw new FormatError("Formatted output exceeds the 64 Mi-character safety limit. Try compact mode or a smaller payload.", "");
      }
      pieces.push(value);
    },
    text() {
      return pieces.join("");
    },
  };
}

export function indentString(unit: string, depth: number): string {
  if (unit.length * depth > MAX_OUTPUT) throw new FormatError("Indentation would exceed the output safety limit.", "");
  return unit.repeat(depth);
}
