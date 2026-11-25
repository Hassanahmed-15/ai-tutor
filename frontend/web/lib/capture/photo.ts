import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { appPath } from "@/lib/appPaths";

const execFileAsync = promisify(execFile);
const PYTHON = process.env.PDF_PYTHON_BINARY ?? "python3";
const SCRIPT = appPath("scripts", "pdf_pipeline.py");

export type StraightenedPhoto = {
  page: Buffer;
  vision: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  sharpness: number;
  brightness: number;
  pageFound: boolean;
  warped: boolean;
};

/**
 * A photographed page, flattened (scripts/pdf_pipeline.py `photo`): its outline found and warped square, a little
 * contrast, and three copies — the page that is read, the strict panel's vision copy and a thumbnail — with the
 * measurements that say whether it is a good shot (lib/capture/rules.ts photoProblem). One Python process.
 */
export async function straightenPhoto(photo: Buffer, ext: "jpeg" | "png"): Promise<StraightenedPhoto> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aria-photo-"));
  try {
    const input = path.join(dir, `photo.${ext === "png" ? "png" : "jpg"}`);
    await writeFile(input, photo);
    const { stdout } = await execFileAsync(PYTHON, [SCRIPT, "photo", "--input", input, "--output-dir", dir], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "{}";
    const m = JSON.parse(line) as Partial<StraightenedPhoto>;
    const [page, vision, thumb] = await Promise.all(["page.jpg", "vision.jpg", "thumb.jpg"].map((f) => readFile(path.join(dir, f))));
    return {
      page,
      vision,
      thumb,
      width: Number(m.width) || 0,
      height: Number(m.height) || 0,
      sharpness: Number(m.sharpness) || 0,
      brightness: Number(m.brightness) || 0,
      pageFound: m.pageFound === true,
      warped: m.warped === true,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
