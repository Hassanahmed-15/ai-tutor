/**
 * "UPLOAD PHOTOS" FROM THE COMPUTER: the student's photos of their paper answers, shrunk in the browser and sent
 * with the grading request as data URLs (app/api/practice/exam/[id]/grade accepts `images`, ≤ 8 MB each, ≤ 10 pages
 * with any phone pages). The grader reads them in the same vision call as phone-scanned pages, so there is no second
 * "reading" pass and nothing to keep on the server between choosing and submitting.
 */
const MAX_PHOTOS = 6;
const MAX_SIDE = 1800;

export type UploadProgress = { stage: "sending" | "reading" | "assembling"; done: number; of: number };
export type UploadedPages = { images: string[]; pageCount: number };

async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#fff"; // a transparent PNG becomes white paper, not black
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadPhotos(files: File[], onProgress: (p: UploadProgress) => void): Promise<UploadedPages> {
  const photos = files.filter((f) => f.type.startsWith("image/")).slice(0, MAX_PHOTOS);
  if (!photos.length) throw new Error("Choose photos of your pages (JPEG or PNG).");
  const images: string[] = [];
  onProgress({ stage: "sending", done: 0, of: photos.length });
  for (const file of photos) {
    try { images.push(await shrink(file)); } catch { throw new Error(`"${file.name}" couldn't be opened as a photo.`); }
    onProgress({ stage: "sending", done: images.length, of: photos.length });
  }
  return { images, pageCount: images.length };
}
