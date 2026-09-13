import { NextResponse } from "next/server";
import OpenAI from "openai";
import { currentUser } from "@/lib/auth";
import { learnerProfileForUser } from "@/lib/progressiveLectureStore";
import { shouldIncludeCodeExamples, type LearnerProfileSnapshot } from "@/lib/progressiveLectureTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  if (!topic) return NextResponse.json({ error: "topic is required" }, { status: 400 });
  const planningConversation = typeof body.planningConversation === "string"
    ? body.planningConversation.slice(0, 8_000)
    : "";

  const previous = await learnerProfileForUser(session.userId).catch(() => null);
  const baseline: LearnerProfileSnapshot = previous ?? {
    expertise: "intermediate",
    depth: "balanced",
    goal: "curiosity",
    codeExamples: /\b(code|coding|program|loop|algorithm|javascript|python|developer)\b/i.test(topic),
    preferredExamples: "mixed",
    rationale: "Balanced defaults based on the current planning conversation.",
    confirmedAt: "",
  };
  const fallback = heuristicSuggestion(topic, planningConversation, baseline);
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ suggestion: fallback });

  try {
    const model = process.env.OPENAI_PROFILE_MODEL ?? "gpt-4o-mini";
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "Infer a tentative teaching profile from the learner's CURRENT planning conversation. Never infer demographics or disability. Treat learner messages, answers, and revision requests as evidence; Aria messages and the outline are context only. Explicit current statements such as experience level, occupation, desired detail, exam preparation, practical use, or example preference override a previous profile. Do not infer expertise or goals merely from the topic. If the current conversation gives no evidence for a field, retain the previous profile value supplied in the request. Return JSON only: expertise(beginner|intermediate|advanced), depth(concise|balanced|deep), goal(school|exam|curiosity|practical|professional), preferredExamples(visual|real-world|worked|mixed), rationale(one short sentence identifying the learner evidence used). Code examples are derived by the application when the confirmed profile is both advanced and professional. This is only a suggestion the learner must confirm.",
        },
        {
          role: "user",
          content: JSON.stringify({
            topic,
            planningConversation,
            outline: body.outline,
            previousProfile: previous,
          }),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 400,
    });
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
    const inferred: LearnerProfileSnapshot = {
      expertise: oneOf(raw.expertise, ["beginner", "intermediate", "advanced"], fallback.expertise),
      depth: oneOf(raw.depth, ["concise", "balanced", "deep"], fallback.depth),
      goal: oneOf(raw.goal, ["school", "exam", "curiosity", "practical", "professional"], fallback.goal),
      codeExamples: false,
      preferredExamples: oneOf(raw.preferredExamples, ["visual", "real-world", "worked", "mixed"], fallback.preferredExamples),
      rationale: typeof raw.rationale === "string" ? raw.rationale.slice(0, 240) : fallback.rationale,
      confirmedAt: "",
    };
    const suggestion = { ...inferred, codeExamples: shouldIncludeCodeExamples(inferred) };
    return NextResponse.json({ suggestion });
  } catch (error) {
    console.error("[learner-profile] suggestion failed:", error);
    return NextResponse.json({ suggestion: fallback });
  }
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? value as T : fallback;
}

/** A useful fallback when profile inference is unavailable. It only acts on explicit learner
 * language and otherwise preserves the saved/default profile instead of guessing from the topic. */
function heuristicSuggestion(
  topic: string,
  conversation: string,
  baseline: LearnerProfileSnapshot,
): LearnerProfileSnapshot {
  const text = conversation.toLowerCase();
  const next = { ...baseline, confirmedAt: "" };
  const evidence: string[] = [];

  if (/\b(?:i am|i'm|im) (?:a )?(?:beginner|new|novice)|\bnew to (?:this|the topic|[a-z])|\bno experience\b/.test(text)) {
    next.expertise = "beginner";
    evidence.push("beginner-level experience");
  } else if (/\b(?:i am|i'm|im) (?:an? )?(?:expert|advanced)|\bstrong background\b|\byears of experience\b/.test(text)) {
    next.expertise = "advanced";
    evidence.push("advanced experience");
  } else if (/\bknow the basics\b|\bsome experience\b|\bintermediate\b/.test(text)) {
    next.expertise = "intermediate";
    evidence.push("existing basic knowledge");
  }

  if (/\bdeep dive\b|\bin[- ]depth\b|\bdetailed\b|\btechnical detail\b|\bthorough\b/.test(text)) {
    next.depth = "deep";
    evidence.push("requested detail");
  } else if (/\bbrief\b|\bconcise\b|\bquick overview\b|\bshort explanation\b/.test(text)) {
    next.depth = "concise";
    evidence.push("requested brevity");
  }

  if (/\bexam\b|\btest prep\b|\bcertification\b/.test(text)) next.goal = "exam";
  else if (/\bfor (?:my )?(?:job|work|career)|\bprofessional\b|\bdeveloper\b|\bengineer\b/.test(text)) next.goal = "professional";
  else if (/\bproject\b|\bbuild|\bimplement|\bhands[- ]on\b|\bpractical\b/.test(text)) next.goal = "practical";
  else if (/\bschool\b|\bclass\b|\bhomework\b|\bsecondary student\b|\bcollege\b/.test(text)) next.goal = "school";

  if (/\bcode snippets?\b|\bshow (?:me )?(?:the )?code\b|\bimplementation\b|\bpython\b|\bjavascript\b/.test(text)) {
    next.codeExamples = true;
    evidence.push("requested code");
  } else if (/\bno code\b|\bwithout code\b/.test(text)) {
    next.codeExamples = false;
    evidence.push("declined code");
  }

  if (/\bworked examples?\b|\bstep[- ]by[- ]step\b/.test(text)) next.preferredExamples = "worked";
  else if (/\breal[- ]world\b|\beveryday examples?\b/.test(text)) next.preferredExamples = "real-world";
  else if (/\bvisual examples?\b|\bdiagrams?\b|\banimations?\b/.test(text)) next.preferredExamples = "visual";

  next.codeExamples = shouldIncludeCodeExamples(next);
  next.rationale = evidence.length
    ? `Suggested from your current conversation: ${evidence.join(", ")}.`
    : previousRationale(baseline, topic);
  return next;
}

function previousRationale(profile: LearnerProfileSnapshot, topic: string): string {
  return profile.confirmedAt
    ? `Kept your previously confirmed learning preferences; this conversation did not specify different needs for ${topic}.`
    : `No explicit learning preferences were stated, so Aria suggested balanced defaults for ${topic}.`;
}
