const SVG = "http://www.w3.org/2000/svg";

type IconNode = { tag: "path" | "rect" | "circle" } & Record<string, string>;

const ICONS: Record<string, IconNode[]> = {
  braces: [{ tag: "path", d: "M9 3H7a2 2 0 0 0-2 2v3c0 2-1 3-3 4 2 1 3 2 3 4v3a2 2 0 0 0 2 2h2M15 3h2a2 2 0 0 1 2 2v3c0 2 1 3 3 4-2 1-3 2-3 4v3a2 2 0 0 1-2 2h-2" }],
  shield: [
    { tag: "path", d: "M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" },
    { tag: "path", d: "m9 12 2 2 4-4" },
  ],
  format: [{ tag: "path", d: "M4 6h16M4 12h6m4 0h6M4 18h16M8 9l-3 3 3 3" }],
  minify: [{ tag: "path", d: "M4 5h16M4 19h16M12 7v10m-4-4 4 4 4-4" }],
  check: [{ tag: "path", d: "m5 12 4 4L19 6" }],
  copy: [
    { tag: "rect", x: "8", y: "8", width: "12", height: "12", rx: "2" },
    { tag: "path", d: "M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" },
  ],
  trash: [{ tag: "path", d: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" }],
  upload: [{ tag: "path", d: "M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4" }],
  download: [{ tag: "path", d: "M12 4v12m-5-5 5 5 5-5M4 16v4h16v-4" }],
  paste: [
    { tag: "rect", x: "8", y: "3", width: "8", height: "4", rx: "1" },
    { tag: "path", d: "M8 5H5v16h14V5h-3M8 12h8m-8 4h6" },
  ],
  swap: [{ tag: "path", d: "M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4" }],
  file: [{ tag: "path", d: "M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6" }],
  search: [
    { tag: "circle", cx: "10.5", cy: "10.5", r: "6.5" },
    { tag: "path", d: "m16 16 4 4" },
  ],
  wrap: [{ tag: "path", d: "M4 6h16M4 12h13a3 3 0 1 1 0 6h-4m3-3-3 3 3 3M4 18h5" }],
  expand: [{ tag: "path", d: "M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" }],
  collapse: [{ tag: "path", d: "M4 8h4V4m12 4h-4V4M4 16h4v4m12-4h-4v4" }],
  layout: [
    { tag: "rect", x: "3", y: "4", width: "18", height: "16", rx: "2" },
    { tag: "path", d: "M12 4v16" },
  ],
  stack: [
    { tag: "rect", x: "3", y: "4", width: "18", height: "16", rx: "2" },
    { tag: "path", d: "M3 12h18" },
  ],
  settings: [
    { tag: "path", d: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" },
    { tag: "path", d: "m10 3-.5 2.3-2 .9-2-.9-2.2 3.8L5 10.7v2.6l-1.7 1.6 2.2 3.8 2-.9 2 .9.5 2.3h4l.5-2.3 2-.9 2 .9 2.2-3.8-1.7-1.6v-2.6l1.7-1.6-2.2-3.8-2 .9-2-.9L14 3z" },
  ],
  minus: [{ tag: "path", d: "M5 12h14" }],
  plus: [{ tag: "path", d: "M5 12h14M12 5v14" }],
  code: [{ tag: "path", d: "m8 6-6 6 6 6m8-12 6 6-6 6m-2-15-4 18" }],
  alert: [
    { tag: "circle", cx: "12", cy: "12", r: "9" },
    { tag: "path", d: "M12 7v6m0 4h.01" },
  ],
  close: [{ tag: "path", d: "m6 6 12 12M18 6 6 18" }],
  keyboard: [
    { tag: "rect", x: "2", y: "5", width: "20", height: "14", rx: "2" },
    { tag: "path", d: "M6 9h.01m4 0h.01m4 0h.01m4 0h.01M6 13h.01m4 0h.01m4 0h.01m4 0h.01M8 16h8" },
  ],
  fold: [{ tag: "path", d: "M4 4h16v16H4zM8 9l4 4 4-4" }],
  unfold: [{ tag: "path", d: "M4 4h16v16H4zM8 15l4-4 4 4" }],
  note: [{ tag: "path", d: "M6 3h9l3 3v15H6zM15 3v4h4M9 12h6m-6 4h4" }],
};

export function mountIcons(host: SVGSVGElement): void {
  host.setAttribute("aria-hidden", "true");
  host.classList.add("ff-icon-library");
  for (const [name, nodes] of Object.entries(ICONS)) {
    const symbol = document.createElementNS(SVG, "symbol");
    symbol.id = `ff-i-${name}`;
    symbol.setAttribute("viewBox", "0 0 24 24");
    for (const node of nodes) {
      const el = document.createElementNS(SVG, node.tag);
      for (const [key, value] of Object.entries(node)) {
        if (key !== "tag") el.setAttribute(key, value);
      }
      symbol.append(el);
    }
    host.append(symbol);
  }
}

export function icon(parent: HTMLElement, name: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `#ff-i-${name}`);
  use.setAttributeNS("http://www.w3.org/1999/xlink", "href", `#ff-i-${name}`);
  svg.append(use);
  parent.append(svg);
  return svg;
}

export function setIcon(svg: SVGSVGElement, name: string): void {
  const use = svg.querySelector("use");
  const href = `#ff-i-${name}`;
  use?.setAttribute("href", href);
  use?.setAttributeNS("http://www.w3.org/1999/xlink", "href", href);
}
