/**
 * Iterative strict JSON grammar. Original tokens are kept verbatim, including
 * duplicate keys, escapes, key order, and numbers outside IEEE-754 precision.
 * JSON.parse is used only by the explicit unescape/decode tools.
 */
import { FormatError, MAX_OUTPUT, type FormatAction, type FormatResult, type IndentUnit } from "../types";
import { builder, guard, indentString } from "./limits";

type JsonState = "first" | "next" | "colon" | "value" | "after";
interface JsonFrame {
  type: "{" | "[";
  state: JsonState;
}

export function formatJson(text: string, action: FormatAction, unit: IndentUnit): FormatResult {
  const out = action === "validate" ? null : builder();
  const pretty = action === "beautify";
  const stack: JsonFrame[] = [];
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let rootDone = false;
  function fail(message: string, offset = i): never {
    throw new FormatError(message, text, offset);
  }
  const append = (value: string) => {
    if (out) out.add(value);
  };
  const line = (depth: number) => {
    if (out && pretty) {
      out.add("\n");
      out.add(indentString(unit, depth));
    }
  };
  const skip = () => {
    while (i < text.length && /[\x20\t\r\n]/.test(text[i] ?? "")) i++;
  };
  function stringToken(): string {
    const start = i++;
    while (i < text.length) {
      const ch = text[i++] ?? "";
      if (ch === '"') return text.slice(start, i);
      if (ch.charCodeAt(0) < 32) fail("Unescaped control character in JSON string.", i - 1);
      if (ch === "\\") {
        if (i >= text.length) fail("Unterminated escape sequence.");
        const esc = text[i++] ?? "";
        if (esc === "u") {
          for (let n = 0; n < 4; n++, i++) {
            if (i >= text.length || !/[0-9a-fA-F]/.test(text[i] ?? "")) fail("Expected four hexadecimal digits in Unicode escape.");
          }
        } else if (!"\"\\/bfnrt".includes(esc)) fail("Invalid JSON escape sequence.", i - 1);
      }
    }
    fail("Unterminated JSON string.");
  }
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  function value(): void {
    const ch = text[i];
    if (ch === "{" || ch === "[") {
      append(ch);
      i++;
      stack.push({ type: ch, state: "first" });
      return;
    }
    if (ch === '"') {
      append(stringToken());
      return;
    }
    if (ch === "-" || (ch !== undefined && ch >= "0" && ch <= "9")) {
      number.lastIndex = i;
      const matched = number.exec(text);
      if (!matched) fail("Invalid JSON number.");
      append(matched[0]);
      i = number.lastIndex;
      if (/[\d.eE]/.test(text[i] ?? "")) fail("Invalid JSON number.");
      return;
    }
    for (const word of ["true", "false", "null"]) {
      if (text.startsWith(word, i)) {
        append(word);
        i += word.length;
        return;
      }
    }
    fail(i >= text.length ? "Unexpected end of input; expected a JSON value." : "Expected a JSON value (object, array, string, number, true, false or null).");
  }
  while (true) {
    skip();
    if (!stack.length) {
      if (rootDone) {
        if (i !== text.length) fail("Unexpected content after the JSON value.");
        break;
      }
      rootDone = true;
      value();
      continue;
    }
    const frame = stack[stack.length - 1];
    if (!frame) fail("Unexpected end of JSON container.");
    const ch = text[i];
    const close = frame.type === "{" ? "}" : "]";
    if (frame.state === "first" && ch === close) {
      append(ch);
      i++;
      stack.pop();
      continue;
    }
    if (frame.state === "first" || frame.state === "next") {
      if (ch === close) fail("Trailing commas are not allowed in JSON.");
      if (frame.type === "{") {
        if (ch !== '"') fail("Expected a double-quoted JSON property name.");
        line(stack.length);
        append(stringToken());
        frame.state = "colon";
      } else {
        line(stack.length);
        frame.state = "after";
        value();
      }
    } else if (frame.state === "colon") {
      if (ch !== ":") fail("Expected a colon after the property name.");
      append(pretty ? ": " : ":");
      i++;
      frame.state = "value";
    } else if (frame.state === "value") {
      frame.state = "after";
      value();
    } else if (ch === ",") {
      append(",");
      i++;
      frame.state = "next";
    } else if (ch === close) {
      line(stack.length - 1);
      append(ch);
      i++;
      stack.pop();
    } else fail(`Expected a comma or '${close}'.`);
  }
  return { text: out ? out.text() : text, language: "json" };
}

export function unescapeString(text: string): string {
  guard(text);
  const trimmed = text.trim();
  try {
    const value: unknown = JSON.parse(trimmed);
    if (typeof value === "string") return value;
  } catch {
    /* Try an unquoted escaped JSON string body below. */
  }
  try {
    if (!trimmed.startsWith('"')) return JSON.parse(`"${text}"`) as string;
  } catch {
    /* Report the original quoted form's error where possible. */
  }
  if (trimmed.startsWith('"')) formatJson(text, "validate", "  ");
  throw new FormatError("Expected a JSON string literal or a valid unquoted escaped string.", text);
}

export function escapeString(text: string): string {
  guard(text);
  const result = JSON.stringify(text);
  if (result.length > MAX_OUTPUT) throw new FormatError("Escaped output exceeds the safety limit.", text);
  return result;
}

export function decodeJson(text: string, unit: IndentUnit, formatObject: (value: string) => FormatResult): FormatResult {
  guard(text);
  let value = text;
  for (let depth = 0; depth <= 20; depth++) {
    const trimmed = value.trim();
    const start = trimmed[0];
    if (start === "{" || start === "[") {
      try {
        return formatObject(value);
      } catch (error) {
        if (depth !== 0) {
          const line = error instanceof FormatError ? error.line : undefined;
          const column = error instanceof FormatError ? error.column : undefined;
          const message = error instanceof Error ? error.message : "Invalid JSON.";
          throw new FormatError(`Decoded JSON is invalid: ${message}${line ? ` (decoded line ${line}, column ${column})` : ""}`, text);
        }
        if (!value.includes("\\")) throw error;
        try {
          const next = unescapeString(value);
          if (next === value) throw error;
          value = next;
          continue;
        } catch {
          throw error;
        }
      }
    }
    if (depth === 20 || (start !== '"' && depth > 0)) break;
    const next = unescapeString(value);
    if (next === value) break;
    value = next;
  }
  throw new FormatError("The string does not decode to a valid JSON object or array within 20 layers.", text);
}
