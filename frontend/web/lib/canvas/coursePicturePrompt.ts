import { createHash } from "node:crypto";
import type { SuprnotesLessonInput } from "../suprnotes";
import { partNameKey } from "./labelPolicy";
import { sameLine } from "./equationCheck";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";

/**
 * A COURSE LESSON'S PICTURE, DRAWN WITH ITS LABELS FROM THE BOARD'S OWN CONTEXT (owner, 2026-10-24: the
 * picture must be "the exact diagram that is needed, not some other part of it", and Aria must know what
 * is in it). gpt-image-2 draws the picture and its labels (lib/canvas/coursePicture.ts); this file is the
 * pure part — what the board is, what the picture must show, the subject's rules and the JSON prompt.
 *
 * The board's context is everything the board already knows: the course and lesson, the syllabus block
 * it teaches (objective, key points, level, what is out of scope) and every sentence Aria says on it. A
 * planner turns that into the picture's fields — its scope (the whole thing, or a close-up when she
 * explains one part), view, parts, facts that must be true and at most six labels in her own words — so
 * the picture is the board's, not the topic's.
 *
 * Subject rules come from the researched prompts (ai-tutor/reports/Science diagram image prompts.md;
 * scripts/pictures/science-diagram-prompts.json, approved by the owner).
 *
 * EVERY VISUAL OF A COURSE LESSON IS DRAWN BY gpt-image-2 (owner, 2026-10-24: "I'm not allowing any code
 * diagrams … relying on gpt-image-2 for everything; it should be sent a complete board context so it knows
 * what to generate"). Graphs, circuits, formulas, flowcharts and maths figures are exact diagrams the image
 * model draws under the exact-diagram rules, with every value it must write listed; the board's whole
 * context goes in — its heading, everything written on it, every sentence Aria says, its syllabus block.
 */

/* ── the subject families: what the image model draws, what code draws, the rules ─────────────── */

/**
 * Every course subject family the owner approved (2026-10-24), from the research in
 * ai-tutor/reports/Science diagram image prompts.md and ai-tutor/research_notes/Diagram prompts all
 * course subjects/, plus maths and computer science (2026-10-24: every course visual is generated).
 * `labels`: "model" — gpt-image-2 writes the labels in the picture; "code" — the picture has no writing
 * at all and Aria's board writes the labels (languages: words in any script are never generated).
 */
type Family = {
  name: string;
  imageTypes: string[];
  /**
   * EXACT DIAGRAMS — once drawn by code, now drawn by gpt-image-2 too (owner, 2026-10-24: "I'm not allowing
   * any code diagrams … relying on gpt-image-2 for everything"), held to the exact-diagram rules: ruled
   * lines, the curriculum's symbols, every value and word exactly as the board gives it.
   */
  exactTypes: string[];
  /** Never drawn by the image model, for accuracy, respect or rights (real maps, portraits, sacred text …). */
  neverDraw: string[];
  rules: string[];
  style: string;
  frame: string;
  labels: "model" | "code";
  never: string[];
  /** Plain arrows the picture may draw (movement, flow); otherwise none. */
  arrows?: string;
};

const CORE_NEVER = [
  "Never depict a prophet, a sacred figure, an angel or a deity — not even as a silhouette, a veiled face or a light — and never write sacred or scriptural text or calligraphy.",
  "No portrait or likeness of a real person, no fake historical photograph, no real brand name or logo, no map or border of a real place, no flag.",
  "No copyrighted character and no copy of a real artwork.",
  "No stereotype props or costumes and no poverty framing unless the board is about it.",
];

