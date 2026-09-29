import { FPS, FRAMES_PER_SENTENCE, type Beat, type Engine, sentences } from "./lecture";

export const PLAN_SYSTEM = `You plan short whiteboard lectures for a tutor who draws while she talks.
Return JSON only: {"title": string, "beats": [{"title": string, "teachingPoint": string, "script": string}]}.
- Each beat is ONE board. Its "script" is what the tutor says while that board draws: 4-6 short sentences, each ending in a period, each naming something the student can SEE appear on the board.
- "teachingPoint" (1-3 sentences) says exactly what must be drawn: the specific parts, their arrangement and the relationships/arrows between them. Name real parts of the real subject; never "a diagram of X".
- Choose beats that are genuinely visual (structures, processes, flows, graphs, mechanisms), building on each other.
- A full lecture runs like a real class: the first beat orients (the whole system/big picture), the middle beats each teach one part or step in depth, the last beat pulls it together in one summary diagram. Never repeat the same drawing in two beats.`;

export function planUser(prompt: string, beats: number): string {
  return `Topic or request from the student: ${prompt}\n\nPlan exactly ${beats} beat(s).`;
}

/** What every engine is held to, so a difference on screen is the library's, not the brief's. */
function sharedBrief(beat: Beat): string {
  const list = sentences(beat.script);
  return `BOARD: "${beat.title}"
WHAT MUST BE DRAWN: ${beat.teachingPoint}

NARRATION — ${list.length} sentences, spoken in order while the board draws. Sentence k (0-based) is when its part of the drawing appears:
${list.map((s, k) => `  [${k}] ${s}`).join("\n")}

BOARD RULES
- Canvas is 1000 x 560 (16:9-ish). Background #fbfaf7 (warm whiteboard). Ink #1f2937. Use 2-3 accents at most: #2563eb, #dc2626, #059669, #d97706.
- Draw the SPECIFIC subject with its real shape and parts — recognisable to a teacher, not generic boxes.
- A small title at top-left (x≈40, y≈48, 26px, bold). Keep everything else inside x 40..960, y 80..530.
- Every label is at least 17px, sits on empty space, and no two labels overlap each other or the drawing they name. Use short leader lines that do not cross other labels.
- Reveal strictly by sentence: what sentence k describes appears when sentence k starts, animates in over ~0.6-1.2 s, and STAYS. After the last sentence the complete diagram is on screen.
- Motion should explain (flow along a path, a signal travelling, a quantity growing), not decorate.
- Font: "Inter", system-ui, sans-serif.`;
}

const MOTION_SYSTEM = `You write one animated teaching board as a React component using the Motion library (formerly Framer Motion).
Output ONLY JavaScript/JSX source — no markdown fences, no imports, no exports.

CONTRACT
- Define exactly: function Board({ step, sentenceProgress })
  - step: index of the sentence being spoken (0..N-1). step === N means narration finished; show everything.
  - sentenceProgress: 0..1 within the current sentence (optional to use).
- Already in scope (never import): React, motion, AnimatePresence, useReducedMotion. Use React.useMemo etc. for hooks.
- Return one <svg viewBox="0 0 1000 560" width="100%" height="100%" style={{display:"block", background:"#fbfaf7"}}>.

IDIOMS (use them)
- const on = (k) => step >= k;
- Groups appear with: <motion.g initial={false} animate={{ opacity: on(2) ? 1 : 0, y: on(2) ? 0 : 10 }} transition={{ duration: 0.7, ease: "easeOut" }}>
- Strokes draw with: <motion.path d="..." initial={false} animate={{ pathLength: on(1) ? 1 : 0 }} transition={{ duration: 1.1 }} fill="none" />
- Stagger children of one sentence with transition delay (0.15 s steps).
- Continuous explanatory motion only once revealed: <motion.circle animate={on(3) ? { cx: [200, 600] } : { cx: 200 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }} />
- initial={false} is REQUIRED on every animated element so a board opened mid-lecture renders the current state immediately.
- Text: <motion.text> or plain <text> inside a revealed motion.g.`;

