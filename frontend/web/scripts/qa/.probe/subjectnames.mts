import { readFileSync } from "node:fs";
import { courseSubjectKind } from "../../../lib/canvas/lessonSubject";
const names = [...new Set((JSON.parse(readFileSync("data/curricula/catalog.json", "utf8")).entries as Array<{ subject: string }>).map((e) => e.subject))].sort();
const by = (k: string | null) => names.filter((n) => courseSubjectKind(n) === k);
console.log("MATHS:", by("maths").join(" | "));
console.log("\nCS:", by("cs").join(" | "));
console.log("\nMIXED (lesson title decides):", by(null).join(" | "));
const other = by("other");
console.log(`\nOTHER: ${other.length} names; those with a maths/computing-looking word:`, other.filter((n) => /math|stat|calcul|algebra|geometr|comput|digital|data|cyber|program|robot|technolog/i.test(n)).join(" | "));