export const FAMILIES = {
  biology: {
    name: "biology",
    imageTypes: ["organ", "organ system", "tissue section", "cell", "organelle", "plant section", "flower", "micrograph-style view", "experiment set-up"],
    exactTypes: ["graphs", "Punnett squares and genetic crosses", "pedigree charts", "food chains and webs", "pyramids of number, biomass and energy", "nutrient cycles (carbon, nitrogen, water)", "flow charts", "dichotomous keys", "DNA base pairing", "chromosome sets and the stages of cell division"],
    neverDraw: [],
    rules: [
      "Draw it the way a standard school textbook does: the conventional view named above, never mirrored.",
      "Bodies and organs are shown as if the organism faces the viewer: its right side is on the viewer's left.",
      "Draw only the parts listed, each once, with real proportions, positions and connections; neighbouring tissues in clearly different tones.",
      "Show only structures the real cell, tissue or organ has at the stage shown — never add a nucleus, valve, layer, chamber or organelle it does not have.",
      "Membranes are continuous single lines; plant cell walls are double lines.",
      "Oxygenated blood is red and deoxygenated blood is blue, only in diagrams of circulation; photosynthetic plant tissue is green.",
    ],
    style: "Flat 2D textbook illustration: clean, even dark outlines; flat colour fills; no gradients, shadows, photographic texture or 3D rendering.",
    frame: "60%",
    labels: "model",
    never: ["No reproductive anatomy is drawn by the image model.", "No nudity."],
  },
  chemistry: {
    name: "chemistry",
    imageTypes: ["laboratory apparatus set-up", "electrolytic cell", "industrial plant cut-away", "everyday context scene"],
    exactTypes: ["dot-and-cross and Lewis diagrams", "electron shell diagrams", "displayed and skeletal formulas", "ball-and-stick and space-filling molecule models", "particle diagrams (states, elements, compounds, mixtures)", "giant lattices", "energy profile diagrams", "graphs", "part of the periodic table"],
    neverDraw: [],
    rules: [
      "Apparatus is a 2D side-on cross-section like an exam-paper diagram: uniform black outlines, glass walls as two thin parallel lines, no perspective, shading or reflections.",
      "Draw only the apparatus listed, left to right in the order listed; every joint meets with no gap; tubes and wires connect to what they should.",
      "A heated vessel or one collecting gas always has an open outlet — never a sealed system being heated.",
      "Heat comes from a Bunsen burner flame under the vessel whenever the method heats it or a substance is molten.",
      "Liquids are a pale blue fill with a flat horizontal surface; electrodes dip into the electrolyte and are wired to the power supply.",
      "Condenser cooling water goes in at the bottom and out at the top; a distillation thermometer bulb sits level with the side arm.",
      "Any atoms shown use standard (CPK) colours: carbon black, hydrogen white, oxygen red, nitrogen blue, chlorine green, sulfur yellow.",
    ],
    style: "Clean exam-style line drawing in black on white, with pale tinted liquids; industrial cut-aways in flat 2D colour with clean dark outlines; no photographic texture or 3D rendering.",
    frame: "65%",
    labels: "model",
    never: ["No chemical formula, equation, charge sign or number except those listed, each written exactly as listed."],
  },
  physics: {
    name: "physics",
    imageTypes: ["device cross-section (motor, generator, transformer, relay, loudspeaker)", "apparatus set-up", "astronomy scene", "real-world context scene"],
    exactTypes: ["circuit diagrams", "ray diagrams", "free-body and force diagrams", "magnetic and electric field lines", "waves and wavefronts", "graphs", "Sankey diagrams and energy bar charts", "moments diagrams"],
    neverDraw: [],
    rules: [
      "Draw it the way a standard school textbook does: real proportions and connections; only the parts listed, clearly separated.",
      "Devices are clean line drawings in cross-section or simple schematic view, never photographs.",
      "Context scenes show objects and people from the outside, on a plain background, with no cut-aways.",
      "Field lines, current arrows and force arrows only where the board describes them, each pointing the way the board says, force arrows drawn to scale with each other.",
      "Correctness never depends on colour.",
    ],
    style: "Clean textbook line drawing: even dark outlines on white, optional flat colour, no gradients, shadows or 3D rendering.",
    frame: "60%",
    labels: "model",
    never: [],
  },
  earth: {
    name: "earth and environmental science",
    imageTypes: ["landform block diagram or cross-section", "volcano, river, coast or glacier cut-away", "plate-boundary cut-away", "rock-cycle scene", "soil profile", "rainforest or ecosystem layers", "before-and-after management scene"],
    exactTypes: ["climate graphs and hydrographs", "population pyramids", "named models (demographic transition, Burgess, Hoyt)", "sketch maps and contour sketches of a generic place, with no real borders or place names"],
    neverDraw: ["maps of real places (real coastlines, borders or place names)"],
    rules: [
      "A textbook block diagram or cross-section: the ground surface as a clear line, rock layers as distinct bands in earth tones, the oldest at the bottom unless the board says the layers were disturbed.",
      "Show the key relationship exactly as the board states it — which bank erodes and which deposits, which plate sinks, which side lies in the rain shadow — never reversed.",
      "Generic landforms, not a real named place; the real name stays in the teacher's words, not the picture.",
      "Correct order and relative size of layers, horizons and features.",
    ],
    style: "Flat 2D textbook illustration: earth tones for rock and soil, blue for water, red and orange for magma, green for vegetation; clean dark outlines; no photographic texture.",
    frame: "62%",
    labels: "model",
    arrows: "Simple broad arrows for the movement of water, magma, ice, air or plates, only where the board describes that movement, with no words on them.",
    never: [],
  },
  geography: {
    name: "human geography and tourism",
    imageTypes: ["settlement or land-use scene", "urban or rural scene", "farming, industry or transport scene", "tourism destination scene", "before-and-after development scene"],
    exactTypes: ["graphs and charts", "population pyramids", "models (Burgess, Hoyt, von Thünen, Butler)", "sketch maps of a generic place, with no real borders or place names"],
    neverDraw: ["maps of real places (real coastlines, borders or place names)"],
    rules: [
      "A plausible, modern, everyday scene of the kind the board describes; buildings, vehicles and land use fit the region the board names.",
      "Generic places, not a real landmark presented as somewhere else.",
      "People of varied ages and backgrounds doing everyday things, without stereotype props or costumes.",
    ],
    style: "Flat 2D textbook illustration in natural colours, clean outlines, plain sky; no photographic texture.",
    frame: "70%",
    labels: "model",
    never: [],
  },
  history: {
    name: "history",
    imageTypes: ["period reconstruction of everyday life, work or an event", "building or architecture of the period", "artefact, tool or weapon", "clothing of the period", "transport or technology of the period"],
    exactTypes: ["timelines", "statistics charts"],
    neverDraw: ["maps of empires, battles or borders", "source documents, posters and cartoons", "portraits of real named people", "flags and insignia"],
    rules: [
      "Period-accurate: the clothing, buildings, tools and technology of the place and period the board names; nothing from a later period.",
      "An artist's reconstruction in textbook illustration style and full colour — never a sepia image or a fake old photograph.",
      "People are generic and unnamed, shown respectfully; conflict is shown without gore.",
      "Contested borders and territories are never drawn.",
    ],
    style: "Flat 2D textbook reconstruction illustration in natural colours with clean outlines; no photographic or aged texture.",
    frame: "70%",
    labels: "model",
    never: ["No inscriptions, banners or writing of the period.", "No real historical person's face or likeness.", "No depiction of the victims of an atrocity."],
  },
  economics: {
    name: "economics, business and finance",
    imageTypes: ["market or shop scene", "factory or production scene", "office or workplace scene", "bank or trade scene", "household scene"],
    exactTypes: ["economics graphs (supply and demand, PPF, cost and revenue curves, AD/AS)", "the circular flow", "accounts and financial statements", "break-even charts", "organisation charts", "business matrices and decision trees"],
    neverDraw: [],
    rules: [
      "A context scene that sets up the idea the board teaches, with generic businesses and products.",
      "People of varied ages, genders and backgrounds in their roles, without job stereotypes.",
    ],
    style: "Flat 2D textbook illustration in natural colours with clean outlines; plain background.",
    frame: "70%",
    labels: "model",
    never: ["No number, price or currency symbol except those listed, each written exactly as listed."],
  },
  social: {
    name: "psychology, sociology, law and citizenship",
    imageTypes: ["courtroom, parliament or polling scene", "community or classroom scene", "generic reconstruction of a classic study set-up", "brain (external or sectional view)"],
    exactTypes: ["models (hierarchy of needs, memory models)", "flow charts and legal processes", "court and government hierarchies", "data charts and statistics"],
    neverDraw: [],
    rules: [
      "Generic, unnamed people — never the original researchers or real participants — of varied ages and backgrounds, without stereotypes.",
      "A study set-up shows the arrangement, never a participant in distress.",
      "Courts and parliaments are generic and match the jurisdiction of the curriculum.",
      "A brain is drawn in the standard textbook view with its regions in the correct places.",
    ],
    style: "Flat 2D textbook illustration in natural colours with clean outlines; plain background.",
    frame: "68%",
    labels: "model",
    never: [],
  },
  languages: {
    name: "languages and literature",
    imageTypes: ["one object or action (vocabulary)", "everyday scene to describe", "setting or mood of a story", "everyday life in a place where the language is spoken"],
    exactTypes: [],
    neverDraw: ["every word, letter or character in any language or script (the board writes them)", "grammar and verb tables", "phonics", "book text and quotations"],
    rules: [
      "No writing of any kind, in any language or script: the teacher writes every word.",
      "Name the place and the activity, not a nationality: modern everyday life, without stereotype props or costumes.",
      "Characters from modern copyrighted books and films are not drawn: show the setting or mood instead.",
      "For a vocabulary picture, one clear subject on a plain background.",
    ],
    style: "Flat 2D illustration in natural colours with clean outlines; plain background.",
    frame: "66%",
    labels: "code",
    never: [],
  },
  arts: {
    name: "arts, music, drama, dance and media",
    imageTypes: ["musical instrument", "an art technique shown on a simple object", "stage or costume mood scene", "dance position with plain figures", "media production equipment"],
    exactTypes: ["music notation, staves and chords", "colour wheels", "perspective constructions", "stage plans", "film shot diagrams"],
    neverDraw: ["real artworks (never imitated)"],
    rules: [
      "Instruments have the correct number and arrangement of strings, keys, holes, valves and pegs.",
      "Never imitate a real artwork or a living artist's style.",
      "Figures in dance or drama positions are anatomically plausible, in plain clothing.",
    ],
    style: "Clean textbook illustration with even outlines and flat colour; plain background.",
    frame: "62%",
    labels: "model",
    never: [],
  },
  health: {
    name: "PE, health, food and nutrition",
    imageTypes: ["skeleton or muscle figure", "exercise or skill technique", "sports equipment or facility", "food items or food groups", "kitchen equipment or hygiene scene"],
    exactTypes: ["heart-rate and training graphs", "nutrition labels", "food-safety temperature scales"],
    neverDraw: ["the Eatwell Guide, MyPlate and food pyramids (official graphics, never redrawn)"],
    rules: [
      "Skeleton and muscle figures stand in the anatomical position (facing forward, palms forward) with bones and muscles in their correct places.",
      "Exercise and skill technique is shown safely and correctly.",
      "Bodies of varied shapes, ages and backgrounds; food realistic and culturally varied.",
    ],
    style: "Flat 2D textbook illustration with clean outlines and natural colours; plain background.",
    frame: "62%",
    labels: "model",
    never: ["No reproductive anatomy and no nudity.", "No self-harm, eating-disorder or suicide imagery.", "No unsafe practice."],
  },
  religion: {
    name: "religious studies",
    imageTypes: ["place of worship (outside or inside)", "object of practice", "festival or practice scene"],
    exactTypes: ["timelines"],
    neverDraw: ["all sacred text and calligraphy", "maps"],
    rules: [
      "Places of worship and objects of practice are drawn accurately and respectfully.",
      "Worshippers are generic, shown respectfully, from a distance or from behind.",
    ],
    style: "Flat 2D textbook illustration in natural colours with clean outlines.",
    frame: "66%",
    labels: "model",
    never: [
      "Never depict the Prophet Muhammad or any prophet, the Prophet's family, companions or the Imams, angels, or Allah; never depict the Sikh Gurus or their families; no image of God in any faith. A board about sacred history shows the place, with no people.",
      "No sacred text, verse or calligraphy in any script.",
      "No sacred figure or symbol used as decoration.",
    ],
  },
  technology: {
    name: "design and technology",
    imageTypes: ["tool", "material sample", "simple mechanism (gears, levers, cams, pulleys)", "product or prototype", "workshop scene with safety equipment"],
    exactTypes: ["orthographic, isometric, sectional and exploded technical drawings", "dimensioned drawings", "circuit diagrams", "flowcharts"],
    neverDraw: [],
    rules: [
      "Mechanisms can work: gear teeth mesh, linkages join at pivots, every part is supported.",
      "Tools are used correctly and safely: guards and goggles where needed, no gloves at rotating machines.",
      "Materials look like the real material (grain for wood, sheen for metal, texture for fabric).",
    ],
    style: "Clean textbook line drawing with flat colour and even outlines; plain background.",
    frame: "62%",
    labels: "model",
    never: [],
  },
  maths: {
    name: "mathematics",
    imageTypes: ["everyday context scene for a word problem", "real object or 3-D solid", "measuring instrument (ruler, protractor, scale, clock)"],
    exactTypes: ["graph of a function or of data (axes, lines, curves, plotted points)", "number line", "geometry figure (shapes, angles, lengths, constructions, loci, circle theorems)", "3-D solid or net", "transformation on a coordinate grid", "statistical chart (bar chart, pie chart, histogram, scatter graph, box plot, stem-and-leaf)", "probability tree or Venn diagram", "place-value chart, base-ten blocks, ten-frame, hundred square, fraction bar or array", "table of values"],
    neverDraw: [],
    rules: [
      "Every number, letter, angle, length, coordinate and value is exactly as listed: nothing rounded, nothing extra, and no answer the board does not give.",
      "Geometry is drawn accurately to the stated measurements: right angles marked with a small square, equal sides with matching tick marks, parallel lines with matching arrow marks, angles with arcs, vertices named with the capital letters listed.",
      "Graphs: ruled x and y axes with arrowheads, the origin marked 0, scale values exactly as listed and evenly spaced, the axis names listed, every line or curve passing exactly through the listed points.",
      "Counts are exact: the number of blocks, dots, squares, sections, branches, bars or objects equals the listed number.",
      "Probability trees run left to right, each branch carrying its probability as listed and each end its outcome.",
      "Charts are exactly proportional to the listed values.",
    ],
    style: "Clean textbook maths figure: thin even dark lines on white, flat fills in a few soft colours to tell parts apart, no shading and no decoration.",
    frame: "75%",
    labels: "model",
    never: ["No decorative characters, mascots or clip-art.", "No working, formula or answer in the picture unless it is listed."],
  },
  computing: {
    name: "computer science",
    imageTypes: ["computer hardware or a system (CPU, memory, storage, input and output devices)", "network scene", "real-world computing scene"],
    exactTypes: ["flowchart", "data structure (array, stack, queue, linked list, tree, graph, hash table)", "logic gate circuit", "network topology or layered protocol model", "memory, binary or file layout as boxes", "algorithm trace as rows of boxes (sorting or searching passes)", "user interface wireframe"],
    neverDraw: [],
    rules: [
      "Flowcharts use the standard symbols: a rounded terminal, a rectangle for a process, a diamond for a decision with Yes and No on its two exits, a parallelogram for input or output; arrows show the flow, top to bottom.",
      "Logic gates use the curriculum's standard distinctive-shape symbols (AND, OR, NOT, NAND, NOR, XOR), inputs on the left and the output on the right, each named as listed.",
      "Data structures are neat boxes and arrows: every value, index and pointer exactly as listed and in the listed order; tree nodes in their listed places (left child, right child).",
      "Identifiers, keywords and values are spelt exactly as listed, in a monospaced font.",
      "Counts are exact.",
    ],
    style: "Clean textbook computing diagram: thin even dark lines, flat pastel fills, rounded boxes, no 3-D and no decoration.",
    frame: "75%",
    labels: "model",
    never: ["No real brand logos or product names.", "No code or text other than what is listed."],
  },
} satisfies Record<string, Family>;

