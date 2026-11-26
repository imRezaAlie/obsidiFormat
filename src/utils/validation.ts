import { FormatError } from "../types";

/** User-facing message. Location is appended when the engine did not already include it. */
export function errorMessage(error: unknown): string {
  if (error instanceof FormatError) {
    const hasLocation = Number.isFinite(error.line) && Number.isFinite(error.column);
    const already = /line\s*(?:number\s*)?\d+/i.test(error.message) && /column\s*\d+/i.test(error.message);
    if (hasLocation && !already) return `${error.message} (line ${error.line}, column ${error.column})`;
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "The operation could not be completed.";
}
