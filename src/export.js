import { toPng } from "html-to-image";
import { createPaper } from "./paper.js";

/** Render a page (text + notes) off-screen and return it as a PNG Blob, cropped to its content. */
export async function paperPng(opts, notes) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-30000px;top:0;width:2400px;height:4000px;overflow:hidden;pointer-events:none";
  const vp = document.createElement("div");
  vp.style.cssText = "position:absolute;inset:0";
  host.append(vp);
  document.body.append(host);
  try {
    const p = createPaper(vp, { ...opts, mode: "view" });
    p.setNotes(notes || []);
    if (document.fonts) await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    p.refresh();
    const b = p.bounds();
    const url = await toPng(p.paper, {
      width: b.w, height: b.h, pixelRatio: 2, backgroundColor: "#fcfaf4",
      style: { transform: `translate(${-b.x}px, ${-b.y}px)`, boxShadow: "none", borderRadius: "0" },
    });
    return await (await fetch(url)).blob();
  } finally { host.remove(); }
}

export function downloadBlob(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