/** The family a course's subject usually draws in (a combined-science course leaves it to the board). */
export function familyOfCourse(subject: string): PictureFamily | undefined {
  const s = subject.toLowerCase();
  const table: Array<[RegExp, PictureFamily]> = [
    [/\b(math|maths|mathematics|statistics|further pure|mechanics|algebra|geometry|calculus|numeracy)\b/, "maths"],
    [/\b(computer|computing|ict|information technology|programming|digital technolog)/, "computing"],
    [/\bbiolog|\blife science|\bhuman biology/, "biology"],
    [/\bchemi/, "chemistry"],
    [/\bphysics\b/, "physics"],
    [/\b(earth|environment|geolog|marine science)/, "earth"],
    [/\b(geograph|tourism|travel)/, "geography"],
    [/\b(histor|pakistan studies|social studies|civics)/, "history"],
    [/\b(econom|business|accounting|commerce|finance)/, "economics"],
    [/\b(psycholog|sociolog|law|citizenship|government|politic)/, "social"],
    [/\b(english|literature|language|french|spanish|german|urdu|arabic|chinese|mandarin|hindi|latin|italian|japanese)/, "languages"],
    [/\b(art|music|drama|dance|media|film|photograph)/, "arts"],
    [/\b(physical education|\bpe\b|sport|health|food|nutrition|rshe|pshe|home econom)/, "health"],
    [/\b(religio|islamiyat|islamic|divinity|theolog)/, "religion"],
    [/\b(design|technolog|engineering|electronics)/, "technology"],
  ];
  return table.find(([re]) => re.test(s))?.[1];
}

