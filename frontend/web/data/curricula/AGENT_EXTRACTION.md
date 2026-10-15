# Turning a syllabus into a course (agent instructions)

You read official syllabus documents and write their subject content as rows. A free checker turns
the rows into a course tree and tells you exactly what is missing. No paid AI APIs are used — do
NOT call OpenAI, Gemini or any other API, and do not run `extract.mts` or `structured.mts`.

All commands run from `/Users/hassanahmed/ai-tutor/frontend/web`.

## The loop

1. **Claim the next document** — always with the claim tool (it skips anything already built, in
   progress or claimed; never pick ids by hand):
   ```
   node --import tsx scripts/curriculum/claim.mts        # prints an id, or NONE when the queue is done
   ```
   If you cannot finish it: `node --import tsx scripts/curriculum/claim.mts --release <id>`.
   If it is unreadable even after `--ocr` (or has no subject content at all), set it aside for a
   human so nobody is handed it again: `node --import tsx scripts/curriculum/claim.mts --skip <id> "reason"`.
2. **Look at it:** `node --import tsx scripts/curriculum/text.mts <id> --info` (pages, how many
   outcome codes, the grades, notes). `--codes` lists every code with its page.
3. **Read it** in page ranges: `node --import tsx scripts/curriculum/text.mts <id> --pages 1-25`.
   Skim the contents page first to find where the subject content is; skip front matter, teaching
   guidance, assessment objectives, exam structure, mark schemes and glossaries.
4. **Write the rows** to `data/curricula/rows/<id>.json` — a JSON array in document order (write
   it with a small python script using json.dump so it is always valid; for a long document,
   build the list across several page ranges and write once at the end, or append and rewrite):
   ```json
   [{"grade": "9", "unit": "Domain B: Mechanics", "topic": "Kinematics",
     "subtopic": "Speed and velocity", "code": "P-09-B-02",
     "outcome": "Tell distance from displacement and speed from velocity."}]
   ```
   - `grade`: one of the entry's `grades` exactly as listed (e.g. "9", "Year 7", "Stage 3",
     "IGCSE"); `"all"` if the document does not divide content by grade — the checker's "unexpected
     grade label" / "has no content" warnings are then expected and fine. Never split by year on a
     guess: for A Level, use Year 12 / Year 13 (or AS / A Level) only when the spec itself marks which
     content is AS and which is A-level only.
   - `unit`: the document's top-level content heading, ONE consistent level for the whole document,
     keeping its number/letter ("Domain B: Mechanics", "3 Electricity"). Same spelling every time.
   - `topic`: the heading under the unit, as printed.
   - `subtopic`: **the lesson** — one 5-8 minute board lesson. Use the printed sub-heading when it
     is lesson-sized; otherwise group 2-6 consecutive, closely related outcomes under a short name
     (2-6 plain words) that says what is taught. Never more than ~8 outcomes in one lesson.
   - `code`: the outcome's code exactly as printed (e.g. "C-09-A-01", "1.2.3", "SPQ-1.A"),
     else null. Every code the document lists as subject content must get exactly one row.
   - `outcome`: what the student must know or be able to do, **in your own plain words** (max ~25
     words). Never copy the document's sentence — publishers own their wording.
5. **Check:** `node --import tsx scripts/curriculum/from-rows.mts <id>`. It prints coverage
   ("100.0% of 680 codes"), any MISSING codes, and warnings. Add rows for missing codes (use
   `--codes` to find their pages) and re-run until coverage is 100% or every remaining missing code
   is genuinely not subject content (e.g. it only appears in an assessment table) — say which in
   your final report. Fix warnings that point at real mistakes (a heading misread as content, a
   wrong grade). The checker writes `data/curricula/trees/<id>.json` each time it runs.
6. Next document.

## Numbered sections with statements under them (Cambridge, AQA, OCR, Edexcel…)
Many syllabuses number SECTIONS ("2.5 Simple molecules and covalent bonds") and list numbered or
bulleted STATEMENTS under each ("1 State that a covalent bond…", "2 Describe the formation…",
"3 … (a) … (b) …"). The statements are the learning outcomes: write ONE ROW PER STATEMENT (sub-points
(a), (b) belong to their statement's row). Put the section's code on its first statement row and
`null` on the others — the checker counts sections, but the course must carry every statement.
A course with about one row per section is too shallow and will be redone.
Do NOT add generic "overview" rows just to carry a section number: the checker already counts a
section ("1.1") as covered when its statements ("1.1.1"…) are present. Every row must be a real
learning outcome the syllabus states.

## Documents without codes
Coverage cannot be measured, so be thorough by hand: every content statement in the subject-content
section becomes a row. Language/literature/arts syllabuses: the content is the skills and set
topics/themes — rows per skill or theme area are right; do not invent content.

## Urdu / Arabic documents
Their PDF fonts often extract as scrambled or reversed text. Run `text.mts <id> --ocr --info` once:
it re-reads every page with Tesseract's Urdu+Arabic model (about a minute; the models ARE installed
in `.curricula-raw/tessdata`). For a mixed document whose subject name doesn't say Urdu, add
`--lang eng+urd+ara`. To redo an OCR, delete `.curricula-raw/.text/<id>.ocr.json` first and from then on every
tool — including the checker — uses that text. Read the OCR'd text; write outcomes in English.

## Documents covering more than one grade
Many FBISE documents print the outcomes of two grades side by side (XI and XII, IX and X). Include
every grade the document really covers, each row with its real grade (from the code, e.g. E-11 →
"11"), even if the entry lists only one; the "unexpected grade label" warning is then fine.

## Codes split over two lines
Tables often wrap a code ("PSWHS-11-A-" / "01"). The checker also reads the PDF in reading order,
where such codes come out whole, so DO give those rows their code. To see that text:
`text.mts <id> --reading-order --pages 10-20`; `--codes` already lists every code found.

## Scanned documents
`text.mts` OCRs scans automatically (slow the first time, cached after). If the OCR text is too
poor to read reliably, write what you can, and report it.

## When to stop
Stop after about 8 documents or ~400 pages, whichever comes first, so your context stays sharp.
Release nothing — leave your claims in place. Your final message (to the orchestrator, under 200
words): ids finished with their coverage lines, any id you claimed but could not finish (release it with the claim tool so another agent can take it), and problems worth a human look.
