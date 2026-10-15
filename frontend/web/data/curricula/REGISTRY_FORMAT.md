# Curriculum source registry

One JSON file per region in `data/curricula/registry/<region>.json`: an array of entries.
Each entry is ONE official source document (or API dataset) that one extraction run turns into
one tree in `data/curricula/trees/<id>.json`.

```jsonc
{
  "id": "pk-ncp-physics-9-12",          // kebab-case, unique across all regions, stable
  "region": "PK",                       // PK | US | UK | INTL | IN | AU
  "framework": "National Curriculum of Pakistan 2022-23",
  "board": "FBISE",                     // exam board / authority if any, else null
  "qualification": "SSC/HSSC",          // e.g. "GCSE", "A Level", "AP", "IGCSE", "Primary", null
  "subject": "Physics",
  "grades": ["9", "10", "11", "12"],    // grade/year labels the document covers, as the document names them
  "gradeSystem": "grade",               // grade | year | stage | key-stage | course
  "syllabusCode": null,                 // e.g. "0625" for Cambridge IGCSE Physics, "8463" for AQA
  "sourceKind": "pdf",                  // pdf | html | api | json | xlsx
  "sourceUrls": ["https://…"],          // official URL(s), publisher's own domain wherever possible
  "localFiles": [".curricula-raw/PK/pk-ncp-physics-9-12.pdf"],   // downloaded copies (gitignored)
  "pages": 212,                         // from pdfinfo, for PDFs
  "publisher": "Ministry of Federal Education and Professional Training",
  "licence": "Government publication; structure + our own wording only",
  "codePattern": "\\b[A-Z]-\\d{2}-[A-Z]-\\d{2}\\b",   // JS regex for learning-outcome codes in the text, or null
  "sampleCodes": ["P-09-A-01", "P-09-A-02"],          // 2-5 codes copied from the document, or []
  "firstExam": "2027",                  // first exam year / version the document is valid for, if stated
  "notes": "Outcomes are in tables, one per row; grade columns 9-12."
}
```

Rules
- Official sources only (the board, ministry or publisher's own site). Mirrors only when the
  official file is unreachable, and say so in `notes`.
- The newest version in force. If two versions overlap (old/new syllabus), list both with
  `firstExam` set.
- Verify every download opens (`pdfinfo` for PDFs) and is the syllabus, not a cover page.
- `codePattern` must match the codes in the downloaded text (`pdftotext -layout file - | grep -E`),
  and must not match page numbers or other noise. Null if the document has no outcome codes.
