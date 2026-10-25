import type { CanvasPlanBeat } from "../canvas/types";

/**
 * Does this board's idea have a visual form? Used to route leftover boards to a vector diagram
 * instead of an icon chain or a text table. General — never a per-topic list.
 */

const PROCESS = /\b(then|next|leads? to|results? in|causes?|steps?|stages? of (the )?(process|cycle|reaction)|cycle|process|sequence|flows?|becomes|turns? into|produces?|→)\b/i;
const PHOTOGRAPHIC = /\b(looks? like|appearance|photograph|what .+ looks like|habitat|in situ|artefact|artifact|landform's look|organism)\b/i;
const STRUCTURAL = /\b(label|identify|parts?|structure|inside|cross[- ]section|cutaway|anatomy|diagram of|model of|set[- ]?up)\b/i;
const SPATIAL = /\b(maps?|ocean currents?|winds?|weather systems?|ITCZ|pressure belts?|hadley|ferrel|polar cell|three[- ]cell|atmospheric circulation|latitude|longitude|globes?|world (map|ocean)|currents? of the (atlantic|pacific|ocean))\b/i;
const DATA = /\b(graphs?|charts?|plots?|axis|axes|curves?|surplus|deficit|supply and demand|number line|bounds?|scatter|histogram|against (time|latitude|price|quantity))\b/i;
const COUNTS = /\b(\d{1,3}\s*(chromosomes?|pairs?|cells?|copies)|n\s*=\s*\d+|2n\s*=\s*\d+|haploid|diploid|exact counts?|sets? of chromosomes?)\b/i;
const EXPERIMENT = /\b(scattering|gold foil|alpha particles?|apparatus|set[- ]?up|paths? of|deflect)\b/i;
const MATH_ONLY = new Set(["shapes3d", "triangle", "vectors", "parallelLines", "bearings", "unitCircle", "fractionModel", "sectorArc", "argand"]);
// Triangle words too: without them the planner's own "triangle" was refused on "Parts of a right
// triangle" and the board was sketched by hand (playback QA, 2026-10-21).
const MATHS = /\b(cuboids?|cubes?|prisms?|pyramids?|nets? of|volume of|surface area|3[- ]?d (shapes?|solids?)|complex numbers?|argand|unit circle|bearings?|vectors?|parallel lines|fractions? of a (shape|bar|circle)|sector|arc length|triangles?|hypotenuse|right[- ]angled?|pythagor\w*|trigonometr\w*|sine rule|cosine rule|sohcahtoa)\b/i;

export function boardWords(beat: Pick<CanvasPlanBeat, "title" | "brief" | "script" | "objects">): string {
  return `${beat.title} ${beat.brief} ${beat.script} ${(beat.objects ?? []).join(" ")}`;
}

export function isRealProcess(text: string): boolean {
  return PROCESS.test(text) && !SPATIAL.test(text) && !DATA.test(text) && !COUNTS.test(text) && !EXPERIMENT.test(text);
}

/**
 * Things an image model draws well and a student benefits from seeing as they look (owner,
 * 2026-10-17): organs, cells, plants and flowers, animals, apparatus, landscapes and buildings. Their
 * labelled structure is still a picture — the labels are located on it and checked (lib/canvas/
 * textbookDiagram.ts). An exact code-drawn figure or a verified library diagram still comes first.
 */
const PICTURE_SUBJECT = /\b(heart|lungs?|kidneys?|liver|brain|eyes?|ears?|stomach|intestines?|skin|skeleton|organs?|organ systems?|glands?|endocrine|adrenal|pituitary|thyroid|pancreas|ovar(?:y|ies)|testes|pathogens?|mosquito(?:es)?|parasites?|pigeons?|bats?|cats?|dogs?|lizards?|frogs?|snakes?|horses?|donkeys?|cows?|sheep|bees?|butterfl(?:y|ies)|worms?|crabs?|spiders?|whales?|sharks?|(?:plant|animal|bacterial|red blood|white blood|nerve|root hair|guard|palisade|sperm|egg|epithelial|muscle) cells?|cells? structure|mitochondri(?:on|a)|chloroplasts?|organelles?|nucle(?:us|i)|vacuoles?|bacteri(?:um|a)|viruse?s?|neurones?|neurons?|plants?|flowers?|leaf|leaves|roots? systems?|seeds?|fruits?|stems?|trees?|fung(?:us|i)|foods?|vegetables|cereals|dairy|meat|grains?|insects?|birds?|fish|mammals?|reptiles?|amphibians?|animals?|organisms?|specimens?|apparatus|equipment|microscopes?|volcano(?:es)?|glaciers?|rivers?|coastlines?|cliffs?|mountains?|deserts?|rainforests?|landforms?|landscapes?|caves?|waterfalls?|buildings|(?:a|the|this|that|historic|famous|old|tall) building|mosques?|temples?|churches|cathedrals?|castles?|forts?|monuments?|pyramids?|palaces?|tombs?)\b/i;
/**
 * Processes and mechanisms stay code or vector diagrams: the image model drew a shoot bending AWAY
 * from the light twice in a row, and its own check rejected both (pipeline test, 2026-10-17).
 */
const PICTURE_MECHANISM = /\b(tropisms?|phototropi\w*|gravitropi\w*|geotropi\w*|auxins?|forces?|resultants?|momentum|equilibrium|pathways?|cycles?|feedback|mechanisms?|transport|diffusion|osmosis|reactions?|equations?|enzyme action|active sites?|bonding|circuits?|waves?|refraction|reflection|inheritance|crosses|genetic diagrams?|food (?:chains?|webs?)|energy transfer|produc\w*|synthesis|transcri\w*|translat\w*|replicat\w*|modif\w*|engineer\w*|process\w*|stages? (?:of|in)|steps? (?:of|in|to)|how .+ works?|advantages?|disadvantages?|benefits?|costs?|effects?|impacts?|decisions?|evaluat\w*|reasons?|formation|deaminat\w*|excret\w*|classif\w*|absorb\w*|secret\w*|regulat\w*|controll?\w*|homeosta\w*|filtrat\w*|reabsorb\w*|digest\w*|converts?|conversion|binds?|binding|causes?|consequences?|factors?|polic(?:y|ies)|econom\w*|markets?)\b/i;

/**
 * A subject a generated picture should show (see PICTURE_SUBJECT), not a process, map, graph or count.
 * Pass the board's TITLE and brief: its narration names processes in passing ("the heart transports
 * blood") that do not make a heart board a process board.
 */
export function isPictureSubject(text: string): boolean {
  return PICTURE_SUBJECT.test(text) && !PICTURE_MECHANISM.test(text) && !SPATIAL.test(text) && !DATA.test(text) && !COUNTS.test(text) && !MATHS.test(text);
}

/**
 * A board worth a picture: a picture subject anywhere in what the board teaches (its title, brief,
 * objects, narration), unless its TITLE is a process, argument, map, graph or calculation. "Endocrine
 * glands and their hormones" and "Grouping by shared features" (pigeon, bat, cat, lizard) never got one
 * when only titles counted (owner, 2026-10-17: "I don't want them to be rare").
 */
export function isPictureWorthy(title: string, body: string): boolean {
  return PICTURE_SUBJECT.test(`${title} ${body}`) && !PICTURE_MECHANISM.test(title) && !SPATIAL.test(title) && !DATA.test(title) && !COUNTS.test(title) && !MATHS.test(`${title} ${body}`);
}

export function isPhotographicAppearance(text: string): boolean {
  return PHOTOGRAPHIC.test(text) && !STRUCTURAL.test(text) && !SPATIAL.test(text) && !DATA.test(text) && !COUNTS.test(text);
}

export function hasVisualForm(text: string): boolean {
  return STRUCTURAL.test(text) || SPATIAL.test(text) || DATA.test(text) || COUNTS.test(text) || EXPERIMENT.test(text) || /\b(diagram|labelled|cross[- ]section|model)\b/i.test(text);
}

/** Maps, counts, data, labelled models: never a generated photograph. */
export function needsVectorDiagram(text: string): boolean {
  return SPATIAL.test(text) || DATA.test(text) || COUNTS.test(text) || EXPERIMENT.test(text) || (STRUCTURAL.test(text) && !isPhotographicAppearance(text));
}

export function isMathsSolidBoard(text: string): boolean {
  return MATHS.test(text);
}

/**
 * Geometry whose textbook visual is an exact construction: circle theorems, chords and tangents,
 * triangles, similarity and congruence, loci, vectors. Drawn by the vector grammar's "geometry"
 * element (lib/diagrams/grammar.ts) when no code component fits — never as an icon flow of circles
 * ("Centre bisects a chord" came out as one, QA 2026-10-17).
 */
export const GEOMETRY_FORM = /\b(circle theorems?|chords?|tangents? (to|from|at|and)|perpendicular bisectors?|cyclic quadrilaterals?|angles? (at|in) the (centre|center|circumference)|angle in a semicircle|alternate segment|same segment|similar (triangles|shapes|figures)|congruen(t|ce)|similarity|loci|locus|triangles?|pythagora\w*|bearings?|vector (diagrams?|addition|triangles?)|resultant (vector|displacement|velocity)|parallelograms?)\b/i;

/**
 * Mechanics whose textbook visual is bodies, arrows and a line of motion: a collision before and
 * after, momentum along a line, forces on a body, a projectile's path. An A-Level momentum lesson
 * drew no trolley on any board — every board was a table (QA 2026-10-17).
 */
export const MECHANICS_FORM = /\b(momentum|collisions?|collid\w*|direct impacts?|(before|after) (the )?(impact|collision)|coalesc\w*|restitution|impulse|recoil|explosions? (into|apart)|projectiles?|trajector(y|ies)|inclined planes?|smooth planes?|rough planes?|connected particles|pulleys?|resolv\w* (the )?forces?|free[- ]body|normal (contact |reaction )?(force|reaction)|frictional forces?|friction (acts|opposes|force)|tension (in|of) (the |a )?(string|rope|cable)|forces? acting on|resultant forces?|forces? (acting )?on (the|a|an) (block|particle|body|trolley|car|box|sphere|ball)|gravitational (potential|field strength|fields?)|potential (wells?|against (distance|r\b))|equipotentials?|field lines)\b/i;

/** A board whose idea is drawn as geometry or mechanics: a maths or physics board may still be a vector diagram. */
export function isGeometryOrMechanics(text: string): boolean {
  // "Nerve impulses travel quickly" is biology, not a collision's impulse (diagram lab, 2026-10-17).
  const t = text.replace(/\b(nerve|electrical|nervous)\s+impulses?\b|\bimpulses?\s+(travel|pass|along|in neurones?|carried)\b/gi, " ");
  return GEOMETRY_FORM.test(t) || MECHANICS_FORM.test(t);
}

/** A board about a circle's chords, tangents or angles: the circle theorem diagram, not a bare triangle. */
const CIRCLE_BOARD = /\b(circle theorems?|chords?|tangents? (to|from)|cyclic quadrilaterals?|angles? (at|in) the (centre|center|circumference)|semicircle|alternate segment|same segment|subtended)\b/i;
export function isCircleGeometry(text: string): boolean {
  return CIRCLE_BOARD.test(text) && /\b(circles?|centre|center|radius|radii|circumference)\b/i.test(text);
}

export function componentFitsSubject(name: string, text: string): boolean {
  // A circle theorem's proof uses triangles (OMA, OMB) and its working Pythagoras, but the board's
  // diagram is the circle: a standalone right triangle was drawn on "The centre bisects a chord" and
  // rejected twice by the review (QA 2026-10-17).
  if (["triangle", "vectors", "parallelLines", "coordinateGrid", "shapes3d"].includes(name) && isCircleGeometry(text)) return false;
  // Motion graphs plot against TIME: "Momentum is a directed quantity" (p = mv, a p–v line) was
  // given a velocity–time graph and the review rejected it (QA 2026-10-17).
  if (name === "motionGraph" && /\bmomentum\b/i.test(text) && !/\b(against time|[a-z]+[- ]time graphs?|[dvsa]-t graphs?|motion graphs?)\b/i.test(text)) return false;
  if (MATH_ONLY.has(name) && !isMathsSolidBoard(text)) return false;
  // A graph drawn against TIME is for a board that talks about time: limiting factors of photosynthesis
  // (rate against light intensity) were drawn as a reaction-rate curve against "Time / s" (2026-10-18).
  if (["rateGraph", "motionGraph"].includes(name) && !/\b(time|seconds?|minutes?|hours?|days?|years?|duration|[dvsa]-t)\b/i.test(text)) return false;
  // History and essay templates (short-term / long-term consequences, a for-and-against balance, a
  // source card, a timeline) stay off science and maths boards: "Classifying viruses" was drawn as
  // causes with short- and long-term consequences (diagram lab, 2026-10-17). Tables stay allowed.
  if (ESSAY_KITS.has(name) && SCIENCE_MATHS.test(text) && !HUMANITIES_WORDS.test(text)) return false;
  // The particle model of solids, liquids and gases is for a board about STATES of matter: "Formulae from
  // particle models" (a methane molecule) was given the solid/liquid/gas boxes (course bench, 2026-10-24).
  if (name === "particles" && !aboutStatesOfMatter(text)) return false;
  return true;
}

const STATE_CHANGES = /\b(states? of matter|changes? of state|state changes?|kinetic|melt(s|ing|ed)?|freez\w*|boil\w*|evaporat\w*|condens\w*|sublim\w*)\b/i;
const PARTICLE_MOTION = /\b(arrange\w*|spacing|spaced|far apart|close together|vibrat\w*|mov(e|es|ing)|motion|random\w*|regular pattern|pressure|diffus\w*)\b/i;
/** A board about the states of matter: a change of state, two states compared, or one state's particles moving or arranged. */
function aboutStatesOfMatter(text: string): boolean {
  const states = new Set([...text.toLowerCase().matchAll(/\b(solid|liquid|gas)(?:es|s)?\b/g)].map((m) => m[1]));
  return STATE_CHANGES.test(text) || states.size >= 2 || (states.size === 1 && PARTICLE_MOTION.test(text));
}

const ESSAY_KITS = new Set(["causeConsequence", "evaluationScale", "sourceCard", "timeline"]);
const SCIENCE_MATHS = /\b(cells?|bacteri\w*|virus\w*|enzymes?|proteins?|DNA|RNA|genes?|organisms?|species|antibiotics?|molecules?|atoms?|ions?|reactions?|compounds?|elements?|forces?|energy|velocity|momentum|current|voltage|waves?|equations?|functions?|graphs?|gradient|algebra|probability|vectors?|matri(x|ces)|integrals?|derivatives?|tissues?|organs?|hormones?|blood|photosynthesis|respiration|digestion|kingdoms?|domains?|classification|vitamins?|minerals?|deficienc\w*|diseases?|nutrients?|diets?|symptoms?|ecosystems?|habitats?|populations?|conservation|biodiversity|pollution|fish(?:ing)?|forests?|infections?|immun\w*)\b/i;
const HUMANITIES_WORDS = /\b(war|wars|empire|treaty|revolution|government|parliament|policy|policies|election|economy|economic|inflation|unemployment|trade|society|social|religion|religious|culture|history|historical|century|king|queen|president|colonial|independence|ethics|ethical|moral|debate|evaluate|to what extent|advantages and disadvantages)\b/i;

export { MATH_ONLY };