export type PictureFamily = keyof typeof FAMILIES;
export const PICTURE_FAMILIES = Object.keys(FAMILIES) as PictureFamily[];

export type Curriculum = { name: string; spelling: string; namesAndUnits: string; symbols: string; conventions: string };

const CURRICULA: Record<string, Curriculum> = {
  international: { name: "international", spelling: "British English", namesAndUnits: "IUPAC names (aluminium, caesium, sulfur); SI units", symbols: "IEC circuit symbols", conventions: "Follow international (IUPAC, SI, IEC) conventions." },
  cambridge: { name: "Cambridge", spelling: "British English (haemoglobin, oesophagus, fibre, centre, metre) but 'fetus'", namesAndUnits: "aluminium, caesium, sulfur; cm3, dm3, mol/dm3", symbols: "IEC (Cambridge symbol table)", conventions: "Follow Cambridge International conventions." },
  uk: { name: "UK GCSE / A Level", spelling: "British English (haemoglobin, oesophagus, fibre, centre, metre)", namesAndUnits: "aluminium, caesium, sulfur; cm3, dm3", symbols: "IEC circuit symbols", conventions: "Follow UK exam-board conventions." },
  us: { name: "US", spelling: "American English (hemoglobin, esophagus, fiber, center, meter)", namesAndUnits: "aluminum, cesium, sulfur; mL, L, M", symbols: "IEEE 315 circuit symbols", conventions: "Follow US high-school, NGSS and AP conventions." },
  pakistan: { name: "Pakistan", spelling: "British English", namesAndUnits: "aluminium, caesium, sulfur; SI units", symbols: "IEC circuit symbols", conventions: "Follow the conventions of Pakistan's national and FBISE textbooks (British English, SI)." },
  australia: { name: "Australia", spelling: "Australian English (British spelling)", namesAndUnits: "aluminium, caesium, sulfur; SI units", symbols: "IEC circuit symbols", conventions: "Follow the Australian Curriculum (v9) conventions." },
  ib: { name: "IB", spelling: "British English", namesAndUnits: "aluminium, caesium, sulfur; SI units", symbols: "IEC circuit symbols", conventions: "Follow International Baccalaureate conventions." },
};

/**
 * WHERE THE STUDENT IS decides dress, food, faith and people in a picture (research, 2026-10-24): a
 * Pakistani student's scene is modestly dressed with no pork, pig or alcohol; an Australian course never
 * generates Aboriginal or Torres Strait Islander people.
 */
const LOCALE_RULES: Record<string, string[]> = {
  Pakistan: ["People are modestly dressed (for example shalwar kameez, with a dupatta for women).", "No pigs, pork or alcohol anywhere in the picture."],
  Australia: ["Do not generate Aboriginal or Torres Strait Islander people."],
};

/** The curriculum a course follows, read from its framework's name; international when unknown. */
export function curriculumOf(framework: string): Curriculum {
  const f = framework.toLowerCase();
  if (/cambridge|igcse|o level|a level|as level/.test(f) && !/\b(aqa|edexcel|ocr|wjec)\b/.test(f)) return CURRICULA.cambridge;
  if (/\b(aqa|edexcel|ocr|wjec|gcse|national curriculum|key stage|oak)\b/.test(f)) return CURRICULA.uk;
  if (/\b(ap |ngss|common core|ccss|college board|us |u\.s\.|united states|state standards|c3)\b|\bap$/.test(f)) return CURRICULA.us;
  if (/pakistan|fbise|ncp|national curriculum of pakistan|mdcat|ecat|punjab|sindh|kpk/.test(f)) return CURRICULA.pakistan;
  if (/australia|acara|\bv9\b|nsw|victorian|vce|hsc/.test(f)) return CURRICULA.australia;
  if (/\bib\b|international baccalaureate|\bdp\b|\bmyp\b/.test(f)) return CURRICULA.ib;
  return CURRICULA.international;
}

