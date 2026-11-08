import type { CanvasBoardSpec } from "./types";
import { validateBlocks } from "./blocks";

/** Hand-written full boards, one of every block kind, for /canvas-lab?fixture=blocks (free). */
const SCRIPT = [
  "Speed tells us how far something travels in one second.",
  "A car goes 100 metres in 5 seconds.",
  "To find its speed, we divide the distance by the time, because speed is distance for each second.",
  "So the speed is 100 divided by 5, which is 20 metres per second.",
  "Here is the formula: v equals d divided by t.",
  "A common mistake is to multiply distance by time.",
  "That gives the wrong unit, metres times seconds, so always check the unit.",
  "Now compare two runners.",
  "Ali runs 200 metres in 25 seconds, and Sara runs 100 metres in 10 seconds.",
  "Sara is faster.",
  "In code, we store the answer in a variable.",
  "What is the speed of a bus that goes 60 metres in 3 seconds?",
  "It is 20 metres per second, because 60 divided by 3 is 20.",
].join(" ");

const URDU = "فاعل وہ ہے جو کام کرتا ہے۔ علی کھیلتا ہے۔ یہاں علی فاعل ہے، کیونکہ کھیلنے کا کام علی کر رہا ہے۔ جمع فاعل کے ساتھ فعل بھی جمع ہوتا ہے۔";

const RAW = { blocks: [
  { kind: "definition", s: 0, e: 0, board_text: "**Speed** is how far something travels in one second." },
  { kind: "steps", s: 1, e: 3, board_text: "", items: ["A car goes 100 metres in 5 seconds.", "To find its speed, divide the distance by the time, because speed is distance for each second.", "Speed = 100 ÷ 5 = **20 metres per second**."] },
  { kind: "formula", s: 4, e: 4, board_text: "v = d / t", tex: "v = \\frac{d}{t}", where: ["$v$ is the speed in metres per second", "$d$ is the distance in metres", "$t$ is the time in seconds"] },
  { kind: "callout", callout: "mistake", s: 5, e: 6, board_text: "Multiplying distance by time gives the wrong unit, metres times seconds. Always check the unit." },
  { kind: "table", s: 7, e: 9, board_text: "Two runners", columns: ["Runner", "Distance", "Time", "Speed"], rows: [["Ali", "200 m", "25 s", "8 m/s"], ["Sara", "100 m", "10 s", "10 m/s"]] },
  { kind: "callout", callout: "key_idea", s: 9, e: 9, board_text: "**Sara is faster**, even though Ali ran further." },
  { kind: "code", s: 10, e: 10, board_text: "", code: ["distance = 100  # metres", "time = 5        # seconds", "speed = distance / time", "print(speed)    # 20.0"] },
  { kind: "question", s: 11, e: 11, board_text: "What is the speed of a bus that goes 60 metres in 3 seconds?" },
  { kind: "answer_reveal", s: 12, e: 12, board_text: "20 metres per second, because 60 ÷ 3 = 20." },
] };

export const BLOCK_FIXTURES: Array<{ id: string; script: string; spec: CanvasBoardSpec }> = [{
  id: "blocks1",
  script: SCRIPT,
  spec: { v: 1, heading: "Speed: the rule and a check", notes: [], course: true, subject: "other", stage: { kind: "sketch", items: [] }, cues: [], blocks: validateBlocks(RAW, "blocks1", SCRIPT).blocks } as CanvasBoardSpec,
}, {
  id: "blocks2",
  script: URDU,
  spec: { v: 1, heading: "فعل اور فاعل", notes: [], course: true, subject: "other", stage: { kind: "sketch", items: [] }, cues: [], blocks: validateBlocks({ blocks: [
    { kind: "definition", s: 0, board_text: "**فاعل** وہ ہے جو کام کرتا ہے۔" },
    { kind: "steps", s: 1, e: 2, board_text: "", items: ["علی کھیلتا ہے۔", "یہاں علی فاعل ہے، کیونکہ کھیلنے کا کام علی کر رہا ہے۔"] },
    { kind: "callout", callout: "remember", s: 3, board_text: "جمع فاعل کے ساتھ فعل بھی جمع ہوتا ہے۔" },
  ] }, "blocks2", URDU).blocks } as CanvasBoardSpec,
}];
