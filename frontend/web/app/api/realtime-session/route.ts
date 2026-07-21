import { NextResponse } from "next/server";

/**
 * Mints a SHORT-LIVED ephemeral token for an OpenAI Realtime (speech-to-speech) session so the
 * browser can open a WebRTC connection directly to OpenAI WITHOUT ever seeing OPENAI_API_KEY.
 * The client posts the current lecture context; we bake the tutor persona + topic + beat + mood
 * into the session `instructions` and expose a `show_board` function tool the tutor can call to
 * draw an explanation board on screen.
 *
 * Uses a raw fetch to POST /v1/realtime/client_secrets — the CURRENT ephemeral-token endpoint.
 * (The installed openai SDK's `beta.realtime.sessions.create()` targets the older, now-404
 * /v1/realtime/sessions path, so we call the API directly.)
 *
 * Server-side only. 503 without a key, 404 when the feature flag is off (dark by default).
 * Honesty: realtime speech-to-speech is billed for the whole open-mic session — the client
 * enforces idle + max-duration timeouts on top of this.
 */
const REALTIME_ENABLED = process.env.REALTIME_TUTOR_ENABLED === "1";
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
// `marin` / `cedar` are the newer, most natural-sounding GA realtime voices; alloy is the flat
// default. Warmer voice does most of the "sounds human" work.
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE ?? "marin";

const TUTOR_PERSONA =
  "You are Aria — a warm, sharp friend who happens to be great at explaining things, talking live " +
  "with one student. This is a REAL casual conversation, not a lecture and not a customer-service " +
  "bot. Sound like a person: \n" +
  "- Talk in SHORT bursts — usually one or two sentences, then stop and let them react. Never " +
  "monologue. If there's more to say, say a bit and ask 'want me to keep going?'\n" +
  "- Use natural, casual spoken language: contractions (you're, it's, that's), everyday words, the " +
  "odd little reaction ('oh nice', 'yeah exactly', 'hmm, good question', 'right'). React to what " +
  "they say before answering.\n" +
  "- Vary your rhythm. Don't start every reply the same way. Sometimes just answer in a few words.\n" +
  "- NEVER read like written text or say things like 'As an AI' or 'I can help you with that.' No " +
  "bullet points, no numbered lists out loud, no headings.\n" +
  "- If they cut you off or start talking, STOP immediately and listen — don't finish your sentence.\n" +
  "- Be encouraging and human, never stern, theatrical, or condescending.\n" +
  "Answer their actual question first, concisely, then check if they want more. Stay within the " +
  "current lecture's topic; if they drift far off, gently bring it back.\n" +
  "MOSTLY JUST TALK — answer with your voice. Only draw on the board when the student EXPLICITLY " +
  "asks to see, draw, visualize, sketch, or show something, OR when a quick diagram is genuinely " +
  "essential to their specific question. Do NOT draw for every answer, for greetings, or for simple " +
  "verbal questions — most turns need no board. When you do draw, call `show_board` with a short " +
  "concept, then talk them through it naturally as it appears.";

const SHOW_BOARD_TOOL = {
  type: "function" as const,
  name: "show_board",
  description:
    "Draw a fresh explanation board (a chalk-style diagram) for a concept the student asked to " +
    "see or that would be clearer as a visual, then narrate it. Use for 'show me...', 'draw...', " +
    "'what does X look like', or when a diagram would help.",
  parameters: {
    type: "object",
    properties: {
      concept: {
        type: "string",
        description: "The concept or question to diagram, as a short phrase (e.g. 'the water cycle').",
      },
    },
    required: ["concept"],
  },
};

// Lecture-control tools (ADHD always-on mode): let the tutor pause/resume the scripted lecture,
// e.g. after nudging a drifted student.
const PAUSE_LECTURE_TOOL = {
  type: "function" as const,
  name: "pause_lecture",
  description:
    "Pause the scripted lecture playback. Call this when the student seems distracted, asks you to " +
    "wait/stop, or when you're about to explain something and want the lecture to hold.",
  parameters: { type: "object", properties: {}, required: [] },
};
const RESUME_LECTURE_TOOL = {
  type: "function" as const,
  name: "resume_lecture",
  description:
    "Resume the scripted lecture playback from where it paused. Call this when the student says " +
    "they're ready to continue, or after you've finished a side-explanation.",
  parameters: { type: "object", properties: {}, required: [] },
};

