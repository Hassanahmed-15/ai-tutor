/**
 * A syllabus's text for an agent to read (free: pdftotext, or local Tesseract OCR for scans).
 *
 *   node --import tsx scripts/curriculum/text.mts <id> --info          pages, codes, grade pattern, notes
 *   node --import tsx scripts/curriculum/text.mts <id> --pages 12-30   those pages, [page N]-tagged
 *   node --import tsx scripts/curriculum/text.mts <id> --codes         every outcome code with its page
 *   add --ocr to re-read the whole PDF with Tesseract (Urdu/Arabic fonts that extract scrambled);
 *   after that every tool, including the checker, uses the OCR text for this document.
 *   --reading-order shows the text in reading order (codes split over two lines come out whole).
 *   --lang eng+urd+ara picks the OCR languages (default: Urdu+Arabic+English for Urdu/Arabic/
 *   Islamiyat subjects, English otherwise). To redo an OCR, delete .curricula-raw/.text/<id>.ocr.json.
 */
import { codesInText, inferGradeFromCode } from "../../lib/curriculum/build";
import { loadRegistry, pdfPages, readingOrderPages, squeeze } from "./extract.mts";

const [id, ...args] = process.argv.slice(2);
const entry = loadRegistry().find((e) => e.id === id);
if (!entry) {
  console.error(`unknown id ${id}`);
  process.exit(1);
}
const langAt = args.indexOf("--lang");
// --reading-order: the PDF in reading order — codes that a table wraps over two lines come out whole.
const pages = args.includes("--reading-order") ? readingOrderPages(entry) : pdfPages(entry, { ocr: args.includes("--ocr"), lang: langAt >= 0 ? args[langAt + 1] : undefined });
// Codes from every text the checker reads (layout, OCR if made, reading order), first page each.
let codes: Map<string, number[]> | null = null;
if (entry.codePattern) {
  codes = new Map();
  const texts = [pdfPages(entry), pdfPages(entry, { raw: true }), readingOrderPages(entry)];
  for (const t of texts) for (const [c, at] of codesInText(t, entry.codePattern)) if (!codes.has(c)) codes.set(c, at);
}
if (args.includes("--info")) {
  const { localFiles, sourceUrls, ...rest } = entry;
  console.log(JSON.stringify({ ...rest, sourceUrls, pagesInText: pages.length, nonEmptyPages: pages.filter((p) => p.trim().length > 40).length, expectedCodes: codes?.size ?? null, firstCodes: codes ? [...codes.keys()].slice(0, 8) : [], gradeFromCode: entry.gradeFromCode ?? inferGradeFromCode(entry.sampleCodes, entry.grades) }, null, 1));
} else if (args.includes("--codes")) {
  if (!codes) console.log("(this document has no code pattern)");
  else for (const [c, at] of codes) console.log(`${c}\tp${at.map((p) => p + 1).join(",")}`);
} else {
  const i = args.indexOf("--pages");
  const [a, b] = (i >= 0 ? args[i + 1] : `1-${pages.length}`).split("-").map(Number);
  for (let p = Math.max(1, a); p <= Math.min(pages.length, b || a); p++) console.log(`[page ${p}]\n${squeeze(pages[p - 1])}\n`);
}
