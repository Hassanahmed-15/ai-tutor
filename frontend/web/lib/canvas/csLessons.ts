/**
 * COMPUTER-SCIENCE LESSONS FROM A TYPED PROMPT (owner, 2026-10-23: "test it as a CS student").
 *
 * Five niche CS lectures were tested (Kahn's algorithm, union-find, KMP, Bloom filters, Raft). The CS
 * and data-structure checks are keyword lists, and 35 of 50 niche CS topics matched neither — so KMP,
 * Bloom filters and Raft were taught with none of the CS rules: no structure drawn, the variables
 * panel full of words ("finished", "completed LPS array"), flow charts for protocols. And "stacks" in
 * coastal erosion, "heaps of sediment" and multiplication "arrays" were taken for data structures.
 *
 * Everything here is for TYPED-PROMPT lessons only: PDF, YouTube and course lectures keep the shared
 * checks (isCsTopic, isDataStructureTopic) exactly as they are.
 */
import { isCsTopic } from "./subjectLook";
import { isDataStructureTopic, isGraphAlgorithmTopic, runStructure } from "./structure";
import { canvasSentences } from "./plan";
import type { CanvasBoardSpec, DsOp, DsStart } from "./types";

/** Words that also mean something outside computing count only with computing around them. */
const COMPUTING_CONTEXT = /\b(?:algorithms?|computers?|computing|computer science|programs?|programming|code|python|java|software|data|database|servers?|nodes?|cluster|distributed|network(?:ing|s)?|protocols?|cpu|processors?|operating systems?|kernel|memory|machines?|compilers?|logs?|messages?|bytes?|bits?)\b/i;

type Family = {
  id: string;
  /** Named things that are only ever computing. */
  strong: RegExp;
  /** Named things that need computing around them (a boat "raft", a "leader election" in politics). */
  weak?: RegExp;
  /** Draws a structure (DSA rules, structure boards), or is taught in words and code only. */
  draws: boolean;
  /** What the board draws for this kind of topic, said to the board writer (null: the usual DSA rules). */
  picture: string | null;
  /** Words of a board that shows the mechanism at work: such a board is drawn on the structure, never as a flow chart. */
  mechanism?: RegExp;
};