const ADHD_ADDENDUM =
  "\n\nThis is an ADHD learning session and your mic is ALWAYS ON during the lecture. Stay quiet " +
  "while the lecture narration is playing — only speak when the student talks to you, or when you're " +
  "told the student's focus has drifted. If you're told their focus drifted, warmly and briefly get " +
  "their attention with ONE short line — tell them their focus is drifting so you're pausing the " +
  "lecture, and to let you know when they want to resume (do NOT offer a recap or ask other " +
  "questions) — and call `pause_lecture` so the lecture holds. " +
  "When the student says they're ready to continue, say AT MOST a tiny acknowledgement like 'Sure!' " +
  "(or nothing at all), then call `resume_lecture` — and IMMEDIATELY GO SILENT. Once the lecture " +
  "resumes, the LECTURE does the talking, not you. Do NOT narrate, summarize, add commentary, or keep " +
  "explaining after resuming — stay completely quiet until the student speaks to you again. " +
  "You can pause/resume the lecture anytime with those tools. When you draw with `show_board`, it is " +
  "a SIMPLE chalk-text board — keep the concept short and explain it in plain words.";

function buildInstructions(topic: string, beatContext: string, mood: string, adhd: boolean): string {
  const parts = [TUTOR_PERSONA, `The lecture topic is: ${topic || "this lesson"}.`];
  if (beatContext) parts.push(`The student is currently on this part of the lecture: ${beatContext}`);
  if (mood) parts.push(`Learner context / mode: ${mood}. Adapt your pacing and tone to fit it.`);
  if (adhd) parts.push(ADHD_ADDENDUM);
  return parts.join("\n\n");
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not set — add it to frontend/web/.env.local to enable the live tutor." },
      { status: 503 }
    );
  }
  if (!REALTIME_ENABLED) {
    // Feature is dark server-side even if a stale client flag leaks through.
    return NextResponse.json({ error: "Live tutor is not enabled." }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  const beatContext = typeof body.beatContext === "string" ? body.beatContext.trim().slice(0, 2000) : "";
  const mood = typeof body.mood === "string" ? body.mood.trim().slice(0, 300) : "";
  // ADHD always-on mode: adds lecture-control tools + always-on persona guidance.
  const lectureControl = body.lectureControl === true;

  const tools = lectureControl
    ? [SHOW_BOARD_TOOL, PAUSE_LECTURE_TOOL, RESUME_LECTURE_TOOL]
    : [SHOW_BOARD_TOOL];

  try {
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          instructions: buildInstructions(topic, beatContext, mood, lectureControl),
          audio: {
            output: { voice: REALTIME_VOICE },
            input: {
              // FAST, conversational turn-taking. server_vad triggers on a short silence gap — it
              // responds noticeably quicker than semantic_vad (which runs a model to judge meaning
              // and adds latency before every reply). A short 320ms silence + low prefix padding
              // makes Aria jump in promptly once you pause. `interrupt_response` keeps barge-in, and
              // the client hard-flushes buffered audio the instant you speak over her.
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 200,
                silence_duration_ms: 320,
                interrupt_response: true,
                create_response: true,
              },
              // whisper-1 lags; gpt-4o-mini transcription is faster + more accurate for the live
              // transcript and for the model's own sense of what you just said.
              transcription: { model: "gpt-4o-mini-transcribe" },
            },
          },
          tools,
          tool_choice: "auto",
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = data?.error?.message ?? "Failed to start the live tutor session.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
    // Return ONLY the ephemeral secret value (+ the model the client puts in the SDP URL).
    // Never the API key.
    return NextResponse.json(
      { client_secret: data.value, expires_at: data.expires_at, model: REALTIME_MODEL },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start the live tutor session.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
