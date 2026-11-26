/** Copy text on-device. The caller handles manual copy if access is unavailable. */
export async function copyText(text: string): Promise<"clipboard" | "fallback"> {
  try {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) return "fallback";

    await clipboard.writeText(text);
    return "clipboard";
  } catch {
    // Clipboard access may be unavailable or denied by the host.
    return "fallback";
  }
}

/** Read clipboard text only when the user requests a paste. */
export async function readClipboard(): Promise<string | null> {
  try {
    const clipboard = navigator.clipboard;
    if (!clipboard?.readText) return null;

    return await clipboard.readText();
  } catch {
    // Let the caller focus the input and offer manual paste.
    return null;
  }
}
