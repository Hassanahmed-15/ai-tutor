import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Convert a PowerPoint to PDF, so slides can go through the PDF rasteriser unchanged.
 *
 * WHY THIS RATHER THAN DRAWING SLIDES. `lib/pptxRender.ts` composes a slide from its XML — the text
 * runs and the embedded pictures, at their real positions. That is as far as reading the file can
 * get you, and it is not the slide: themes, masters, SmartArt, native charts, gradients and effects
 * are drawn by PowerPoint itself and simply are not in the file in a form anything else can draw.
 *
 * LibreOffice can draw them. Converting to PDF and then rasterising with the SAME code the PDF path
 * uses (`renderPdfWithPython`) is what "a deck is treated exactly like a paper" actually means — one
 * rasteriser, one code path, rather than a second pipeline that resembles the first.
 *
 * NULL, NEVER A THROW. LibreOffice is a system package; it is in the container image and may not be
 * on a developer's machine. Missing it must degrade to the composed preview, not break the upload:
 * a reconstruction beats a refusal, and the caller says on screen which one is being shown.
 */

/** Candidates in order. `SOFFICE_BINARY` wins, matching how PDF_PYTHON_BINARY is honoured. */
function candidates(): string[] {
  const configured = process.env.SOFFICE_BINARY?.trim();
  return [
    ...(configured ? [configured] : []),
    "soffice",
    "libreoffice",
    // Windows installs, for local development.
    "C:/Program Files/LibreOffice/program/soffice.exe",
    "C:/Program Files (x86)/LibreOffice/program/soffice.exe",
  ];
}

/**
 * A deck can take a while on a cold LibreOffice profile, and a hung converter must not hold a
 * request open indefinitely — the PDF pipeline uses the same discipline for the same reason.
 */
const TIMEOUT_MS = 120_000;

let cachedBinary: string | null = null;

/**
 * The first candidate that actually runs.
 *
 * ONLY A SUCCESS IS CACHED. Caching the absence too seems obvious and is a trap: a server started
 * before LibreOffice was installed then serves composed previews for its whole life, and the only
 * cure is a restart nobody knows to perform. It cost me a confused verification run. Re-probing
 * costs one `--version` per upload, which is nothing beside the conversion itself.
 */
export async function findSoffice(): Promise<string | null> {
  if (cachedBinary) return cachedBinary;
  for (const binary of candidates()) {
    try {
      await execFileAsync(binary, ["--version"], { timeout: 20_000 });
      cachedBinary = binary;
      return binary;
    } catch {
      // Not this one. Try the next.
    }
  }
  return null;
}

/** Test seam: forget which binary was found, so a test can exercise both paths. */
export function resetSofficeCache(): void {
  cachedBinary = null;
}

/**
 * Convert `.pptx` bytes to PDF bytes, or null when no converter is available.
 */
export async function convertPptxToPdf(bytes: Uint8Array): Promise<Uint8Array | null> {
  const binary = await findSoffice();
  if (!binary) return null;

  const directory = await mkdtemp(path.join(os.tmpdir(), "aria-pptx-"));
  try {
    const input = path.join(directory, "deck.pptx");
    await writeFile(input, bytes);

    /*
     * `-env:UserInstallation` gives this conversion its own profile directory.
     *
     * Without it, concurrent conversions contend over one shared LibreOffice profile and the second
     * silently exits without producing a file — which looks exactly like "conversion unsupported"
     * and would send every deck down the fallback path under load.
     */
    await execFileAsync(binary, [
      "--headless",
      "--norestore",
      `-env:UserInstallation=file:///${directory.replace(/\\/g, "/")}/profile`,
      "--convert-to", "pdf",
      "--outdir", directory,
      input,
    ], { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });

    // LibreOffice names the output after the input, but has changed that across versions; find it.
    const produced = (await readdir(directory)).find((name) => name.toLowerCase().endsWith(".pdf"));
    if (!produced) return null;
    return new Uint8Array(await readFile(path.join(directory, produced)));
  } catch {
    // A deck LibreOffice cannot open is not a failed upload — the composed preview still works.
    return null;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