export type CourseBoardContext = {
  course: string;
  lesson: string;
  board: string;
  brief: string;
  /** The family the course's subject draws in, when its name says (a combined-science course leaves it to the board). */
  family?: PictureFamily;
  /** The things the board's plan names (its objects). */
  objects: string[];
  /**
   * What is WRITTEN on the board beside the picture — its heading, its notes (each with the sentence it is
   * written on) and any lines of working — so the picture matches the board and never repeats it as text.
   */
  written: string[];
  /** Every sentence Aria says on this board, in order. */
  sentences: string[];
  /** The syllabus block this board teaches: objective, key points and official wording. */
  syllabus: string;
  /** Level, terms and what is out of scope for the student's level. */
  hints: string[];
  mustShow: string[];
  curriculum: Curriculum;
};

const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []));

/** The board's context, when the lesson is a course lesson (its document is a syllabus lesson). */
export function courseBoardContext(doc: SuprnotesLessonInput | null | undefined, topic: string, beat: CanvasPlanBeat): CourseBoardContext | null {
  const plan = doc?.lessonPlan as { sourceType?: string } | undefined;
  if (!doc || plan?.sourceType !== "curriculum" || !doc.contentBlocks?.length) return null;
  // The syllabus block the board teaches: the one sharing most words with the board's title and brief.
  const mine = words(`${beat.title} ${beat.brief}`);
  const blocks = doc.contentBlocks.filter((b) => !b.exam);
  const block = [...blocks].sort((a, b) => overlap(mine, words(`${b.heading ?? ""} ${(b.keyIdeas ?? []).join(" ")}`)) - overlap(mine, words(`${a.heading ?? ""} ${(a.keyIdeas ?? []).join(" ")}`)))[0] ?? blocks[0];
  const course = [doc.lesson?.subject, doc.lesson?.title].filter(Boolean).join(" — ") || topic;
  const framework = (block?.facts ?? []).map((f) => f.source ?? "").join(" ") || course;
  return {
    course: course.slice(0, 160),
    lesson: topic.slice(0, 160),
    board: beat.title,
    brief: beat.brief,
    family: familyOfCourse(String(doc.lesson?.subject ?? "")),
    // The plan names things by id ("polar-bonds"): the picture is told them in words, or its labels read "polar-bonds".
    objects: (beat.objects ?? []).slice(0, 12).map((o) => o.replace(/[-_]+/g, " ").trim()).filter(Boolean),
    written: [],
    sentences: splitSentences(beat.script),
    syllabus: String(block?.text ?? "").slice(0, 1600),
    hints: (block?.teachingHints ?? []).filter((h) => /^(Level|Use these terms|Do not teach|Visible evidence)/.test(h)).slice(0, 5),
    mustShow: beat.requiredVisual?.mustShow ?? [],
    curriculum: curriculumOf(framework),
  };
}

