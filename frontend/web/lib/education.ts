/**
 * THE LEARNER'S EDUCATIONAL CONTEXT — countries, study levels, subjects, and curricula/exams/tracks.
 *
 * Onboarding screen 1 (components/auth/OnboardingScreen.tsx) asks for study level, subjects and a
 * curriculum/exam/track, and the options it shows are CONTEXTUAL (owner's spec, 2026-09-29): the
 * country surfaces the local names ("GCSE / O-Level" in the UK, "Matric" in Pakistan), the study
 * level and subjects narrow the curricula (USMLE only for medicine; SAT only around high school).
 * Nothing here is a hard gate — every list is searchable and the user can always type their own —
 * so the catalogue only ORDERS and FILTERS suggestions. When a search finds nothing, the client asks
 * /api/education/suggest for AI suggestions to fill the gap.
 *
 * Pure data and functions: no I/O, unit-tested in lib/anim/education.test.ts.
 */

export type EduOption = { id: string; label: string; custom?: boolean };

/** Every level falls in one of these bands, so curricula can say which levels they belong to. */
export type LevelBand = "primary" | "middle" | "secondary" | "senior" | "undergrad" | "postgrad" | "professional";

export type LevelOption = EduOption & { band: LevelBand };

/* ------------------------------------------------------------------ countries */

/** ISO 3166-1 alpha-2 codes. Names come from Intl.DisplayNames, so they are localised for free. */
export const COUNTRY_CODES = (
  "AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW"
).split(" ");

let regionNames: Intl.DisplayNames | null = null;
export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function countryOptions(): EduOption[] {
  return COUNTRY_CODES.map((id) => ({ id, label: countryName(id) })).sort((a, b) => a.label.localeCompare(b.label));
}

const GULF = ["AE", "SA", "QA", "KW", "BH", "OM"];

/* ------------------------------------------------------------------ study levels */

const l = (id: string, label: string, band: LevelBand): LevelOption => ({ id, label, band });

/** Study levels by country: local names first, in the order a student moves through them. */
export function studyLevelsFor(country: string | null | undefined): LevelOption[] {
  const c = (country ?? "").toUpperCase();
  if (c === "GB") return [
    l("gb-primary", "Primary school", "primary"),
    l("gb-ks3", "Secondary school (Years 7–9)", "middle"),
    l("gb-gcse", "GCSE / O-Level (Years 10–11)", "secondary"),
    l("gb-alevel", "A-Level / Sixth form (Years 12–13)", "senior"),
    l("undergrad", "Undergraduate", "undergrad"),
    l("postgrad", "Postgraduate", "postgrad"),
    l("professional", "Professional study", "professional"),
  ];
  if (c === "US") return [
    l("us-elementary", "Elementary", "primary"),
    l("us-middle", "Middle School", "middle"),
    l("us-high", "High School", "senior"),
    l("undergrad", "Undergraduate", "undergrad"),
    l("us-grad", "Graduate", "postgrad"),
    l("postgrad", "Postgraduate / Doctoral", "postgrad"),
    l("professional", "Professional study", "professional"),
  ];
  if (c === "PK") return [
    l("pk-primary", "Primary", "primary"),
    l("pk-middle", "Middle (Grades 6–8)", "middle"),
    l("pk-matric", "Matric (SSC) / O-Level", "secondary"),
    l("pk-inter", "Intermediate (HSSC / FSc) / A-Level", "senior"),
    l("undergrad", "Undergraduate", "undergrad"),
    l("postgrad", "Postgraduate", "postgrad"),
    l("professional", "Professional study", "professional"),
  ];
  if (c === "IN") return [
    l("in-primary", "Primary (Classes 1–5)", "primary"),
    l("in-middle", "Middle School (Classes 6–8)", "middle"),
    l("in-secondary", "Secondary (Classes 9–10)", "secondary"),
    l("in-senior", "Senior Secondary (Classes 11–12)", "senior"),
    l("undergrad", "Undergraduate", "undergrad"),
    l("postgrad", "Postgraduate", "postgrad"),
    l("professional", "Professional study", "professional"),
  ];
  if (c === "AU" || c === "NZ") return [
    l("au-primary", "Primary school", "primary"),
    l("au-secondary", "Secondary school (Years 7–10)", "middle"),
    l("au-senior", "Senior secondary (Years 11–12)", "senior"),
    l("undergrad", "Undergraduate", "undergrad"),
    l("postgrad", "Postgraduate", "postgrad"),
    l("professional", "Professional study", "professional"),
  ];
  if (c === "CA") return [
    l("ca-elementary", "Elementary", "primary"),
    l("ca-middle", "Middle School / Junior High", "middle"),
    l("ca-high", "High School", "senior"),
    l("undergrad", "Undergraduate", "undergrad"),
    l("postgrad", "Graduate / Postgraduate", "postgrad"),
    l("professional", "Professional study", "professional"),
  ];
  if (GULF.includes(c)) return [
    l("primary", "Primary", "primary"),
    l("middle", "Middle School", "middle"),
    l("gcse", "IGCSE / O-Level / Grade 10", "secondary"),
    l("senior", "High School / A-Level / IB (Grades 11–12)", "senior"),
    l("undergrad", "Undergraduate", "undergrad"),
    l("postgrad", "Postgraduate", "postgrad"),
    l("professional", "Professional study", "professional"),
  ];
  return [
    l("primary", "Primary / Elementary", "primary"),
    l("middle", "Middle School", "middle"),
    l("secondary", "Secondary / High School", "secondary"),
    l("senior", "Upper secondary / Pre-university", "senior"),
    l("undergrad", "Undergraduate", "undergrad"),
    l("postgrad", "Postgraduate", "postgrad"),
    l("professional", "Professional study", "professional"),
  ];
}

