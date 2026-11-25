import "server-only";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type OpenAI from "openai";
import { locateParts, prepareStoredIllustration } from "../illustratedBoard";
import type { SuprnotesLessonInput } from "../suprnotes";
import { printedLabelBoxes } from "./labelLeaders";
import { saveCanvasImage } from "./store";
import type { CanvasBoardSpec, CanvasPlanBeat, IllustrationStage } from "./types";

/**
 * A REFERENCE PDF'S OWN FIGURE, PUT UP ON ITS BOARD (owner, 2026-11-25). The crop the parser made at
 * 400 DPI (app/api/parse-pdf) is shown as printed — nothing is generated — and every part the script
 * names is found on it, so Aria's pointer goes to that part on the sentence that names it:
 *
 * - a part printed on the figure (a node's value, "(a)", a label) is found by reading the crop (Tesseract);
 * - a part that is drawn, not printed ("the parent of 5"), by one vision call (lib/illustratedBoard.ts).
 *
 * The board lays every picture out at 3:2 and fills it (lib/canvas/layout.ts), so the crop is first set
 * on a white card of that shape: a wide figure keeps both its panels, a tall one its top and bottom.
 */

const BOARD_ASPECT = 1.5;

/** The crop centred on a white 3:2 card, a little margin round it. */
async function onBoardCard(bytes: Buffer): Promise<Buffer> {
  const image = await loadImage(bytes);
  const margin = 0.04;
  const needW = image.width * (1 + margin * 2);
  const needH = image.height * (1 + margin * 2);
  const width = Math.round(Math.max(needW, needH * BOARD_ASPECT));
  const height = Math.round(width / BOARD_ASPECT);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, Math.round((width - image.width) / 2), Math.round((height - image.height) / 2));
  return canvas.encode("png");
}

export async function pdfFigurePicture(
  openai: OpenAI,
  userId: string,
  lectureId: string,
  beat: CanvasPlanBeat,
  spec: CanvasBoardSpec,
  doc: SuprnotesLessonInput,
  log: string[],
): Promise<{ spec: CanvasBoardSpec; costUsd: number } | null> {
  const figure = beat.pdfFigure;
  if (!figure || spec.stage.kind !== "illustration") return null;
  const asset = (doc.assets ?? []).find((a) => a.id === figure.assetId);
  const data = typeof asset?.url === "string" ? asset.url.match(/^data:image\/[a-z]+;base64,(.+)$/)?.[1] : undefined;
  if (!data) {
    log.push(`${beat.id}: the document's ${figure.id} has no crop to show`);
    return null;
  }
  const stage = spec.stage;
  const own = `${lectureId}-${beat.id}`;
  const card = await onBoardCard(Buffer.from(data, "base64"));
  const picture = await prepareStoredIllustration(card);
  await saveCanvasImage(userId, own, picture.display);

  const names = [...new Set(stage.parts.map((p) => p.name.trim()).filter(Boolean))].slice(0, 12);
  let costUsd = 0;
  // Printed on the figure: read off the crop itself.
  const printed = await printedLabelBoxes(picture.display, names).catch(() => new Map<string, { x: number; y: number; w: number; h: number }>());
  const drawn = names.filter((n) => !printed.has(n));
  // Drawn, not printed: one vision call places them on the figure's own ink.
  const located = drawn.length
    ? await locateParts(openai, picture.jpeg, `${figure.caption || stage.subject}${figure.description ? ` — ${figure.description}` : ""}`, drawn).catch((error: Error) => {
        log.push(`${beat.id}: figure parts not located — ${error.message}`);
        return { parts: [], textInImage: true, costUsd: 0 };
      })
    : { parts: [], textInImage: true, costUsd: 0 };
  costUsd += located.costUsd;
  const at = new Map(located.parts.map((p) => [p.name, p]));
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const parts: IllustrationStage["parts"] = stage.parts.flatMap((p) => {
    const box = printed.get(p.name.trim());
    if (box) return [{ ...p, x: round(box.x + box.w / 2), y: round(box.y + box.h / 2), labelBox: box }];
    const point = at.get(p.name.trim());
    return point ? [{ ...p, x: round(point.x), y: round(point.y) }] : [];
  });
  const kept = new Set(parts.map((p) => p.id));
  // NO LABELS ARE WRITTEN OVER THE STUDENT'S FIGURE: the board's black label boxes covered the figure's own
  // writing (hearing lecture, 2026-11-25). The pointer goes to each part as it is named; the figure speaks for itself.
  const labels: string[] = [];
  const pointed = new Set(spec.cues.filter((c) => c.target && kept.has(c.target)).map((c) => c.target));
  log.push(`${beat.id}: shows the document's ${figure.id} (page ${figure.pageNumber}) as cropped — ${parts.length}/${stage.parts.length} part(s) found (${printed.size} printed, ${located.parts.length} drawn)`);
  return {
    costUsd,
    spec: {
      ...spec,
      stage: {
        ...stage,
        subject: figure.caption || stage.subject,
        parts,
        labels,
        labelsInPicture: [...printed.keys()],
        description: figure.description || stage.description,
        src: `/api/canvas-lecture/image/${own}`,
        paper: "#ffffff",
        fromDocument: { page: figure.pageNumber, caption: figure.caption },
      },
      cues: [
        ...spec.cues.filter((c) => !c.target || !stage.parts.some((p) => p.id === c.target) || kept.has(c.target)),
        // Each part is pointed at on the sentence that names it.
        ...parts.filter((p) => !pointed.has(p.id)).map((p) => ({ s: p.s, at: 0.3, action: "point" as const, target: p.id })),
      ],
    },
  };
}