/** The board's context with what is written on it: heading, notes on their sentences, lines of working. */
export function withBoardWriting(ctx: CourseBoardContext, spec: CanvasBoardSpec): CourseBoardContext {
  const written = [`Heading: ${spec.heading}`, ...spec.notes.map((n) => `Note (sentence ${n.s}): ${n.text}`)];
  if (spec.stage.kind === "equation") {
    const text = new Map(spec.stage.tokens.map((t) => [t.id, t.text]));
    for (const step of spec.stage.steps) written.push(`Working (sentence ${step.s}): ${step.order.map((id) => text.get(id) ?? "").join(" ").replace(/\s+/g, " ").trim()}`);
  }
  return { ...ctx, written: written.slice(0, 24) };
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

function splitSentences(script: string): string[] {
  return (script.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/* ── the planner: the board's picture, from the board ─────────────────────────────────────────── */

export type PictureFields = {
  family: PictureFamily | "other";
  audience: string;
  diagramType: string;
  /** An exact diagram (graph, circuit, formula, flowchart, maths figure …) rather than an illustration. */
  exact: boolean;
  /** Every other piece of text the picture must contain exactly — values, symbols, formulas, axis titles, box text. */
  exactText: string[];
  /** The arrows the picture draws and which way each points; "" for none. */
  arrows: string;
  /** "whole" or a close-up of the one part the narration explains. */
  scope: string;
  view: string;
  parts: Array<{ name: string; where: string; looks: string }>;
  mustBeTrue: string[];
  labels: Array<{ text: string; pointsTo: string; position: string; sentence: number }>;
  setting?: string;
  people?: string;
};

export function fieldsPrompt(ctx: CourseBoardContext): { system: string; user: string } {
  const system = `You plan the ONE picture an image model draws for a lesson board, from the board itself. The picture must be EXACTLY what this board explains — its scope and view follow what Aria says: a close-up of one part when she explains one part, the whole thing when she explains the whole; never a different part of the topic, never more than she talks about.
EVERY visual on this board is drawn by the image model — there is no other way to draw it — so plan the one picture that teaches exactly what the board says, whatever it is: an illustration, or an EXACT diagram (a graph, a formula or molecule diagram, a circuit, a flowchart, a maths figure, a data structure) drawn as a precise textbook figure with every value written exactly.
Families, each with its illustrations, its exact diagrams, and what is never drawn:
${PICTURE_FAMILIES.map((k) => `- "${k}" (${FAMILIES[k].name}): illustrations — ${FAMILIES[k].imageTypes.join("; ")}.${FAMILIES[k].exactTypes.length ? ` Exact diagrams — ${FAMILIES[k].exactTypes.join("; ")}.` : ""}${FAMILIES[k].neverDraw.length ? ` Never drawn — ${FAMILIES[k].neverDraw.join("; ")}.` : ""}`).join("\n")}
${ctx.family ? `This course's family is "${ctx.family}"; choose another only when the board belongs to another discipline (a science course's chemistry board is "chemistry").` : "Choose the family of the board's discipline."}
Return JSON {"family": ${PICTURE_FAMILIES.map((k) => `"${k}"`).join(" | ")}, "audience": string, "setting": string, "people": string, "diagram_type": string, "exact": boolean, "scope": string, "view": string, "parts": [{"name": string, "where": string, "looks": string}], "must_be_true": [string], "labels": [{"text": string, "points_to": string, "position": string, "sentence": number}], "exact_text": [string], "arrows": string}:
- "audience": the student, e.g. "a 15-year-old Cambridge IGCSE student".
- "setting": where the picture is set (place and period) when it shows a scene, else ""; "people": who appears (ages, roles, dress) when people appear, else "none".
- "diagram_type": the picture, named specifically; "exact": true for an exact diagram, false for an illustration; "scope": "the whole <thing>" or "a close-up of <part>", following the narration; "view": the conventional textbook view and its orientation, said outright.
- SIMPLE (owner, 2026-10-24: "don't make diagrams over-complicated"): ONE idea, the fewest parts that teach it — no extra scenery, no side panels, no second diagram or flowchart inside the picture, no arrow or part Aria does not talk about. Every part, arrow and label in it is one she explains on this board.
- "parts": 2 to 6 parts this board's narration and syllabus name — no part the level puts out of scope — each with where it sits in the frame and what it looks like (shape, size relative to neighbours, what it connects to).
- "must_be_true": 3 to 6 positive, visible, scientifically exact facts a correct picture shows (counts, order, thickness, direction, connections). A molten substance is shown being heated.
- "labels": at most 5, each a SHORT name of a part Aria names on this board — 1 to 4 words, at most 28 characters, a noun phrase, never a sentence or an explanation (for languages: the word Aria teaches for it, in the lesson's language) — in her words, as her sentence says them (the pointer goes to a part when she says its label) and the curriculum's spelling (${ctx.curriculum.spelling}; ${ctx.curriculum.namesAndUnits}); "points_to" the part; "position" "left margin" or "right margin" plus "top", "upper", "middle", "lower" or "bottom" matching where the part sits; "sentence" the 0-based sentence that names it. For an exact diagram, "position" is beside what it names ("beside the top vertex", "at the end of the curve", "inside the first box").
- "exact_text": every OTHER piece of text the picture must contain, each exactly as the board writes it — axis titles with units, scale values, plotted values, lengths and angles, symbols, charges, formulas (with their subscripts and superscripts), the words inside boxes, Yes/No on decisions — at most 8, each at most 40 characters; [] for an illustration with only labels. Only what the board says or writes: never an answer the board does not give.
- "arrows": the arrows the picture draws and which way each points (reaction arrows, flow arrows, forces, rays, field directions, movement), or "" for none.
- Draw what is WRITTEN on the board too: the picture shows the board's own example, numbers and names, never a different one.`;
  const user = [
    `Course: ${ctx.course}`,
    `Lesson: ${ctx.lesson}`,
    `Curriculum: ${ctx.curriculum.name}`,
    `Board: ${ctx.board}`,
    `What the board shows: ${ctx.brief}`,
    ctx.objects.length ? `The things the board names: ${ctx.objects.join(", ")}` : "",
    `What Aria says on this board, sentence by sentence:\n${ctx.sentences.map((s, i) => `${i}. ${s}`).join("\n")}`,
    ctx.written.length ? `What is written on the board beside the picture (the picture matches it and does not repeat it as text):\n${ctx.written.join("\n")}` : "",
    ctx.syllabus ? `The syllabus this board teaches:\n${ctx.syllabus}` : "",
    ctx.hints.length ? ctx.hints.join("\n") : "",
    ctx.mustShow.length ? `The syllabus requires the picture to show: ${ctx.mustShow.join("; ")}.` : "",
  ].filter(Boolean).join("\n\n");
  return { system, user };
}

/**
 * A label is the part's name, never a sentence: an explanation after a dash, colon or bracket is dropped,
 * and anything still long is cut at a word, never mid-word ("Goggles — protect the eyes from splashes,
 * broken" was drawn cut at 48 characters, course benchmark 2026-10-24).
 */
export function shortLabel(text: string): string {
  let t = text.split(/\s+[—–-]\s+|:\s|\s\(/)[0].trim();
  if (t.length <= 40) return t;
  const words = t.split(/\s+/);
  t = "";
  for (const w of words) {
    if ((t ? `${t} ${w}` : w).length > 40) break;
    t = t ? `${t} ${w}` : w;
  }
  return t.replace(/[,;]+$/, "");
}

/** A label that names nothing ("change 1", "second curve", "graph"). */
const PLACEHOLDER = /^(?:the\s+)?(?:(?:first|second|third|other)\s+)?(?:change|curve|line|graph|arrow|part|label|item|object|thing|shape|box|panel|region|area|point|y[-\s]?intercept|asymptote)(?:\s*\d+)?$/i;

/** The label as written: a placeholder becomes the name of the part it points to, or nothing. */
export function namedLabel(text: string, pointsTo: string): string {
  if (!PLACEHOLDER.test(text.trim())) return text;
  const name = shortLabel(pointsTo);
  return name && !PLACEHOLDER.test(name.trim()) ? name : "";
}

export function parsePictureFields(json: unknown, sentenceCount: number, courseFamily?: PictureFamily, written: string[] = []): PictureFields | null {
  const r = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const str = (v: unknown, max = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  // Every board has a family now: an answer outside the list is the course's own family.
  const family = PICTURE_FAMILIES.includes(r.family as PictureFamily) ? (r.family as PictureFamily) : courseFamily ?? "other";
  const parts = (Array.isArray(r.parts) ? r.parts : []).map((p) => p as Record<string, unknown>).map((p) => ({ name: str(p.name, 60), where: str(p.where, 120), looks: str(p.looks, 160) })).filter((p) => p.name).slice(0, 6);
  const mustBeTrue = (Array.isArray(r.must_be_true) ? r.must_be_true : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 6);
  const seen = new Set<string>();
  // Simple pictures (owner, 2026-10-24): at most six parts, five labels and eight pieces of exact text.
  // A placeholder label ("change 1", "second curve", "graph") names nothing: the part's own name is
  // written instead, or no label (a gas-laws picture labelled two arrows "change 1" and "change 2").
  const labels = (Array.isArray(r.labels) ? r.labels : []).map((l) => l as Record<string, unknown>).map((l) => ({
    text: namedLabel(shortLabel(str(l.text, 200)), str(l.points_to, 60)),
    pointsTo: str(l.points_to, 60),
    position: str(l.position, 40) || "right margin, middle",
    sentence: Math.max(0, Math.min(Math.max(0, sentenceCount - 1), Math.round(Number(l.sentence) || 0))),
  })).filter((l) => l.text && !seen.has(l.text.toLowerCase()) && seen.add(l.text.toLowerCase())).slice(0, 5);
  // The picture never repeats the board's own writing (owner, 2026-10-24: no images in waste): a line of
  // working or a note already written beside it is not drawn into it again.
  const writtenLines = written.map((w) => w.replace(/^[^:]*:\s*/, ""));
  const labelSet = new Set(labels.map((l) => l.text.toLowerCase()));
  const exactText = [...new Set((Array.isArray(r.exact_text) ? r.exact_text : []).map((x) => str(x, 40)).filter((t) => t && !labelSet.has(t.toLowerCase()) && !writtenLines.some((w) => sameLine(t, w))))].slice(0, 8);
  // An exact diagram may carry its words as exact text (a flowchart's boxes) rather than as labels.
  if (family !== "other" && (parts.length < 1 || (FAMILIES[family].labels === "model" && !labels.length && !exactText.length) || !str(r.diagram_type))) return null;
  return { family, audience: str(r.audience, 120), diagramType: str(r.diagram_type, 160), exact: r.exact === true, exactText, arrows: str(r.arrows, 300), scope: str(r.scope, 120), view: str(r.view, 200), parts, mustBeTrue, labels, setting: str(r.setting, 160), people: str(r.people, 160) };
}

/* ── the subject's rules and the JSON prompt ──────────────────────────────────────────────────── */

/**
 * How an exact diagram is drawn (owner, 2026-10-24: every course visual is generated — graphs, formulas,
 * circuits, flowcharts and maths figures included): as a precise textbook figure, every value written
 * exactly as the board gives it and nothing else.
 */
const EXACT_RULES = [
  "This is an EXACT textbook diagram, not an illustration: straight ruled lines, precise geometry and proportions, the curriculum's standard symbols, every count exact.",
  "Every value, symbol, formula, axis title, unit and word listed in exact_text is written EXACTLY as given, once, in clean dark sans-serif (formulas with proper subscripts and superscripts, charges as superscripts); no other numbers, symbols or words.",
  "Graphs: ruled axes from the origin with arrowheads, scale marks evenly spaced at exactly the listed values, the listed axis titles with units, each line or curve passing exactly through the listed points.",
  "Arrows only as listed under arrows, each pointing the stated way.",
];

/** The prompt gpt-image-2 receives (as JSON), with the board's whole context in it. */
export function coursePicturePrompt(ctx: CourseBoardContext, f: PictureFields, corrections: string[] = []): Record<string, unknown> {
  const key: PictureFamily = f.family === "other" ? ctx.family ?? "biology" : f.family;
  const pack: Family = FAMILIES[key];
  const inPicture = pack.labels === "model";
  const n = f.labels.length;
  const arrows = f.arrows || pack.arrows || "";
  return {
    purpose: `A ${inPicture ? "correctly labelled " : ""}school-textbook ${pack.name} ${f.exact ? "diagram" : "picture"} for one lesson board. For ${f.audience || "a secondary-school student"}.`,
    board_context: {
      lesson: `${ctx.course} — ${ctx.lesson}`,
      board: ctx.board,
      what_the_board_teaches: ctx.brief,
      what_the_teacher_says: ctx.sentences.join(" "),
      ...(ctx.written.length ? { written_on_the_board_beside_it: ctx.written } : {}),
      draw_exactly_this: `${f.diagramType}: ${f.scope || "the whole of it"}. The board's own example, names and numbers. Nothing from other parts of the topic, nothing the teacher does not talk about.`,
    },
    canvas: `Landscape 3:2, plain white background. The drawing fills the central ${f.exact ? "75%" : pack.frame} of the frame${inPicture && !f.exact ? "; the left and right margins are kept empty for the labels" : ""}.`,
    simplicity: "Simple and uncluttered: one idea, plenty of white space, only the parts listed. No extra scenery, no inset panels, no side flowchart, no second diagram, no arrow or detail the teacher does not explain.",
    subject_and_view: `${f.diagramType}, ${f.view}.`,
    ...(f.setting ? { setting: f.setting } : {}),
    ...(f.people && f.people !== "none" ? { people: f.people } : {}),
    parts_and_layout: f.parts.map((p) => `${p.name}: ${p.where}; ${p.looks}`),
    must_be_true: f.mustBeTrue,
    [`${key}_rules`]: pack.rules,
    ...(f.exact ? { exact_diagram_rules: EXACT_RULES } : {}),
    ...(inPicture
      ? {
          labels: {
            count: `Exactly ${n} labels.`,
            rules: [
              "Write each label EXACTLY as given, once, with no extra characters.",
              ...(f.exact
                ? ["Bold dark sans-serif, large and easy to read, set right beside what it names; a thin straight line with no arrowhead joins it to its part only where it cannot sit beside it."]
                : ["Bold dark sans-serif, large and easy to read, set in the margins outside the drawing.", "Each label is joined to its part by a thin straight ruled line with no arrowhead that ends on the middle of that part."]),
              "Label lines never cross each other or any label.",
            ],
            draw_exactly: f.labels.map((l) => ({ text: l.text, points_to: l.pointsTo, position: l.position })),
          },
        }
      : { labels: "None. The teacher writes every word on the board afterwards, so every part listed is drawn clearly separate and fully visible." }),
    ...(inPicture && f.exactText.length ? { exact_text: f.exactText } : {}),
    ...(arrows ? { arrows } : {}),
    style: f.exact ? `${pack.style} Exact-diagram look: thin even dark lines on white, flat fills in a few soft colours, no shading, no 3-D effects unless the diagram is a 3-D model, no decoration.` : pack.style,
    curriculum: { spelling: ctx.curriculum.spelling, names_and_units: ctx.curriculum.namesAndUnits, symbols: ctx.curriculum.symbols, conventions: ctx.curriculum.conventions },
    ...(corrections.length ? { corrections: `An earlier drawing was rejected. Correct these: ${corrections.join("; ")}` } : {}),
    never: [...CORE_NEVER, ...pack.never, ...pack.neverDraw.map((x) => `Never draw ${x}.`), ...(LOCALE_RULES[ctx.curriculum.name] ?? [])],
    text_and_exclusions: inPicture
      ? `The only text anywhere in the image is ${[n ? `the ${n} label${n === 1 ? "" : "s"}` : "", f.exactText.length ? `the ${f.exactText.length} piece${f.exactText.length === 1 ? "" : "s"} of exact text` : ""].filter(Boolean).join(" and ")}. No title, caption, legend${f.exactText.length ? "" : ", numbers"}${arrows ? "" : ", arrows"}, watermark or other text.`
      : `No writing anywhere in the image: no letters, words, numbers, labels, captions${arrows ? "" : ", arrows"} or watermark.`,
  };
}

/** Whether a family's labels are written in the picture by the model, or on the board by code. */
export function labelsInPicture(family: PictureFields["family"]): boolean {
  return family !== "other" && FAMILIES[family].labels === "model";
}

/** One remembered picture per curriculum, picture and label set. */
export function coursePictureKey(ctx: CourseBoardContext, f: PictureFields): string {
  const signature = JSON.stringify({ v: "course-picture-v2", model: "gpt-image-2", curriculum: ctx.curriculum.name, family: f.family, type: f.diagramType.toLowerCase(), scope: f.scope.toLowerCase(), labels: f.labels.map((l) => l.text.toLowerCase()).sort(), text: f.exactText.map((t) => t.toLowerCase()).sort() });
  return `asset-${createHash("sha256").update(signature).digest("hex").slice(0, 32)}`;
}

/* ── the label check ──────────────────────────────────────────────────────────────────────────── */

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Every expected label found as written, letter by letter, and no other words. The reader spells each
 * piece of text out (a plain transcription read the misspelt "separtor" back as "separator", 2026-10-24).
 * Lone signs and symbols (+, −, d.c.) are not words.
 */
export function labelsMatch(expected: string[], read: string[]): { ok: boolean; missing: string[]; extra: string[] } {
  const left = read.map(squash).filter(Boolean);
  const missing: string[] = [];
  for (const label of expected) {
    const i = left.indexOf(squash(label));
    if (i >= 0) left.splice(i, 1);
    else missing.push(label);
  }
  const extra = left.filter((t) => /\p{L}{2,}/u.test(t));
  return { ok: !missing.length && !extra.length, missing, extra };
}

/**
 * WHAT FORCES THE ONE REDRAW (owner, 2026-10-24): a misspelt or missing label, a label pointing at a
 * different part, a false fact, an invented or missing structure, anything against the sensitive-content
 * rules. Everything else (a line ending at the edge of the right part, style, a detail the board does not
 * need) is allowed. Stray words in the picture count as invented text; a label with no line to any part
 * counts as pointing at the wrong part.
 */
export type Inspection = {
  facts?: Array<{ fact: string; true: boolean; why?: string }>;
  pointers?: Array<{ label: string; result: string; why?: string }>;
  errors?: Array<{ kind: string; what: string }>;
};
export function mustFix(spelling: { missing: string[]; extra: string[] }, inspection: Inspection): string[] {
  return [
    ...spelling.missing.map((m) => `the label "${m}" is missing or misspelt — write it exactly`),
    ...spelling.extra.map((e) => `remove the stray text "${e}"`),
    ...(inspection.facts ?? []).filter((f) => f.true === false).map((f) => `${f.fact}${f.why ? ` (${f.why})` : ""}`),
    ...(inspection.pointers ?? []).filter((p) => p.result === "different part" || p.result === "no line").map((p) => `the line from "${p.label}" must end on its own part${p.why ? ` (${p.why})` : ""}`),
    ...(inspection.errors ?? []).filter((e) => e.kind === "invented" || e.kind === "missing" || e.kind === "sensitive").map((e) => `${e.kind === "sensitive" ? "remove (not allowed)" : e.kind === "invented" ? "remove the invented" : "add the missing"}: ${e.what}`),
  ];
}

const SMALL_DIGITS: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

/**
 * Labels read back by text recognition (Tesseract), which gives the picture's text as one block — a label
 * may be wrapped onto two lines. Each expected label must appear letter for letter somewhere in it
 * (subscripts read as plain digits); stray words are the examiner's to report.
 */
export function labelsInRecognisedText(expected: string[], text: string): { ok: boolean; missing: string[]; extra: string[] } {
  // Word by word, in any order (a wrapped label is read with other words between its lines), with only the
  // shapes text recognition confuses made equal — I, l, 1 and | ; O and 0 — so "lead(Il)" is "lead(II)" but
  // "separtor" is still not "separator".
  const words = (t: string) => t.replace(/[₀-₉⁰-⁹¹²³]/g, (c) => SMALL_DIGITS[c] ?? c).toLowerCase().replace(/[l1|]/g, "i").replace(/0/g, "o").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
  const seen = new Set(words(text));
  const missing = expected.filter((l) => words(l).some((w) => !seen.has(w)));
  return { ok: !missing.length, missing, extra: [] };
}

/** A reading of one piece of text spelt out letter by letter ("s-e-p / a-r"), as plain words. */
export function lettersToText(letters: string): string {
  return letters.split("/").map((w) => w.replace(/[-\s]/g, "")).join(" ").trim();
}

/* ── the board, with its picture ─────────────────────────────────────────────────────────────── */

/**
 * The board with its course picture: the labels are IN the picture, so none is drawn over it; each
 * label's part keeps its place on the picture and the sentence that names it, so the pen points there
 * and the camera goes there as Aria says it, and every label is a part the narration must name
 * (lib/canvas/labelMentions.ts). A part the board planned that the picture does not label is dropped.
 */
export function withCoursePicture(spec: CanvasBoardSpec, pic: { labels: Array<{ text: string; part: string; sentence: number; x: number; y: number; box?: { x: number; y: number; w: number; h: number } }>; fields: Pick<PictureFields, "diagramType" | "labels"> & { family?: PictureFields["family"] }; description: string; paper: string }, src: string): CanvasBoardSpec {
  if (spec.stage.kind !== "illustration") return spec;
  const stage = spec.stage;
  const planned = new Map(stage.parts.map((p) => [partNameKey(p.name), p]));
  const used = new Set<string>();
  const parts = pic.labels.map((l, i) => {
    const mine = planned.get(partNameKey(l.part)) ?? planned.get(partNameKey(l.text));
    const id = mine && !used.has(mine.id) ? mine.id : `label-${i + 1}`;
    used.add(id);
    return { id, name: l.text, s: l.sentence, ...(mine?.say ? { say: mine.say } : {}), x: l.x, y: l.y, ...(l.box ? { labelBox: l.box } : {}) };
  });
  const kept = new Set(parts.map((p) => p.id));
  const pointed = new Set(spec.cues.filter((c) => c.target && kept.has(c.target)).map((c) => c.target));
  return {
    ...spec,
    // Labels written by the model are in the picture; a no-writing family's labels are written by the board.
    stage: { ...stage, subject: pic.fields.diagramType || stage.subject, parts, src, paper: pic.paper, description: pic.description, coursePicture: true, ...(pic.fields.family === undefined || labelsInPicture(pic.fields.family) ? { labels: [], labelsInPicture: pic.fields.labels.map((l) => l.text) } : { labels: parts.map((p) => p.id), labelsInPicture: undefined }) },
    cues: [
      ...spec.cues.filter((c) => !c.target || !stage.parts.some((p) => p.id === c.target) || kept.has(c.target)),
      // Each labelled part is pointed at on the sentence that names it.
      ...parts.filter((p) => !pointed.has(p.id)).map((p) => ({ s: p.s, at: 0.3, action: "point" as const, target: p.id })),
    ],
  };
}
