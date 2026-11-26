/** Copy text on-device. Returns how the copy was completed so the caller can fall back. */
export async function copyText(text: string): Promise<"clipboard" | "fallback"> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return "clipboard";
    }
  } catch {
    /* Permission can fail inside the desktop shell; try the legacy path. */
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.className = "payload-formatter-clipboard";
  document.body.append(field);
  field.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    field.remove();
  }
  if (!ok) return "fallback";
  return "clipboard";
}

export async function readClipboard(): Promise<string | null> {
  if (!navigator.clipboard?.readText) return null;
  return navigator.clipboard.readText();
}