/**
 * Study levels for a country AND the student's subjects (owner's spec, 2026-09-30: "personalized
 * based on the learner's location and subject context").
 *
 * The country gives the local names; the subjects change what is offered and in what order. A
 * subject taught only after school — medicine, law, most engineering — brings its own stages
 * (medical school, residency; law school) and puts the university levels first, because nobody
 * studies medicine in middle school. Anything else keeps the country's school-first order.
 */
export function studyLevelOptions(country: string | null | undefined, subjects: EduOption[] = []): LevelOption[] {
  const base = studyLevelsFor(country);
  const groups = new Set(subjects.map(subjectGroup).filter((g): g is SubjectGroup => Boolean(g)));
  const extras: LevelOption[] = [];
  if (groups.has("medicine")) {
    extras.push(l("medical-school", "Medical school (MBBS / MD)", "undergrad"), l("residency", "Residency / specialty training", "postgrad"));
  }
  if (groups.has("law")) extras.push(l("law-school", "Law school (LLB / JD)", "undergrad"));
  if (groups.has("business")) extras.push(l("prof-qualification", "Professional qualification (ACCA / CFA / CPA)", "professional"));
  if (groups.has("computing")) extras.push(l("bootcamp", "Bootcamp / self-taught", "professional"));
  const universityOnly = groups.size > 0 && [...groups].every((g) => g === "medicine" || g === "law" || g === "engineering");
  const tertiary = (x: LevelOption) => x.band === "undergrad" || x.band === "postgrad" || x.band === "professional";
  const ordered = universityOnly ? [...extras, ...base.filter(tertiary), ...base.filter((x) => !tertiary(x))] : [...base, ...extras];
  const seen = new Set<string>();
  return ordered.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

/** Every level from every country, for search ("I'm in Pakistan but doing A-Levels"). */
export function allStudyLevels(): LevelOption[] {
  const seen = new Map<string, LevelOption>();
  for (const c of ["GB", "US", "PK", "IN", "AU", "CA", "AE", "XX"]) for (const level of studyLevelsFor(c)) if (!seen.has(level.id)) seen.set(level.id, level);
  const fields: EduOption[] = [{ id: "medicine", label: "Medicine" }, { id: "law", label: "Law" }, { id: "business", label: "Business Studies" }, { id: "programming", label: "Programming" }];
  for (const level of studyLevelOptions("XX", fields)) if (!seen.has(level.id)) seen.set(level.id, level);
  return [...seen.values()];
}

export function levelBand(level: EduOption | null | undefined): LevelBand | null {
  if (!level) return null;
  const known = allStudyLevels().find((x) => x.id === level.id);
  if (known) return known.band;
  const t = level.label.toLowerCase();
  if (/primary|elementary|grade [1-5]\b/.test(t)) return "primary";
  if (/middle|junior high|ks3|grades? [6-8]/.test(t)) return "middle";
  if (/gcse|o[- ]?levels?|matric|ssc|grade (9|10)|class (9|10)/.test(t)) return "secondary";
  if (/a[- ]?levels?|sixth|high school|hssc|fsc|intermediate|senior|pre-?university|\bib\b|grade 1[12]|year 1[23]|class 1[12]/.test(t)) return "senior";
  if (/undergrad|bachelor|college|university|bsc|ba\b/.test(t)) return "undergrad";
  if (/postgrad|graduate|master|phd|doctor|msc|mba/.test(t)) return "postgrad";
  if (/professional|certif|exam prep|career|work/.test(t)) return "professional";
  return null;
}

/* ------------------------------------------------------------------ subjects */

type SubjectDef = EduOption & {
  group: SubjectGroup;
  aliases?: string[];
  keywords?: string[];
  /** A subject taught mainly in these countries (Urdu, Pakistan Studies). Absent = studied everywhere. */
  countries?: string[];
};
export type SubjectGroup = "math" | "science" | "medicine" | "computing" | "engineering" | "business" | "humanities" | "languages" | "arts" | "law" | "social";

const s = (id: string, label: string, group: SubjectGroup, aliases: string[] = [], keywords: string[] = [], countries?: string[]): SubjectDef => ({ id, label, group, aliases, keywords, ...(countries ? { countries } : {}) });
const ARAB = [...GULF, "EG", "JO", "PS", "IQ", "LB", "SY", "YE", "MA", "DZ", "TN", "LY", "SD"];

/**
 * Subjects, with the words a lesson topic uses (for the evolving profile's subject-wise view,
 * lib/learnerProfileView.ts). Order is rough popularity: it is the list shown before any search.
 */
export const SUBJECTS: SubjectDef[] = [
  s("mathematics", "Mathematics", "math", ["maths", "math"], ["algebra", "equation", "function", "graph", "geometry", "trigonometry", "number", "fraction", "integral", "derivative", "matrix", "vector", "probability", "statistics"]),
  s("physics", "Physics", "science", [], ["force", "motion", "newton", "energy", "momentum", "velocity", "acceleration", "electric", "magnet", "wave", "optics", "quantum", "thermodynamics", "gravity", "mechanics", "circuit"]),
  s("chemistry", "Chemistry", "science", [], ["atom", "molecule", "bond", "reaction", "acid", "base", "periodic", "element", "compound", "organic", "mole", "electron", "oxidation", "equilibrium"]),
  s("biology", "Biology", "science", [], ["cell", "dna", "gene", "photosynthesis", "respiration", "evolution", "enzyme", "protein", "organ", "heart", "lung", "chloroplast", "mitochondria", "ecosystem", "plant", "animal", "neuron", "krebs"]),
  s("computer-science", "Computer Science", "computing", ["cs", "computing"], ["algorithm", "data structure", "code", "program", "binary", "array", "tree", "graph", "sorting", "recursion", "database", "network", "operating system", "compiler"]),
  s("english", "English Language", "languages", ["english"], ["grammar", "essay", "writing", "reading", "vocabulary"]),
  s("english-literature", "English Literature", "humanities", ["literature"], ["poem", "poetry", "novel", "shakespeare", "character", "theme"]),
  s("economics", "Economics", "business", [], ["demand", "supply", "market", "inflation", "gdp", "elasticity", "monetary", "fiscal", "trade"]),
  s("business", "Business Studies", "business", ["business"], ["marketing", "management", "strategy", "finance", "accounting", "entrepreneur"]),
  s("accounting", "Accounting", "business", ["accounts"], ["ledger", "balance sheet", "debit", "credit", "financial statement", "depreciation"]),
  s("statistics", "Statistics", "math", ["stats"], ["mean", "median", "variance", "distribution", "regression", "hypothesis", "sampling", "probability"]),
  s("further-maths", "Further Mathematics", "math", ["further maths"], ["complex number", "matrices", "proof"]),
  s("calculus", "Calculus", "math", [], ["derivative", "integral", "limit", "differential"]),
  s("history", "History", "humanities", [], ["war", "revolution", "empire", "century", "civilisation", "civilization"]),
  s("geography", "Geography", "social", [], ["climate", "river", "volcano", "earthquake", "population", "urban", "landform", "weather"]),
  s("psychology", "Psychology", "social", [], ["memory", "behaviour", "behavior", "cognitive", "emotion", "perception"]),
  s("sociology", "Sociology", "social", [], ["society", "culture", "inequality", "family"]),
  s("political-science", "Political Science", "social", ["politics", "government"], ["democracy", "election", "constitution", "parliament"]),
  s("philosophy", "Philosophy", "humanities", [], ["ethics", "logic", "morality", "metaphysics", "epistemology"]),
  s("medicine", "Medicine", "medicine", ["mbbs", "md"], ["disease", "diagnosis", "clinical", "patient", "treatment", "symptom"]),
  s("anatomy", "Anatomy", "medicine", [], ["bone", "muscle", "skeleton", "organ", "artery", "nerve"]),
  s("physiology", "Physiology", "medicine", [], ["homeostasis", "hormone", "blood pressure", "kidney", "heart"]),
  s("biochemistry", "Biochemistry", "medicine", [], ["metabolism", "enzyme", "krebs", "glycolysis", "protein"]),
  s("pharmacology", "Pharmacology", "medicine", [], ["drug", "dose", "receptor"]),
  s("pathology", "Pathology", "medicine", [], ["tumour", "tumor", "inflammation", "lesion"]),
  s("microbiology", "Microbiology", "medicine", [], ["bacteria", "virus", "immune", "pathogen", "antibiotic"]),
  s("nursing", "Nursing", "medicine", [], ["care", "patient"]),
  s("pharmacy", "Pharmacy", "medicine", [], ["drug", "prescription"]),
  s("dentistry", "Dentistry", "medicine", [], ["tooth", "teeth", "dental"]),
  s("mechanical-engineering", "Mechanical Engineering", "engineering", [], ["actuator", "engine", "thermodynamics", "stress", "gear", "machine"]),
  s("electrical-engineering", "Electrical Engineering", "engineering", [], ["circuit", "voltage", "current", "transistor", "signal", "power system"]),
  s("civil-engineering", "Civil Engineering", "engineering", [], ["structure", "concrete", "beam", "bridge", "soil"]),
  s("software-engineering", "Software Engineering", "computing", [], ["software", "design pattern", "testing", "architecture"]),
  s("data-science", "Data Science", "computing", [], ["data", "pandas", "visualisation", "visualization", "dataset"]),
  s("machine-learning", "Machine Learning / AI", "computing", ["ai", "artificial intelligence", "ml", "deep learning"], ["neural network", "cnn", "overfitting", "gradient", "backpropagation", "model", "training", "classifier"]),
  s("programming", "Programming", "computing", ["coding"], ["python", "java", "javascript", "c++", "loop", "variable", "function"]),
  s("law", "Law", "law", [], ["contract", "tort", "constitution", "court", "legal"]),
  s("finance", "Finance", "business", [], ["investment", "interest", "stock", "bond", "portfolio"]),
  s("marketing", "Marketing", "business", [], ["brand", "advertising", "consumer"]),
  s("environmental-science", "Environmental Science", "science", [], ["pollution", "climate", "ecosystem", "sustainability"]),
  s("earth-science", "Earth Science", "science", ["geology"], ["rock", "volcano", "plate", "mineral"]),
  s("astronomy", "Astronomy", "science", [], ["planet", "star", "galaxy", "orbit", "universe"]),
  s("general-science", "Science", "science", ["science"], []),
  s("urdu", "Urdu", "languages", [], [], ["PK", "IN"]), s("arabic", "Arabic", "languages", [], [], ARAB), s("french", "French", "languages"), s("spanish", "Spanish", "languages"),
  s("german", "German", "languages"), s("hindi", "Hindi", "languages", [], [], ["IN"]), s("chinese", "Chinese (Mandarin)", "languages", ["mandarin"]),
  s("islamic-studies", "Islamic Studies", "humanities", ["islamiat"], [], ["PK", "BD", "MY", "ID", ...ARAB]), s("pakistan-studies", "Pakistan Studies", "social", [], [], ["PK"]),
  s("sindhi", "Sindhi", "languages", [], [], ["PK"]), s("bengali", "Bengali", "languages", ["bangla"], [], ["BD", "IN"]), s("malay", "Bahasa Melayu", "languages", ["malay"], [], ["MY", "SG", "BN"]),
  s("irish", "Irish (Gaeilge)", "languages", ["gaeilge"], [], ["IE"]), s("welsh", "Welsh", "languages", [], [], ["GB"]), s("us-history", "US History", "humanities", ["american history"], [], ["US"]),
  s("civics", "Civics / Government", "social", [], [], ["US", "IN", "CA"]), s("afrikaans", "Afrikaans", "languages", [], [], ["ZA"]), s("swahili", "Kiswahili", "languages", ["swahili"], [], ["KE", "TZ", "UG"]),
  s("religious-studies", "Religious Studies", "humanities"),
  s("art", "Art & Design", "arts", ["art"]), s("music", "Music", "arts"), s("design-technology", "Design & Technology", "engineering", ["dt"]),
  s("physical-education", "Physical Education", "social", ["pe", "sport"]),
];

/**
 * Subjects, ordered for where the student studies (owner's spec, 2026-09-30: location surfaces the
 * relevant options). Subjects studied everywhere keep their order; the country's own subjects
 * (Urdu and Pakistan Studies in Pakistan, Hindi in India) join them near the top; another
 * country's local subjects move to the end — still searchable, never offered first. With no
 * country, everything in catalogue order.
 */
export function subjectOptions(country?: string | null): EduOption[] {
  const plain = ({ id, label }: SubjectDef): EduOption => ({ id, label });
  const c = (country ?? "").toUpperCase();
  if (!c) return SUBJECTS.map(plain);
  const everywhere = SUBJECTS.filter((x) => !x.countries);
  const local = SUBJECTS.filter((x) => x.countries?.includes(c));
  const elsewhere = SUBJECTS.filter((x) => x.countries && !x.countries.includes(c));
  return [...everywhere.slice(0, 6), ...local, ...everywhere.slice(6), ...elsewhere].map(plain);
}

export function subjectGroup(subject: EduOption): SubjectGroup | null {
  const known = SUBJECTS.find((x) => x.id === subject.id || x.label.toLowerCase() === subject.label.toLowerCase());
  if (known) return known.group;
  const t = subject.label.toLowerCase();
  if (/medic|mbbs|anatom|physiol|pharma|patho|nurs|dent|clinical|surg/.test(t)) return "medicine";
  if (/math|calcul|algebra|statist/.test(t)) return "math";
  if (/physic|chemi|biolog|science/.test(t)) return "science";
  if (/comput|program|software|data|ai\b|machine learning|coding/.test(t)) return "computing";
  if (/engineer/.test(t)) return "engineering";
  if (/business|econom|account|financ|market|manage/.test(t)) return "business";
  if (/law|legal/.test(t)) return "law";
  return null;
}

/** The subject a lesson topic belongs to, among the student's own subjects. Null when unclear. */
export function subjectForTopic(topic: string, subjects: EduOption[]): EduOption | null {
  const t = ` ${topic.toLowerCase()} `;
  let best: { subject: EduOption; score: number } | null = null;
  for (const subject of subjects) {
    const def = SUBJECTS.find((x) => x.id === subject.id || x.label.toLowerCase() === subject.label.toLowerCase());
    const words = [subject.label.toLowerCase(), ...(def?.aliases ?? []), ...(def?.keywords ?? [])];
    // A keyword counts only at the start of a word: "evolution" is not in "the French Revolution".
    const score = words.filter((w) => w && (w.length <= 3 ? t.includes(` ${w} `) : new RegExp(`(?:^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t))).length;
    if (score > 0 && (!best || score > best.score)) best = { subject, score };
  }
  return best?.subject ?? null;
}

/* ------------------------------------------------------------------ curricula, exams, tracks */

type CurriculumDef = EduOption & {
  /** Countries where it is local; "*" = taken internationally. Local ones rank first. */
  countries: string[] | "*";
  bands: LevelBand[];
  /** Only relevant to these subject groups (USMLE: medicine). Absent = any subject. */
  groups?: SubjectGroup[];
  /**
   * …or to these particular subjects (subject ids), for exams a whole group would over-reach on:
   * UCAT/MDCAT for a Biology student, never for one who only takes Physics.
   */
  subjects?: string[];
};

const cur = (id: string, label: string, countries: string[] | "*", bands: LevelBand[], groups?: SubjectGroup[], subjects?: string[]): CurriculumDef => ({ id, label, countries, bands, groups, subjects });
const SCHOOL: LevelBand[] = ["primary", "middle", "secondary", "senior"];

export const CURRICULA: CurriculumDef[] = [
  // United Kingdom
  cur("gcse", "GCSE", ["GB"], ["middle", "secondary"]),
  cur("a-level", "A-Level", ["GB"], ["senior"]),
  cur("btec", "BTEC", ["GB"], ["secondary", "senior"]),
  cur("scottish-highers", "Scottish Highers / Advanced Highers", ["GB"], ["senior"]),
  cur("ucat", "UCAT (medicine admissions)", ["GB", "AU", "NZ"], ["senior"], ["medicine"], ["biology", "chemistry"]),
  cur("plab", "PLAB", ["GB"], ["postgrad", "professional"], ["medicine"]),
  cur("uk-ks", "National Curriculum (Key Stages 1–3)", ["GB"], ["primary", "middle"]),
  // Cambridge / international
  cur("igcse", "Cambridge IGCSE", "*", ["middle", "secondary"]),
  cur("o-level", "Cambridge O-Level", ["PK", "BD", "LK", ...GULF, "MU", "SG"], ["middle", "secondary"]),
  cur("cambridge-a-level", "Cambridge International AS & A Level", "*", ["senior"]),
  cur("ib-pyp", "IB Primary Years (PYP)", "*", ["primary"]),
  cur("ib-myp", "IB Middle Years (MYP)", "*", ["middle", "secondary"]),
  cur("ib-dp", "IB Diploma (IBDP)", "*", ["senior"]),
  cur("sat", "SAT", "*", ["secondary", "senior"]),
  cur("act", "ACT", ["US"], ["senior"]),
  cur("ielts", "IELTS", "*", ["secondary", "senior", "undergrad", "postgrad", "professional"], ["languages"]),
  cur("toefl", "TOEFL", "*", ["senior", "undergrad", "postgrad"], ["languages"]),
  // United States
  cur("ap", "AP (Advanced Placement)", ["US", "CA", ...GULF], ["senior"]),
  cur("common-core", "Common Core / state standards", ["US"], ["primary", "middle", "senior"]),
  cur("psat", "PSAT / NMSQT", ["US"], ["secondary", "senior"]),
  cur("gre", "GRE", "*", ["undergrad", "postgrad"]),
  cur("gmat", "GMAT", "*", ["undergrad", "postgrad", "professional"], ["business"]),
  cur("mcat", "MCAT", ["US", "CA"], ["undergrad"], ["medicine"], ["biology", "chemistry"]),
  cur("usmle", "USMLE", "*", ["undergrad", "postgrad", "professional"], ["medicine"]),
  cur("nclex", "NCLEX", ["US", "CA"], ["undergrad", "professional"], ["medicine"]),
  cur("lsat", "LSAT", ["US", "CA"], ["undergrad"], ["law"]),
  cur("bar-exam", "Bar exam", "*", ["postgrad", "professional"], ["law"]),
  cur("cpa", "CPA", ["US", "CA", "AU"], ["professional", "postgrad"], ["business"]),
  cur("cfa", "CFA", "*", ["undergrad", "postgrad", "professional"], ["business"]),
  cur("acca", "ACCA", "*", ["undergrad", "professional"], ["business"]),
  cur("cima", "CIMA", "*", ["professional"], ["business"]),
  // Pakistan
  cur("pk-matric", "Matric (SSC) — Board exams", ["PK"], ["middle", "secondary"]),
  cur("pk-fsc", "FSc / HSSC (Intermediate)", ["PK"], ["senior"]),
  cur("pk-fsc-premed", "FSc Pre-Medical", ["PK"], ["senior"], ["medicine"], ["biology"]),
  cur("pk-fsc-preeng", "FSc Pre-Engineering", ["PK"], ["senior"], ["math", "engineering"], ["physics", "chemistry"]),
  cur("pk-ics", "ICS (Computer Science)", ["PK"], ["senior"], ["computing", "math"]),
  cur("mdcat", "MDCAT", ["PK"], ["senior"], ["medicine"], ["biology"]),
  cur("ecat", "ECAT", ["PK"], ["senior"], ["math", "engineering"], ["physics", "chemistry"]),
  cur("nts-nat", "NTS NAT", ["PK"], ["senior"]),
  cur("css", "CSS (Central Superior Services)", ["PK"], ["undergrad", "postgrad", "professional"]),
  cur("fcps", "FCPS", ["PK"], ["postgrad", "professional"], ["medicine"]),
  // India
  cur("cbse", "CBSE", ["IN"], SCHOOL),
  cur("icse", "ICSE / ISC", ["IN"], SCHOOL),
  cur("state-board-in", "State Board", ["IN"], SCHOOL),
  cur("jee", "JEE Main / Advanced", ["IN"], ["senior"], ["math", "engineering"], ["physics", "chemistry"]),
  cur("neet", "NEET", ["IN"], ["senior"], ["medicine"], ["biology"]),
  cur("cuet", "CUET", ["IN"], ["senior"]),
  cur("gate", "GATE", ["IN"], ["undergrad", "postgrad"], ["engineering", "computing", "science", "math"]),
  cur("upsc", "UPSC Civil Services", ["IN"], ["undergrad", "postgrad", "professional"]),
  cur("cat-in", "CAT (MBA entrance)", ["IN"], ["undergrad", "professional"], ["business", "math"]),
  // Elsewhere
  cur("au-hsc", "HSC (NSW)", ["AU"], ["senior"]), cur("au-vce", "VCE (Victoria)", ["AU"], ["senior"]), cur("au-qce", "QCE (Queensland)", ["AU"], ["senior"]),
  cur("atar", "ATAR", ["AU"], ["senior"]),
  cur("ncea", "NCEA", ["NZ"], ["secondary", "senior"]),
  cur("ossd", "Ontario Secondary School Diploma (OSSD)", ["CA"], ["senior"]),
  cur("ie-leaving", "Leaving Certificate", ["IE"], ["senior"]), cur("ie-junior", "Junior Cycle", ["IE"], ["middle", "secondary"]),
  cur("waec", "WAEC / WASSCE", ["NG", "GH", "SL", "LR", "GM"], ["secondary", "senior"]),
  cur("jamb", "JAMB UTME", ["NG"], ["senior"]),
  cur("kcse", "KCSE", ["KE"], ["secondary", "senior"]),
  cur("za-nsc", "National Senior Certificate (Matric)", ["ZA"], ["senior"]),
  cur("my-spm", "SPM", ["MY"], ["secondary"]), cur("my-stpm", "STPM", ["MY"], ["senior"]),
  cur("sg-gce", "Singapore-Cambridge GCE O / A Level", ["SG"], ["secondary", "senior"]),
  cur("gaokao", "Gaokao", ["CN"], ["senior"]),
  cur("abitur", "Abitur", ["DE"], ["senior"]),
  cur("fr-bac", "Baccalauréat", ["FR"], ["senior"]),
  cur("es-bach", "Bachillerato / PAU (EBAU)", ["ES"], ["senior"]),
  cur("it-maturita", "Esame di Maturità", ["IT"], ["senior"]),
  cur("br-enem", "ENEM", ["BR"], ["senior"]),
  cur("eg-thanaweya", "Thanaweya Amma", ["EG"], ["senior"]),
  cur("tawjihi", "Tawjihi", ["JO", "PS"], ["senior"]),
  cur("tr-yks", "YKS", ["TR"], ["senior"]),
  cur("bd-hsc", "SSC / HSC (Bangladesh)", ["BD"], ["secondary", "senior"]),
  cur("uae-moe", "UAE Ministry of Education curriculum", ["AE"], SCHOOL),
  cur("sa-qudurat", "Qudurat / Tahsili", ["SA"], ["senior"]),
  // University and beyond, anywhere
  cur("undergrad-course", "Undergraduate course", "*", ["undergrad"]),
  cur("postgrad-course", "Postgraduate course", "*", ["postgrad"]),
  cur("phd-research", "PhD / research", "*", ["postgrad"]),
  cur("professional-cert", "Professional certification", "*", ["professional"]),
  cur("self-study", "Self-study / personal interest", "*", ["primary", "middle", "secondary", "senior", "undergrad", "postgrad", "professional"]),
  cur("aws-cert", "AWS / cloud certification", "*", ["undergrad", "professional"], ["computing"]),
];

/**
 * Curricula, exams and tracks relevant to this learner, most relevant first: local to their country
 * before international, matching their level band, and — where an exam belongs to a field — only
 * when one of their subjects is in it. With no level chosen yet, every band counts.
 */
export function curriculaFor(ctx: { country?: string | null; level?: EduOption | null; subjects?: EduOption[] }): EduOption[] {
  const country = (ctx.country ?? "").toUpperCase();
  const band = levelBand(ctx.level ?? null);
  const groups = new Set((ctx.subjects ?? []).map(subjectGroup).filter((g): g is SubjectGroup => Boolean(g)));
  const subjectIds = new Set((ctx.subjects ?? []).flatMap((s) => {
    const known = SUBJECTS.find((x) => x.id === s.id || x.label.toLowerCase() === s.label.toLowerCase());
    return known ? [known.id] : [];
  }));
  const scored = CURRICULA.map((c) => {
    const local = c.countries !== "*" && c.countries.includes(country);
    const international = c.countries === "*";
    if (!local && !international) return null;
    if (band && !c.bands.includes(band)) return null;
    const scoped = Boolean(c.groups || c.subjects);
    if (scoped && !c.groups?.some((g) => groups.has(g)) && !c.subjects?.some((id) => subjectIds.has(id))) return null;
    const generic = ["self-study", "undergrad-course", "postgrad-course", "phd-research", "professional-cert"].includes(c.id);
    // The country's own curricula lead; a subject's exams and tracks follow them; the catch-alls last.
    const score = (local ? 100 : 0) - (scoped ? 10 : 0) - (generic ? 50 : 0);
    return { option: { id: c.id, label: c.label }, score };
  }).filter((x): x is { option: EduOption; score: number } => Boolean(x));
  return scored.sort((a, b) => b.score - a.score).map((x) => x.option);
}

export function allCurricula(): EduOption[] {
  return CURRICULA.map(({ id, label }) => ({ id, label }));
}

/* ------------------------------------------------------------------ search */

/** Options matching a query (every word must appear), best first: label start, word start, anywhere. */
export function searchOptions<T extends EduOption>(options: T[], query: string, limit = 20): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, limit);
  const words = q.split(/\s+/);
  const hay = (o: T) => {
    const def = SUBJECTS.find((x) => x.id === o.id);
    return [o.label.toLowerCase(), ...(def?.aliases ?? [])].join(" | ");
  };
  return options
    .map((o) => {
      const h = hay(o);
      if (!words.every((w) => h.includes(w))) return null;
      const label = o.label.toLowerCase();
      const rank = label.startsWith(q) ? 0 : new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(h) ? 1 : 2;
      return { o, rank };
    })
    .filter((x): x is { o: T; rank: number } => Boolean(x))
    .sort((a, b) => a.rank - b.rank || a.o.label.length - b.o.label.length)
    .slice(0, limit)
    .map((x) => x.o);
}

/** A user-typed option: id derived from the text, flagged custom. */
export function customOption(label: string): EduOption {
  const clean = label.trim().replace(/\s+/g, " ").slice(0, 80);
  return { id: `custom:${clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`, label: clean, custom: true };
}

/** Sanitise options arriving from a client: known shape, trimmed, deduplicated, capped. */
export function sanitizeOptions(raw: unknown, max: number): EduOption[] {
  if (!Array.isArray(raw)) return [];
  const out: EduOption[] = [];
  for (const item of raw) {
    const o = item as Partial<EduOption> | null;
    if (!o || typeof o.label !== "string" || !o.label.trim()) continue;
    const label = o.label.trim().replace(/\s+/g, " ").slice(0, 80);
    const id = typeof o.id === "string" && /^[a-z0-9:_-]{1,90}$/i.test(o.id) ? o.id : customOption(label).id;
    if (out.some((x) => x.id === id || x.label.toLowerCase() === label.toLowerCase())) continue;
    out.push({ id, label, ...(o.custom || id.startsWith("custom:") ? { custom: true } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

export function sanitizeOption(raw: unknown): EduOption | null {
  return sanitizeOptions(raw ? [raw] : [], 1)[0] ?? null;
}

const COUNTRY_ALIASES: Record<string, string> = {
  uk: "GB", "u.k.": "GB", britain: "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB",
  usa: "US", "u.s.": "US", "u.s.a.": "US", america: "US", "united states of america": "US", us: "US",
  uae: "AE", emirates: "AE", ksa: "SA", "saudi": "SA", "south korea": "KR", korea: "KR", "north korea": "KP", russia: "RU",
  holland: "NL", "czech republic": "CZ", turkey: "TR", "ivory coast": "CI", vietnam: "VN", iran: "IR", syria: "SY", laos: "LA",
};

/**
 * A country the student TYPED, matched to its code: the code itself ("PK"), its name in any case,
 * or a common short name ("UK", "USA", "UAE"). Null when it is not recognisably a country — the
 * picker then says so rather than dropping the entry without a word.
 */
export function matchCountry(text: string | null | undefined): string | null {
  const t = (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  if (COUNTRY_ALIASES[t]) return COUNTRY_ALIASES[t];
  if (/^[a-z]{2}$/.test(t) && COUNTRY_CODES.includes(t.toUpperCase())) return t.toUpperCase();
  const exact = COUNTRY_CODES.find((code) => countryName(code).toLowerCase() === t);
  if (exact) return exact;
  const starts = COUNTRY_CODES.filter((code) => countryName(code).toLowerCase().startsWith(t));
  return t.length >= 4 && starts.length === 1 ? starts[0] : null;
}

export function sanitizeCountry(raw: unknown): string | null {
  return typeof raw === "string" && COUNTRY_CODES.includes(raw.toUpperCase()) ? raw.toUpperCase() : null;
}

/** Country from a browser language tag ("en-GB" → GB), the fallback when IP lookup is unavailable. */
export function countryFromLanguage(acceptLanguage: string | null | undefined): string | null {
  for (const part of (acceptLanguage ?? "").split(",")) {
    const region = /^[a-z]{2,3}-([A-Za-z]{2})\b/.exec(part.trim())?.[1]?.toUpperCase();
    if (region && COUNTRY_CODES.includes(region)) return region;
  }
  return null;
}