const FAMILIES: Family[] = [
  {
    id: "strings",
    mechanism: /\b(?:compar\w*|match\w*|mismatch\w*|shift\w*|lps|prefix\w*|pointers?|index\w*|scan\w*|fall(?:s|ing)? ?back|fallback)\b/i,
    strong: /\b(?:kmp|knuth[- ]morris[- ]pratt|rabin[- ]karp|z[- ]algorithm|boyer[- ]moore|string (?:matching|searching|search)(?: algorithms?)?|lps (?:array|table)|prefix (?:function|table)|failure function|rolling hash\w*|suffix (?:arrays?|trees?)|longest (?:common )?prefix)\b/i,
    draws: true,
    picture: `STRING MATCHING: draw the string being scanned as an "array" structure, one character per cell (ids c0, c1, …), with each index as a pointer ({"op": "point", "name": "i", "to": "c3"}; "j" or "len" for the other) that moves one cell per sentence. Mark the two characters being compared ({"op": "mark", "as": "compare"}) and matched cells ("found"). The other string and the LPS / prefix table are lists in the variables panel ("lps": "[0, 0, 1, 2]"), filled in one value per sentence. Trace ONE concrete text and pattern, 5 to 10 characters each, and show every fallback (len 3 → 1 → 0) as its own step. An index is never null: one at 0 points to cell c0, or is a value in the variables panel ("len": "0").`,
  },
  {
    id: "hashing",
    mechanism: /\b(?:bits?|hash\w*|insert\w*|quer\w*|lookups?|slots?|buckets?|prob\w*|collisions?)\b/i,
    strong: /\b(?:bloom filters?|count[- ]min sketch|hyperloglog|cuckoo hashing|open addressing|linear probing|quadratic probing|double hashing|separate chaining|hash (?:collisions?|functions? (?:in|for) (?:hash tables?|data structures?)))\b/i,
    draws: true,
    picture: `HASHING / BLOOM FILTER: draw the table or bit array itself as an "array" structure of 8 to 12 cells (ids b0, b1, …; a bit array's values "0"). Each hash result is a pointer to its cell ("h1", "h2", "h3"); {"op": "set"} writes the cell as Aria says it (a bit to "1", a key into its slot), and a lookup marks every cell it reads ("compare"). Use ONE concrete key per sentence, its hash values said aloud and written ("h1(cat) = 2"). A false positive is shown: a key never added whose cells are all already 1.`,
  },
  {
    id: "union-find",
    mechanism: /\b(?:parents?|roots?|find|union|compress\w*|rank|merg\w*|pointers?)\b/i,
    strong: /\b(?:union[- ]find|disjoint[- ]set (?:union|data structures?|forests?)|dsu|path compression|union by (?:rank|size))\b/i,
    draws: true,
    picture: `UNION-FIND: draw the parent-pointer forest as a "graph" structure with "variant": "directed" — one node per element (A–E), each link pointing from a node to its PARENT, a root with no link. A node has exactly ONE parent link: when its parent changes (path compression, a union), the same step does {"op": "unlink", "from", "to": old parent} and {"op": "link", "from", "to": new parent}, so the student watches the arrow move. The "parent" (and "rank") lists are real values in the variables panel ("parent": "[A, A, B, C, D]"), updated on the step that changes them.`,
  },
  {
    id: "advanced-structures",
    strong: /\b(?:segment trees?|fenwick trees?|binary indexed trees?|skip ?lists?|splay trees?|treaps?|b\+? ?trees?|b[- ]trees?|red[- ]black trees?|interval trees?|k-?d trees?|sparse tables?|lru cache|monotonic (?:stacks?|queues?|deques?))\b/i,
    draws: true,
    picture: null,
  },
  {
    id: "dynamic-programming",
    mechanism: /\b(?:table|cells?|rows?|fill\w*|subproblems?|recurrence)\b/i,
    strong: /\b(?:longest common subsequence|edit distance|levenshtein|longest increasing subsequence|coin change|matrix chain|knapsack|dp tables?|memoi[sz]ation|tabulation)\b/i,
    draws: true,
    picture: `DYNAMIC PROGRAMMING: draw the table being filled as an "array" structure (one cell per index of the row being filled; ids d0, d1, …), filling ONE cell per sentence with {"op": "set"} and marking the cells it is computed from ("compare"). A finished earlier row goes in the variables panel as a list ("row 1": "[0, 1, 1, 2]"). Trace ONE small input (strings of 3 to 5 characters, or 3 to 4 items).`,
  },
  {
    id: "game-search",
    mechanism: /\b(?:nodes?|leaf|leaves|scores?|prun\w*|alpha|beta|maximi[sz]\w*|minimi[sz]\w*|evaluat\w*)\b/i,
    strong: /\b(?:minimax|alpha[- ]beta(?: pruning)?|game trees?|monte carlo tree search|mcts)\b/i,
    draws: true,
    picture: `GAME-TREE SEARCH: draw the game tree as a "tree" structure (3 levels, leaves holding their scores), compute ONE node's value per sentence bottom-up with {"op": "set"}, mark the node being evaluated ("visit"), and cross out a pruned branch with {"op": "mark", "as": "remove"} on the sentence that prunes it; alpha and beta are real numbers in the variables panel.`,
  },
  {
    id: "protocols",
    mechanism: /\b(?:servers?|nodes?|hosts?|clients?|messages?|votes?|voting|leaders?|followers?|candidates?|terms?|heartbeats?|requests?|repl(?:y|ies)|acks?|syn|packets?|timeouts?|crash\w*|elect\w*|commit\w*|prepare)\b/i,
    strong: /\b(?:paxos|raft (?:consensus|algorithm|protocol|leader|log|cluster)s?|consensus (?:algorithms?|protocols?)|two[- ]phase commit|2pc|three[- ]phase commit|three[- ]way handshake|tcp(?:\/ip)?|udp|gossip protocols?|vector clocks?|lamport (?:clocks?|timestamps?)|byzantine (?:fault|generals?)\w*|cap theorem|consistent hashing|map ?reduce|sharding|dns (?:resolution|lookup)|routing protocols?|distance[- ]vector routing|link[- ]state routing|sliding window protocols?|go[- ]back[- ]n|selective repeat|stop[- ]and[- ]wait|distributed systems?|distributed consensus)\b/i,
    weak: /\b(?:raft|leader election|replication|load balanc\w*|heartbeats?|quorum)\b/i,
    draws: true,
    picture: `PROTOCOL / DISTRIBUTED SYSTEM: draw the machines as a "graph" structure with "variant": "directed" — one node per server or host, its value a short name ("A", "B", "C" or "S1"), and NO edges at the start. Each message is ONE {"op": "link", "from", "to", "label"} on the sentence that sends it (label at most 10 characters: "vote?", "yes", "SYN", "ACK"), and {"op": "unlink"} once it is answered; a role that changes is a pointer tag — only "leader" and "candidate", one per server, never "follower" ({"op": "point", "name": "leader", "to": "b"}), and a crashed or failed machine is {"op": "mark", "id", "as": "remove"} — never written to again. Terms, votes, sequence numbers and timeouts are real values in the variables panel ("term": "2", "votes": "[B, C]"). Never a flow chart of concepts for the protocol itself.`,
  },
  {
    id: "operating-systems",
    mechanism: /\b(?:process(?:es)?|ready queue|frames?|pages?|threads?|locks?|resources?|waits?|holds?|schedul\w*|evict\w*|objects?|roots?|reachable|mark(?:s|ed|ing)?|sweep\w*)\b/i,
    strong: /\b(?:(?:cpu|process|disk) scheduling|scheduling algorithms?|round[- ]robin|first[- ]come,? first[- ]served|fcfs|shortest[- ]job[- ]first|sjf|context switch\w*|page (?:replacement|faults?|tables?)|paging|virtual memory|thrashing|deadlocks?|banker'?s algorithm|mutex(?:es)?|semaphores?|race conditions?|critical sections?|producer[- ]consumer|dining philosophers|multithreading|garbage collect\w*|mark[- ]and[- ]sweep|reference counting|operating systems?|system calls?)\b/i,
    weak: /\b(?:threads?|processes|scheduling|memory allocation|interrupts?)\b/i,
    draws: true,
    picture: `OPERATING SYSTEMS: draw what the OS manages as a structure — for scheduling, the ready queue as a "queue" (processes P1, P2, … enqueued and dequeued one per sentence); for paging and page replacement, the memory frames as an "array" (one cell per frame, {"op": "set"} as each page is loaded, the evicted page marked "remove"); for deadlock, processes and resources as a directed "graph" (link "P1" → "R1" labelled "waits", "R1" → "P2" labelled "held"); for garbage collection, the objects as a directed "graph" with the roots as pointers, reached objects marked "found" and the unreachable ones removed. Clock times, counters and the page-fault count are real values in the variables panel.`,
  },
  {
    id: "automata",
    mechanism: /\b(?:states?|transitions?|accept\w*|reject\w*|inputs?|symbols?|reads?)\b/i,
    strong: /\b(?:finite (?:state )?(?:automat(?:a|on)|machines?)|dfas?|nfas?|nfa to dfa|regular languages?|pushdown automat\w*|turing machines?|state machines?|subset construction)\b/i,
    draws: true,
    picture: `AUTOMATA: draw the machine as a "graph" structure with "variant": "directed" — one node per state ("q0", "q1", …), each transition a link with its symbol as the label ("a", "0,1"), each accepting state marked "found". Reading the input moves a pointer ("now") one state per sentence, and the input is in the variables panel ("input": "abba", "read": "ab").`,
  },
  {
    id: "compilers",
    mechanism: /\b(?:tokens?|pars\w*|trees?|grammars?|rules?|nodes?)\b/i,
    strong: /\b(?:compilers?|lexical analysis|lexers?|tokeni[sz]ation|parse trees?|abstract syntax trees?|recursive descent|ll\(1\)|lr(?:\(\d\))? parsing|shift[- ]reduce|context[- ]free grammars?)\b/i,
    weak: /\b(?:parsing|parsers?|grammars?)\b/i,
    draws: true,
    picture: `COMPILERS: draw the parse or syntax tree as a "tree" structure built one node per sentence ({"op": "add"} with its parent), for ONE short input ("3 + 4 * 2"); the tokens left to read are in the variables panel.`,
  },
  {
    id: "databases",
    strong: /\b(?:normali[sz]ation|normal forms?|[123]nf|bcnf|functional dependenc\w*|sql|relational (?:databases?|algebra|model)|acid (?:properties|transactions?)|database (?:transactions?|index\w*|design)|isolation levels?|query optimi[sz]\w*|entity[- ]relationship|er diagrams?|primary keys?|foreign keys?)\b/i,
    weak: /\b(?:transactions?|joins?|indexes|indexing)\b/i,
    draws: false,
    picture: null,
  },
  {
    id: "theory",
    strong: /\b(?:p (?:vs\.?|versus|=) np|np[- ](?:complete|hard)\w*|np-?completeness|halting problem|computability|decidab\w*|complexity class\w*|turing[- ]complete\w*|master theorem|amortized analysis|asymptotic (?:analysis|notation)|big[- ](?:theta|omega))\b/i,
    draws: false,
    picture: null,
  },
  {
    id: "machine-learning",
    strong: /\b(?:k[- ]means(?: clustering)?|k[- ]nearest neighbou?rs?|knn|backpropagation|back[- ]propagation|neural networks?|perceptrons?|naive bayes|reinforcement learning|q[- ]learning|machine learning|support vector machines?|transformers? (?:models?|architecture)|attention mechanism|convolutional neural|cnns?|rnns?|lstm)\b/i,
    weak: /\b(?:decision trees?|clustering|classifiers?)\b/i,
    draws: false,
    picture: null,
  },
  {
    id: "security",
    strong: /\b(?:rsa (?:encryption|algorithm|cryptography)|diffie[- ]hellman|public[- ]key (?:cryptography|encryption)|symmetric encryption|asymmetric encryption|aes|sha-?\d+|cryptographic hash\w*|digital signatures?|tls handshake|ssl|caesar cipher|vigen[eè]re cipher|encryption algorithms?)\b/i,
    draws: false,
    picture: null,
  },
  {
    id: "architecture",
    strong: /\b(?:instruction pipelin\w*|pipeline hazards?|cache (?:memory|hits?|misses?|coherence|mapping|lines?)|direct[- ]mapped cache|set[- ]associative|memory hierarchy|assembly language|instruction sets?|risc|cisc|alu)\b/i,
    weak: /\b(?:pipelin\w*|registers?)\b/i,
    draws: false,
    picture: null,
  },
];

function familyMatches(f: Family, text: string): boolean {
  return f.strong.test(text) || Boolean(f.weak && f.weak.test(text) && COMPUTING_CONTEXT.test(text));
}

/** The families a lesson's text belongs to, most specific first. */
function familiesOf(text: string): Family[] {
  return FAMILIES.filter((f) => familyMatches(f, text));
}

// "Stacks, arches and stumps", "heaps of sediment", multiplication "arrays": a data-structure word that
// is also an everyday word counts only when something else says computing.
const EVERYDAY = /\b(?:stacks?|queues?|heaps?|arrays?|tries)\b/gi;
const DS_CONTEXT = /\b(?:code|coding|python|java|c\+\+|programs?|programming|algorithms?|data structures?|computer|pointers?|push(?:ing)?|pop(?:ping)?|enqueue|dequeue|index(?:es|ing)?|insert(?:ion)?|delet(?:e|ion)|nodes?|o\(\w+\))\b/i;

/**
 * A typed-prompt lesson that draws a data structure: the shared list (without its everyday words on
 * their own), the graph algorithms, and the niche structures above (string matching, hashing, union-find…).
 */
export function isTypedDsaTopic(text: string | null | undefined): boolean {
  const t = text ?? "";
  if (!t.trim()) return false;
  if (isGraphAlgorithmTopic(t)) return true;
  if (FAMILIES.some((f) => f.draws && familyMatches(f, t))) return true;
  if (!isDataStructureTopic(t)) return false;
  const everydayOnly = !isDataStructureTopic(t.replace(EVERYDAY, " "));
  return !everydayOnly || isCsTopic(t) || DS_CONTEXT.test(t);
}

/** A typed-prompt computer-science lesson: the shared CS check, the data structures, or a niche CS topic. */
export function isTypedCsTopic(text: string | null | undefined): boolean {
  const t = text ?? "";
  if (!t.trim()) return false;
  return isCsTopic(t) || isTypedDsaTopic(t) || familiesOf(t).length > 0;
}

/**
 * A board of a typed CS lesson that shows the mechanism at work (servers voting, bits being set, a
 * pattern sliding): drawn on the structure, never as a flow chart of concepts. Raft was six flow charts
 * (CS test, 2026-10-23).
 */
export function csMechanismBoard(lessonText: string, boardText: string): boolean {
  return familiesOf(lessonText).some((f) => f.draws && f.picture && f.mechanism?.test(boardText));
}

/** What the board draws for this kind of CS topic (said to the board writer), or null. */
export function csPictureRule(text: string | null | undefined): string | null {
  return familiesOf(text ?? "").find((f) => f.picture)?.picture ?? null;
}

/**
 * The plan's rule for a typed CS lesson: each kind of topic's working boards are structure or code
 * boards with its own picture — a protocol is never a flow chart of concepts.
 */
export function csPlanRule(text: string | null | undefined): string | null {
  const fam = familiesOf(text ?? "").find((f) => f.picture && f.draws);
  if (!fam) return null;
  return `THE PICTURE THIS TOPIC NEEDS: every board that shows the ${fam.id.replace(/-/g, " ")} at work is a "structure" board, or a "code" board with the structure beside it — never flow, scene, illustration or sketch for the mechanism itself. Each brief names the concrete input it runs on (the same one across boards).`;
}

/**
 * HOW LONG A NEW CS STUDENT'S LESSON IS (owner, 2026-10-23). Phrased as "How does X work?", union-find,
 * Bloom filters and Raft were each capped at 3 boards as a question, while "Topological sort with
 * Kahn's algorithm" ran to 18 boards with a part that only repeated earlier parts.
 * A question asks for a whole lesson when it names an algorithm, structure or system a typed CS lesson
 * draws or teaches, asks how it works, and is not about the student's own code or one detail of it.
 */
export function isCsMechanismQuestion(question: string): boolean {
  const q = question.trim();
  if (!/^(?:how\s+(?:does|do|is|are|can|would)|explain\s+how|what\s+(?:is|are)|explain|teach\s+me|walk\s+me\s+through)\b/i.test(q)) return false;
  if (/\b(?:my|this|the following)\s+(?:code|program|function|output|error|bug)\b|\bline\s+\d+\b|\b(?:error|bug|exception|traceback)\b/i.test(q)) return false;
  if (q.split(/\s+/).length > 18) return false;
  return isTypedDsaTopic(q) || familiesOf(q).length > 0;
}

export const CS_LESSON_LENGTH = "THIS IS A COMPUTER-SCIENCE LESSON FROM A TYPED PROMPT: usually 5 to 8 subtopics, each teaching something the others do not. Never a subtopic that only repeats, reviews or re-lists earlier ones (\"X steps\", \"putting it together\", \"review of X\") — the full worked trace belongs in ONE subtopic, after the parts it uses.";

// ── Board checks (typed CS lessons) ─────────────────────────────────────────────────────────────

const STATUS = /^(?:not set|unset|not yet set|none yet|n\/?a|tbd|unknown|undefined yet|updated|changed|finished|done|complete[d]?|ready|passed|failed|ok|set|cleared|reset|initiali[sz]ed|computed|counted|not counted|processed|in progress|pending|valid|invalid)$/i;
const REAL_EMPTY = /^(?:none|null|nil|true|false|empty|\[\s*\]|\{\s*\}|""|''|-?\d+(?:\.\d+)?)$/i;

/** Is this variable's value a description or formula rather than the value itself? */
export function isPlaceholderValue(name: string, value: string): boolean {
  const v = value.trim();
  if (!v || REAL_EMPTY.test(v)) return false;
  if (/^["'].*["']$/.test(v)) return false; // a string literal is a real value
  if (STATUS.test(v)) return true;
  if (v.toLowerCase() === name.trim().toLowerCase()) return true; // pattern: "pattern"
  if (/[A-Za-z_]\w*\s*\[[^\]]*[A-Za-z_]/.test(v)) return true; // lps[j − 1], lps[i] = …
  if (/[A-Za-z_]\w*\s*(?:[-+*/%−×÷]|==|=|<=|>=|<|>|←)\s*[\w(]/.test(v)) return true; // i + 1, len - 1
  if (/\b(?:then|until|or|otherwise|whichever)\b/i.test(v) && /[a-z]{3,}/.test(v)) return true; // "A, then C", "falls back or stays zero"
  // A phrase of lower-case words ("array of zeros", "fewer than 6", "no ordering", "next valid text index").
  if (/^[a-z][a-z'-]*(?:\s+[a-z0-9][a-z0-9'-]*)+$/.test(v) && /\s[a-z]{2,}/.test(v)) return true;
  // …or with a name in capitals ("completed LPS array"): two or more lower-case words, no digits or brackets.
  const words = v.split(/\s+/);
  if (words.length >= 2 && !/[\d[\]{}()"',:=]/.test(v) && words.filter((w) => /^[a-z][a-z'-]{2,}$/.test(w)).length >= 2) return true;
  return false;
}

type Stepped = { s: number; state?: Array<{ name: string; value: string }> };

/** The variables whose values are descriptions, not values: "candidate_length = finished". */
export function placeholderProblem(steps: Stepped[]): string | null {
  const bad: string[] = [];
  for (const st of steps) for (const v of st.state ?? []) if (isPlaceholderValue(v.name, v.value) && !bad.some((b) => b.startsWith(`${v.name} = `))) bad.push(`${v.name} = "${v.value}"`);
  if (!bad.length) return null;
  return `the variables panel holds descriptions instead of values (${bad.slice(0, 4).join("; ")}). Trace ONE concrete input and write each variable's ACTUAL value after that step — a number, a character, a list like "[0, 0, 1]", None — never a word like "finished" or "updated", never a formula like "i + 1" (write 2), never a sentence. A variable with no value yet is left out of that step.`;
}

// Boards whose stage is a few labelled things (cards, boxes, nodes): what a student reads as "new writing".
// A sketch, figure or graph draws many strokes for one idea, so only its notes are counted.
const CARD_STAGES = new Set(["flow", "scene", "compare", "structure"]);
// Connectors are part of the thing they join, never a thing of their own.
const CONNECTORS = new Set(["arrows", "edges", "links", "connectors", "lines"]);

/** What appears at each sentence of the board, by sentence index: anything at all, and new writing. */
function revealsBySentence(spec: CanvasBoardSpec): { shown: Map<number, number>; drawn: Map<number, number> } {
  const shown = new Map<number, number>();
  const drawn = new Map<number, number>();
  const add = (m: Map<number, number>, s: number) => m.set(s, (m.get(s) ?? 0) + 1);
  const walk = (v: unknown, count: boolean, key = "") => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, count, key));
    if (!v || typeof v !== "object") return;
    const r = v as Record<string, unknown>;
    if (typeof r.s === "number") {
      add(shown, r.s);
      if (count && !CONNECTORS.has(key)) add(drawn, r.s);
    }
    if (typeof r.hide === "number") add(shown, r.hide);
    for (const [k, x] of Object.entries(r)) if (x && typeof x === "object") walk(x, count, k);
  };
  walk(spec.notes, true);
  walk(spec.stage, CARD_STAGES.has(spec.stage.kind));
  walk(spec.cues, false); // a cue (zoom, point, underline) moves the board, but writes nothing new
  return { shown, drawn };
}

/**
 * SPOKEN BUT NOT WRITTEN (Gulwarina, 2026-10-22: "aria was speaking however whatever it was saying was
 * not being written down"). A Bloom-filter board said three sentences with nothing appearing, then
 * dropped four notes and the whole diagram on the last one. A board with more than one silent sentence,
 * or one sentence that brings in more than three things at once, is sent back.
 */
export function syncProblem(spec: CanvasBoardSpec, script: string): string | null {
  if (spec.stage.kind === "exam") return null;
  const n = canvasSentences(script).length;
  if (n < 3) return null;
  const { shown, drawn } = revealsBySentence(spec);
  const silent = Array.from({ length: n }, (_, i) => i).filter((i) => !shown.get(i));
  const crowded = Array.from({ length: n }, (_, i) => i).filter((i) => (drawn.get(i) ?? 0) > 3);
  const parts: string[] = [];
  if (silent.length > 1) parts.push(`Aria says sentences ${silent.map((i) => i + 1).join(", ")} while nothing new appears on the board: give each of them the note, value, step or label it states, on that sentence`);
  if (crowded.length) parts.push(`sentence ${crowded.map((i) => i + 1).join(", ")} brings in ${crowded.map((i) => drawn.get(i)).join(", ")} things at once: reveal each one on the sentence that says it — at most 2 or 3 new things per sentence`);
  return parts.length ? `the board does not keep pace with Aria: ${parts.join("; ")}.` : null;
}

/** A structure, as what a student sees: its values and its links between values. */
type Shape = { kind: string; values: string; links: string };

function shapeOf(kind: string, directed: boolean, nodes: Array<{ id: string; value: string }>, edges: Array<{ from: string; to: string }>): Shape {
  // "C (1)" is still C: a count or note written beside a node's name is not a different node.
  const val = new Map(nodes.map((n) => [n.id, n.value.trim().replace(/\s*[(:=].*$/, "").toUpperCase()]));
  const values = [...val.values()].sort().join(",");
  const links = edges
    .map((e) => [val.get(e.from) ?? e.from, val.get(e.to) ?? e.to])
    .map(([a, b]) => (directed || kind === "list" || kind === "tree" ? `${a}>${b}` : [a, b].sort().join("-")))
    .sort()
    .join(",");
  return { kind, values, links };
}

/** What the lesson's earlier boards drew: each structure as it started and as it ended. */
export type EarlierStructure = { start: DsStart; steps: Array<{ s: number; ops?: DsOp[] }> };

export function earlierStructures(specs: Array<CanvasBoardSpec | undefined>): EarlierStructure[] {
  return specs.flatMap((sp) => {
    const st = sp?.stage;
    if (!st || (st.kind !== "code" && st.kind !== "structure") || !st.structure) return [];
    return [{ start: st.structure, steps: st.steps }];
  });
}

const NEW_EXAMPLE = /\b(?:new|another|different|second|separate|other|bigger|smaller|modified|changed?) (?:example|graph|tree|list|array|input|case)\b|\b(?:add(?:ing|s)?|remov(?:e|ing|es)|insert(?:ing|s)?|delet(?:e|ing|es)) (?:an? |one )?(?:edge|arrow|node|vertex|link|element)\b|\bcycle\b|\bnow (?:suppose|imagine|consider)\b|\bwhat if\b/i;

/**
 * ONE EXAMPLE THROUGH THE LESSON (Kahn's algorithm, 2026-10-23: the narration kept saying "the same
 * graph", and the boards drew three different graphs). A board whose structure matches none of the
 * earlier boards' structures (as they started or as they ended) is sent back, unless Aria says it is a
 * new or changed example.
 */
export function exampleProblem(drawn: DsStart, earlier: EarlierStructure[], script: string): string | null {
  // Graphs, trees and lists are "the example"; an array's or queue's cells change value by design (bits set).
  if (drawn.kind !== "graph" && drawn.kind !== "tree" && drawn.kind !== "list") return null;
  const directed = drawn.variant === "directed";
  const same = earlier.filter((e) => e.start.kind === drawn.kind);
  if (!same.length || NEW_EXAMPLE.test(script)) return null;
  const mine = shapeOf(drawn.kind, directed, drawn.nodes, drawn.edges);
  const seen: Shape[] = same.flatMap((e) => {
    const d = e.start.variant === "directed";
    const out = [shapeOf(e.start.kind, d, e.start.nodes, e.start.edges)];
    const { frames } = runStructure(e.start, e.steps);
    const last = frames.at(-1);
    if (last) out.push(shapeOf(e.start.kind, d, last.nodes, last.edges));
    return out;
  });
  if (seen.some((s) => s.values === mine.values && s.links === mine.links)) return null;
  const first = seen[0];
  // Only the same kind of thing with the same names is "the example": a lesson that moved to a list
  // of numbers from a graph of letters is checked by the plan, not here.
  if (!seen.some((s) => s.values === mine.values) && first.values.split(",").length && mine.values.split(",").every((v) => !first.values.split(",").includes(v))) return null;
  return `this board draws a different ${drawn.kind} (${mine.values}; ${mine.links || "no links"}) from the lesson's example (${first.values}; ${first.links || "no links"}). The student follows ONE example through the lecture: draw exactly the example's nodes and links as the earlier board left them — or, if this board really needs a new or changed example, have Aria say so ("now add an edge from D to B", "a new example").`;
}

/**
 * A PARENT POINTER MOVES (union-find, CS test 2026-10-23): path compression drew E's new link to the
 * root beside its old link to D, so E had two parents. In a union-find lesson, a node with two parent
 * links at any step sends the board back.
 */
export function parentForestProblem(lessonText: string, start: DsStart, steps: Array<{ s: number; ops?: DsOp[] }>): string | null {
  if (start.kind !== "graph" || !familiesOf(lessonText).some((f) => f.id === "union-find")) return null;
  const { frames } = runStructure(start, steps);
  for (const frame of frames) {
    const out = new Map<string, number>();
    for (const e of frame.edges) out.set(e.from, (out.get(e.from) ?? 0) + 1);
    const two = [...out.entries()].find(([, n]) => n > 1);
    if (two) {
      const name = frame.nodes.find((n) => n.id === two[0])?.value ?? two[0];
      return `${name} has two parent links at one step: a node has exactly ONE parent. When its parent changes, the same step unlinks the old parent ({"op": "unlink", "from", "to"}) and links the new one, so the arrow moves.`;
    }
  }
  return null;
}

/**
 * MESSAGES ARE ARROWS THAT APPEAR (Raft, CS test 2026-10-23): the writer drew the five servers already
 * joined in a full mesh, so no vote or heartbeat could be seen arriving and a board ended as a tangle.
 * In a protocol lesson the servers start with no links; each message is a link on its sentence.
 */
export function protocolStartProblem(lessonText: string, start: DsStart, steps: Array<{ s: number; ops?: DsOp[] }> = []): string | null {
  if (start.kind !== "graph" || !familiesOf(lessonText).some((f) => f.id === "protocols")) return null;
  if (start.edges.length > 0) return `the servers start already joined by ${start.edges.length} link(s): start with NO links ("edges": []), and draw each message as ONE {"op": "link", "from", "to", "label"} on the sentence that sends it ({"op": "unlink"} once it is answered), so the student sees every vote and heartbeat arrive.`;
  // A message is named by what it says: arrows labelled "link" (or nothing) taught nothing (Raft, 2026-10-23).
  const unnamed = steps.flatMap((st) => st.ops ?? []).filter((o): o is Extract<DsOp, { op: "link" }> => o.op === "link" && (!o.label?.trim() || /^(?:link|edge|message|msg|arrow)$/i.test(o.label.trim())));
  if (unnamed.length) return `${unnamed.length} message arrow(s) have no name: give every {"op": "link"} the message it carries as its "label" ("vote?", "yes", "heartbeat", "SYN", "ACK"), never "link".`;
  // One role tag per server: "leader", "follower" and "candidate" all on B printed over each other.
  const roles = new Map<string, Set<string>>();
  for (const o of steps.flatMap((st) => st.ops ?? [])) if (o.op === "point" && o.to && /^(?:leader|follower|candidate)s?$/i.test(o.name)) (roles.get(o.to) ?? roles.set(o.to, new Set()).get(o.to)!).add(o.name.toLowerCase());
  if ([...roles.values()].some((s) => s.has("follower"))) return `a follower is the normal state: give no "follower" tag. Only the leader and a candidate carry a role tag ({"op": "point", "name": "candidate", "to": "b"}), and a server's tag moves when its role changes.`;
  return null;
}