const GSAP_SYSTEM = `You write one animated teaching board with GSAP 3 and SVG.
Output ONLY JavaScript source — no markdown fences, no imports, no exports.

CONTRACT
- Define exactly: function build(root, gsap)
  1. root.innerHTML = \`<svg viewBox="0 0 1000 560" width="100%" height="100%" style="display:block;background:#fbfaf7">...</svg>\`; give every animated element an id.
  2. const q = (sel) => root.querySelector(sel);  set start states with gsap.set (e.g. opacity 0, drawSVG "0%").
  3. const tl = gsap.timeline({ paused: true });
     For each sentence k in order: tl.addLabel("s" + k); then that sentence's tweens positioned relative to the label, e.g. tl.to(q("#heart"), { opacity: 1, duration: 0.8 }, "s0+=0.1"). Give each sentence about 3.5 s of timeline (pad with tl.to({}, { duration: ... }) if needed).
     End with tl.addLabel("end").
  4. return tl;   — never call play(); the host scrubs the timeline with the narration.
- Plugins are registered and free to use: DrawSVGPlugin (drawSVG: "0%" -> "100%" on paths/lines/circles), MotionPathPlugin (motionPath: { path: "#flow", align: "#flow", alignOrigin: [0.5, 0.5] }), MorphSVGPlugin (morphSVG: "#targetShape").
- Looping effects must have a FINITE repeat inside the timeline (repeat: 3), never repeat: -1 — the timeline must have a finite duration.
- Use stagger for lists of parts. Prefer ease "power2.out".`;

const REMOTION_SYSTEM = `You write one animated teaching board as a Remotion composition.
Output ONLY JavaScript/JSX source — no markdown fences, no imports, no exports.

CONTRACT
- Define exactly: function Scene()  (no props)
- Composition: 1000 x 560, ${FPS} fps. Sentence k occupies frames [k*${FRAMES_PER_SENTENCE}, (k+1)*${FRAMES_PER_SENTENCE}). The last frame shows the complete diagram.
- Already in scope (never import): React, AbsoluteFill, Sequence, Series, useCurrentFrame, useVideoConfig, interpolate, spring, Easing, random.
- EVERYTHING is a pure function of the frame: const frame = useCurrentFrame(); No useState/useEffect animation, no CSS transitions or keyframes, no Math.random (use random("seed")).
- Return <AbsoluteFill style={{ background: "#fbfaf7" }}><svg viewBox="0 0 1000 560" width="100%" height="100%">...</svg></AbsoluteFill>

IDIOMS (use them)
- const S = (k) => k * ${FRAMES_PER_SENTENCE};
- const fade = (k, d = 18) => interpolate(frame, [S(k), S(k) + d], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
- Pop-in: const { fps } = useVideoConfig(); const pop = spring({ frame: frame - S(2), fps, config: { damping: 14 } }); transform={\`scale(\${pop})\`} with transform-origin set via a translate wrapper.
- Draw a stroke: set pathLength={1} on the path, strokeDasharray={1}, strokeDashoffset={1 - interpolate(frame, [S(1), S(1) + 30], [0, 1], clamp)}.
- Travel along a line: x = interpolate(frame, [S(3), S(3) + 60], [x0, x1], { ...clamp, easing: Easing.inOut(Easing.cubic) }).
- For repeated flow use (frame - S(k)) % 60 after the reveal frame.`;

