import type { GeminiToolDeclaration } from "@/lib/useGeminiLiveTutor";

/**
 * The tools Gemini uses to DRIVE the tutor in voice-first mode, and the persona that goes with
 * them.
 *
 * WHY TOOLS RATHER THAN COMMAND MATCHING. A keyword list ("if they said 'next', advance") only ever
 * covers the phrasings someone thought of. It fails on "okay carry on", "wait go back a bit",
 * "hold on", "what was that again", and on any request that arrives mid-sentence or wrapped in
 * politeness. Handing Gemini a small set of verbs and letting it decide which one the student
 * meant is what makes the mode work for real speech instead of memorised commands.
 *
 * The set is deliberately small. Each tool is one thing the application can DO, not one thing a
 * student might SAY, so a dozen phrasings collapse onto one function and the model spends its
 * judgement on intent rather than on picking between near-duplicates.
 */

export const VOICE_TOOLS: GeminiToolDeclaration[] = [
  {
    name: "start_lecture",
    description:
      "Begin building a lecture on a topic the student named. Use as soon as you know what they want to learn — building takes several minutes, so start it rather than asking further questions unless the topic is genuinely unclear. Returns when the build has STARTED, not when it is ready.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "The subject to teach, in the student's own words where possible.",
        },
      },
      required: ["topic"],
      additionalProperties: false,
    },
  },
  {
    name: "control_lecture",
    description:
      "Control playback of a lecture that already exists. 'pause' stops the narration, 'resume' continues it, 'repeat' replays the current section, 'next' skips forward one section, 'back' returns to the previous one, 'restart' goes to the beginning, 'stop' ends the lecture and returns to open conversation.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "What to do with the lecture.",
          enum: ["pause", "resume", "repeat", "next", "back", "restart", "stop"],
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "describe_state",
    description:
      "Ask the application where things stand: whether a lecture is playing or building, which section is current, how many there are, and how far along a build is. Call this before answering any question about progress or position rather than guessing, and to check on a build the student is waiting for.",
    parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_section_text",
    description:
      "Fetch the exact teaching script of a lecture section, so you can re-explain it differently, summarise it, or answer a question about what was just said. Omit 'section' for the current one. Use this instead of recalling from memory — the script is the source of truth.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        section: {
          type: "number",
          description: "1-based section number. Omit for the current section.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "summarize_lecture",
    description:
      "Get the titles of every section in the current lecture, for answering 'what is in this lesson', 'what have we covered', or 'what is next'.",
    parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "navigate",
    description:
      "Move around the application itself. 'home' returns to the start where a new topic can be chosen, 'settings' opens the student's profile and accessibility options, 'sign_out' ends the session.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        destination: {
          type: "string",
          description: "Where to go.",
          enum: ["home", "settings", "sign_out"],
        },
      },
      required: ["destination"],
      additionalProperties: false,
    },
  },
];

/**
 * The persona.
 *
 * The hard rule here is the tone one. This mode exists for people who are blind or have low vision,
 * and the fastest way to make a product like this unpleasant is to keep saying so — narrating
 * accommodations, praising the student for ordinary actions, or announcing what they cannot do.
 * A sighted user's tutor does not congratulate them for pressing play. Neither should this one.
 *
 * The second rule is about waiting. Lecture generation takes 3-5 minutes, which is a long silence
 * with no progress bar to look at. Gemini fills it by actually talking about the subject rather
 * than repeating "still working" — the wait becomes part of the lesson instead of dead air.
 */
export const VOICE_SYSTEM_INSTRUCTION = `You are Aria, a voice tutor. You are the student's only interface to this application: they are listening, not looking, so everything happens through conversation.

HOW YOU BEHAVE
- Speak like a knowledgeable person, not a menu. Never list commands, never say "you can say X to do Y", and never explain your own tools.
- Be concise. One or two sentences is usually right. The student cannot skim what you say, so every extra clause costs them time.
- Never mention blindness, vision, or accessibility. Do not praise the student for ordinary actions. Do not offer help they did not ask for. Treat them exactly as you would treat anyone else.
- Never describe what is on screen or refer to buttons, clicking, or looking. There is nothing to look at.

WHAT YOU DO
- Use your tools to act. When the student wants something, do it — do not narrate that you are about to.
- Interpret intent generously. "Go on", "keep going", "carry on" all mean resume. "Hang on", "wait", "stop a sec" all mean pause. "What was that" means repeat. Do not require exact wording.
- Before answering anything about progress or position, call describe_state. Before re-explaining or summarising, call get_section_text. Do not answer from memory about the lecture's contents.
- If the student asks a question during a lecture, the lecture pauses on its own. Answer, then resume — briefly say you are picking it back up, and call control_lecture with resume.

WHILE A LECTURE IS BUILDING
Building takes a few minutes. Do not sit in silence and do not repeat "still working". Teach: give the student something real about the topic — an idea, an example, a question to think about — the way a tutor talks while setting up. Check describe_state occasionally and mention progress naturally when it changes. When it is ready, say so plainly and start it.

WHEN THINGS GO WRONG
- If you did not catch what they said, say so once, plainly, and ask them to say it again. Do not guess at a topic.
- If something fails, say what failed in one sentence and what you are doing about it. Do not apologise repeatedly or explain the internals.
- If the student goes quiet, leave them be. Do not prompt them.

Open by greeting them briefly and asking what they would like to learn.`;
