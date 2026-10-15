/**
 * THE CURRICULUM CATALOGUE'S SHAPE (owner's ask, 2026-10-14: "every grade 1-12, every course,
 * Pakistan and the US and everywhere, more than Cognito").
 *
 * Every official syllabus — a Pakistan NCP PDF, a Cambridge syllabus, an AP course description,
 * Oak's API, ACARA's data files — ends up as one `CurriculumTree`:
 *
 *   course → grade → unit → topic → subtopic → learning outcomes
 *
 * A subtopic is lesson-sized: one Aria lesson teaches it. Outcomes keep the document's own code
 * (so coverage can be checked against the source) but are worded by us, never copied: the
 * publishers own their text; the structure and the codes are what we need.
 *
 * Sources are listed in data/curricula/registry/*.json (format: data/curricula/REGISTRY_FORMAT.md),
 * extracted by scripts/curriculum/extract.mts, and written to data/curricula/trees/<id>.json.
 */

export type Region = "PK" | "US" | "UK" | "INTL" | "IN" | "AU";

/** One source document as the registry lists it. */
export type RegistryEntry = {
  id: string;
  region: Region;
  framework: string;
  board: string | null;
  qualification: string | null;
  subject: string;
  grades: string[];
  gradeSystem: "grade" | "year" | "stage" | "key-stage" | "course";
  syllabusCode: string | null;
  sourceKind: "pdf" | "html" | "api" | "json" | "xlsx";
  sourceUrls: string[];
  localFiles: string[];
  pages?: number;
  publisher: string;
  licence: string;
  codePattern: string | null;
  sampleCodes: string[];
  firstExam?: string | null;
  notes?: string;
  /**
   * A regex with one capture group that reads the grade out of an outcome code — "^P-(\\d{2})" for
   * NCP (P-09-B-03 → "9"), "^AC9[A-Z]+(\\d{1,2}|F)" for ACARA, "^(K|\\d{1,2})\\." for Common Core.
   * Leading zeros are dropped. When set, the code decides the grade, not the model.
   */
  gradeFromCode?: string | null;
};

/** One learning outcome, in our words, with the document's code when it has one. */
export type Outcome = { code: string | null; text: string };

export type Subtopic = { id: string; title: string; outcomes: Outcome[] };
export type Topic = { id: string; title: string; subtopics: Subtopic[] };
export type Unit = { id: string; title: string; topics: Topic[] };
export type GradeBlock = { grade: string; units: Unit[] };

export type CurriculumTree = {
  id: string;
  region: Region;
  framework: string;
  board: string | null;
  qualification: string | null;
  subject: string;
  syllabusCode: string | null;
  gradeSystem: RegistryEntry["gradeSystem"];
  source: { urls: string[]; publisher: string; licence: string; firstExam: string | null };
  grades: GradeBlock[];
  /** How the tree was made and how complete it is against the source. */
  build: BuildReport;
};

export type BuildReport = {
  builtAt: string;
  model: string;
  usd: number;
  /** Codes the source text contains (by the registry's codePattern), or null when it has none. */
  expectedCodes: number | null;
  /** Of those, how many the tree carries. 1 = complete. Null when the source has no codes. */
  coverage: number | null;
  missingCodes: string[];
  counts: { grades: number; units: number; topics: number; subtopics: number; outcomes: number };
  warnings: string[];
};

/** A flat row as the extractor reads it off the page; trees are built from these. */
export type ExtractedRow = {
  grade: string;
  unit: string;
  topic: string;
  subtopic: string;
  code: string | null;
  outcome: string;
};