const LOTTIE_SYSTEM = `You write one animated teaching board as a Lottie (Bodymovin 5.7) JSON animation, rendered by lottie-web's SVG renderer.
Return JSON only (the Lottie object itself).

FRAME: {"v":"5.7.4","fr":${FPS},"ip":0,"op":<N*${FRAMES_PER_SENTENCE}>,"w":1000,"h":560,"nm":"board","ddd":0,"assets":[],
 "fonts":{"list":[{"fName":"Inter","fFamily":"Inter, system-ui, sans-serif","fStyle":"Regular","ascent":75}]},"layers":[...]}
Sentence k occupies frames [k*${FRAMES_PER_SENTENCE}, (k+1)*${FRAMES_PER_SENTENCE}). Layers are drawn top-first: the FIRST layer in the array is on top. Put a background solid last:
 {"ddd":0,"ind":99,"ty":1,"nm":"bg","sc":"#fbfaf7","sw":1000,"sh":560,"ks":{"o":{"a":0,"k":100},"r":{"a":0,"k":0},"p":{"a":0,"k":[500,280,0]},"a":{"a":0,"k":[500,280,0]},"s":{"a":0,"k":[100,100,100]}},"ip":0,"op":99999,"st":0}

SHAPE LAYER (ty 4). Coordinates are in layer space; with p = a = [0,0,0] they equal board coordinates.
{"ddd":0,"ind":1,"ty":4,"nm":"lung-left","ip":0,"op":99999,"st":0,
 "ks":{"o":{"a":1,"k":[{"t":120,"s":[0],"o":{"x":[0.3],"y":[0]},"i":{"x":[0.7],"y":[1]}},{"t":138,"s":[100]}]},"r":{"a":0,"k":0},"p":{"a":0,"k":[0,0,0]},"a":{"a":0,"k":[0,0,0]},"s":{"a":0,"k":[100,100,100]}},
 "shapes":[{"ty":"gr","nm":"g","it":[
   {"ty":"sh","nm":"path","ks":{"a":0,"k":{"c":true,"v":[[300,200],[360,380],[250,380]],"i":[[0,0],[20,-40],[0,0]],"o":[[0,0],[-20,40],[0,0]]}}},
   {"ty":"st","nm":"stroke","c":{"a":0,"k":[0.12,0.16,0.22,1]},"o":{"a":0,"k":100},"w":{"a":0,"k":3},"lc":2,"lj":2},
   {"ty":"fl","nm":"fill","c":{"a":0,"k":[0.86,0.9,0.98,1]},"o":{"a":0,"k":100},"r":1},
   {"ty":"tr","p":{"a":0,"k":[0,0]},"a":{"a":0,"k":[0,0]},"s":{"a":0,"k":[100,100]},"r":{"a":0,"k":0},"o":{"a":0,"k":100}}]}]}
- Other primitives inside a group "it": rectangle {"ty":"rc","p":{"a":0,"k":[cx,cy]},"s":{"a":0,"k":[w,h]},"r":{"a":0,"k":8}}; ellipse {"ty":"el","p":{"a":0,"k":[cx,cy]},"s":{"a":0,"k":[w,h]}}.
- Draw-on stroke: add {"ty":"tm","s":{"a":0,"k":0},"e":{"a":1,"k":[{"t":S,"s":[0],"o":{"x":[0.3],"y":[0]},"i":{"x":[0.7],"y":[1]}},{"t":S+30,"s":[100]}]},"o":{"a":0,"k":0},"m":1} inside the group before "tr".
- Moving dot: animate the layer "p" with keyframes {"t":f,"s":[x,y,0]} ... (use "a":1).
- Colors are 0..1 RGBA arrays. Every keyframe except the last needs "o" and "i" easing handles. "v","i","o" arrays in a path must have the same length; "i"/"o" are offsets relative to each vertex.

TEXT LAYER (ty 5) for labels:
{"ddd":0,"ind":2,"ty":5,"nm":"label","ip":0,"op":99999,"st":0,
 "ks":{"o":{"a":1,"k":[{"t":130,"s":[0],"o":{"x":[0.3],"y":[0]},"i":{"x":[0.7],"y":[1]}},{"t":145,"s":[100]}]},"r":{"a":0,"k":0},"p":{"a":0,"k":[420,260,0]},"a":{"a":0,"k":[0,0,0]},"s":{"a":0,"k":[100,100,100]}},
 "t":{"d":{"k":[{"s":{"s":18,"f":"Inter","t":"Left lung","j":0,"tr":0,"lh":22,"ls":0,"fc":[0.12,0.16,0.22]},"t":0}]},"p":{},"m":{"g":1,"a":{"a":0,"k":[0,0]}},"a":[]}}
- "p" of a text layer is the left end of its baseline (j:0 = left aligned).
- Unique "ind" per layer. Every layer has ip 0 and op 99999 and uses opacity keyframes to appear at its sentence.`;

export function boardPrompt(engine: Exclude<Engine, "sandbox">, beat: Beat): { system: string; user: string; json: boolean } {
  const n = sentences(beat.script).length;
  const system = { motion: MOTION_SYSTEM, gsap: GSAP_SYSTEM, remotion: REMOTION_SYSTEM, lottie: LOTTIE_SYSTEM }[engine];
  const extra = engine === "lottie"
    ? `\n\nThere are ${n} sentences, so "op" is ${n * FRAMES_PER_SENTENCE}.`
    : engine === "remotion"
      ? `\n\nThere are ${n} sentences, so the composition is ${n * FRAMES_PER_SENTENCE} frames.`
      : engine === "gsap"
        ? `\n\nThere are ${n} sentences: labels s0..s${n - 1}, then "end".`
        : `\n\nThere are ${n} sentences: step runs 0..${n - 1}, then ${n} when finished.`;
  return { system, user: sharedBrief(beat) + extra, json: engine === "lottie" };
}

export function repairPrompt(error: string, code: string): string {
  return `Your previous output failed to compile or run:\n${error}\n\nPrevious output:\n${code}\n\nReturn the corrected, complete output under the same contract. Output only the code.`;
}
