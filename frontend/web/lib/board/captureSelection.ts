import type { SelectionRegion } from "./selection";

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function cropViewBox(
  viewBox: ViewBox,
  svgRect: { left: number; top: number; width: number; height: number },
  stageRect: { left: number; top: number; width: number; height: number },
  region: SelectionRegion,
): ViewBox {
  const left = stageRect.left + region.x * stageRect.width;
  const top = stageRect.top + region.y * stageRect.height;
  const right = left + region.width * stageRect.width;
  const bottom = top + region.height * stageRect.height;
  const x0 = Math.max(0, Math.min(1, (left - svgRect.left) / Math.max(1, svgRect.width)));
  const y0 = Math.max(0, Math.min(1, (top - svgRect.top) / Math.max(1, svgRect.height)));
  const x1 = Math.max(x0 + 0.01, Math.min(1, (right - svgRect.left) / Math.max(1, svgRect.width)));
  const y1 = Math.max(y0 + 0.01, Math.min(1, (bottom - svgRect.top) / Math.max(1, svgRect.height)));
  return {
    x: viewBox.x + x0 * viewBox.width,
    y: viewBox.y + y0 * viewBox.height,
    width: Math.max(viewBox.width * 0.01, (x1 - x0) * viewBox.width),
    height: Math.max(viewBox.height * 0.01, (y1 - y0) * viewBox.height),
  };
}

function inlineVisualStyles(source: Element, clone: Element) {
  const computed = getComputedStyle(source);
  const keys = [
    "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity",
    "font-family", "font-size", "font-weight", "font-style", "letter-spacing",
    "text-anchor", "dominant-baseline", "display", "visibility", "transform",
  ];
  const style = keys.map((key) => `${key}:${computed.getPropertyValue(key)}`).join(";");
  if (style) clone.setAttribute("style", `${clone.getAttribute("style") ?? ""};${style}`);
  const sourceChildren = [...source.children];
  const cloneChildren = [...clone.children];
  sourceChildren.forEach((child, index) => {
    if (cloneChildren[index]) inlineVisualStyles(child, cloneChildren[index]);
  });
}

function imageFrom(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected board region could not be rasterised."));
    image.src = url;
  });
}

/** Rasterise only what the learner marked, including their ink, for the vision model. */
export async function captureSelectedBoardRegion(stage: HTMLElement, region: SelectionRegion): Promise<string> {
  const active = stage.querySelector<HTMLElement>('[data-active-board="true"]') ?? stage;
  const stageRect = stage.getBoundingClientRect();
  const svgs = [...active.querySelectorAll<SVGSVGElement>("svg")]
    .map((svg) => ({ svg, rect: svg.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width * rect.height > 10_000)
    .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
  const source = svgs[0];
  const outputWidth = 768;
  const outputHeight = Math.max(220, Math.min(768, Math.round(outputWidth * region.height / Math.max(0.05, region.width))));
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable.");
  const background = getComputedStyle(active).backgroundColor || "#08090c";
  ctx.fillStyle = background === "rgba(0, 0, 0, 0)" ? "#08090c" : background;
  ctx.fillRect(0, 0, outputWidth, outputHeight);

  if (source) {
    const originalViewBox = source.svg.viewBox?.baseVal;
    const viewBox = originalViewBox && originalViewBox.width > 0
      ? { x: originalViewBox.x, y: originalViewBox.y, width: originalViewBox.width, height: originalViewBox.height }
      : { x: 0, y: 0, width: source.rect.width, height: source.rect.height };
    const cropped = cropViewBox(viewBox, source.rect, stageRect, region);
    const clone = source.svg.cloneNode(true) as SVGSVGElement;
    inlineVisualStyles(source.svg, clone);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(outputWidth));
    clone.setAttribute("height", String(outputHeight));
    clone.setAttribute("viewBox", `${cropped.x} ${cropped.y} ${cropped.width} ${cropped.height}`);
    const xml = new XMLSerializer().serializeToString(clone);
    const data = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    const image = await imageFrom(data);
    ctx.drawImage(image, 0, 0, outputWidth, outputHeight);
  }

  // The annotation canvas is a sibling of the board renderer, so composite the same crop after the
  // visual. This makes the model see the circle/underline itself, not merely the content under it.
  const ink = [...stage.querySelectorAll<HTMLCanvasElement>("canvas")].find((item) => {
    const rect = item.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  if (ink) {
    const inkRect = ink.getBoundingClientRect();
    const sx = Math.max(0, (stageRect.left + region.x * stageRect.width - inkRect.left) * (ink.width / Math.max(1, inkRect.width)));
    const sy = Math.max(0, (stageRect.top + region.y * stageRect.height - inkRect.top) * (ink.height / Math.max(1, inkRect.height)));
    const sw = Math.min(ink.width - sx, region.width * stageRect.width * (ink.width / Math.max(1, inkRect.width)));
    const sh = Math.min(ink.height - sy, region.height * stageRect.height * (ink.height / Math.max(1, inkRect.height)));
    if (sw > 0 && sh > 0) ctx.drawImage(ink, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);
  }

  return canvas.toDataURL("image/png", 0.92);
}

