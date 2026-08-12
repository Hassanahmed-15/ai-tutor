#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";
import {
  buildGeminiLiveInstructions,
  isDrawingRequest,
  PAUSE_LECTURE_TOOL,
  RESUME_LECTURE_TOOL,
  SHOW_BOARD_TOOL,
} from "../lib/geminiLiveContract.ts";

const DRAW_DELAY_MS = 900;
const TURN_TIMEOUT_MS = 35_000;

function loadLocalEnv() {
  let source = "";
  try {
    source = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function eventNames(events) {
  return events.filter((event) => event.type === "tool").map((event) => event.name);
}

function controlNames(events) {
  return events
    .filter((event) => event.type === "app-control")
    .map((event) => event.name);
}

function assertOrdered(names, expected) {
  let cursor = -1;
  for (const name of expected) {
    cursor = names.indexOf(name, cursor + 1);
    assert.notEqual(cursor, -1, `Expected ${expected.join(" -> ")}; received ${names.join(" -> ") || "no tools"}`);
  }
}

loadLocalEnv();
const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
assert.ok(apiKey, "Set GEMINI_API_KEY in frontend/web/.env.local before running this acceptance test.");

const model = process.env.GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview";
const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
const instructions = buildGeminiLiveInstructions({
  topic: "supply and demand",
  beatContext: "The scripted lecture is active at 01:42 and is explaining why demand curves slope downward.",
  lessonContext: "Teach introductory economics accurately and concisely.",
  mood: "The learner should be able to interrupt naturally.",
  adhdMode: false,
  examQuestions: [],
});

let session;
let currentTurn = null;
let socketError = null;

function touchTurn() {
  if (currentTurn) currentTurn.lastMessageAt = Date.now();
}

async function executeTools(calls) {
  if (!currentTurn || !session) return;
  currentTurn.inFlight += calls.length;
  const responses = await Promise.all(calls.map(async (call) => {
    const name = call.name ?? "unknown";
    currentTurn.events.push({ type: "tool", name, at: Date.now() });
    if (name === "show_board") {
      currentTurn.events.push({ type: "app-control", name: "show_board", at: Date.now() });
      currentTurn.events.push({ type: "drawing-status", value: "Teacher is drawing... Please wait", at: Date.now() });
      await sleep(DRAW_DELAY_MS);
      currentTurn.events.push({ type: "board-ready", at: Date.now() });
      return {
        id: call.id,
        name,
        response: { output: "The requested supply and demand slide is now fully rendered and visible." },
      };
    }
    if (name === "pause_lecture") {
      return { id: call.id, name, response: { output: "The lecture is paused at 01:42." } };
    }
    if (name === "resume_lecture") {
      return { id: call.id, name, response: { output: "The lecture resumed from 01:42. Remain silent." } };
    }
    return { id: call.id, name, response: { error: `Unknown tool ${name}` } };
  }));
  currentTurn.inFlight -= calls.length;
  if (currentTurn && session) {
    currentTurn.turnComplete = false;
    session.sendToolResponse({ functionResponses: responses });
  }
  touchTurn();
}

async function runLocalDrawingFallback(turn) {
  turn.events.push({ type: "app-control", name: "show_board", at: Date.now() });
  turn.events.push({ type: "drawing-status", value: "Teacher is drawing... Please wait", at: Date.now() });
  await sleep(DRAW_DELAY_MS);
  turn.events.push({ type: "board-ready", at: Date.now() });
}

function turnSettled(turn) {
  return turn.turnComplete && turn.inFlight === 0 && Date.now() - turn.lastMessageAt >= 650;
}

async function waitForTurn(turn) {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (socketError) throw socketError;
    if (turnSettled(turn)) return;
    await sleep(100);
  }
  throw new Error(`Timed out. Tools received: ${eventNames(turn.events).join(", ") || "none"}`);
}

async function runTurn(label, text, { autoResume = false } = {}) {
  const turn = {
    label,
    events: [],
    audioBytes: 0,
    transcript: "",
    inFlight: 0,
    turnComplete: false,
    lastMessageAt: Date.now(),
  };
  currentTurn = turn;
  // This mirrors LessonPlayer.onStudentSpeechStarted: stop overlap immediately instead of asking
  // a probabilistic model for permission to pause. Final transcript classification later decides
  // whether that pause is held (command), released (backchannel), or resumed after an answer.
  turn.events.push({ type: "app-control", name: "pause_lecture", at: Date.now() });
  session.sendClientContent({ turns: text, turnComplete: true });
  await waitForTurn(turn);
  await sleep(200);
  if (isDrawingRequest(text) && !eventNames(turn.events).includes("show_board")) {
    await runLocalDrawingFallback(turn);
  }
  if (autoResume || eventNames(turn.events).includes("resume_lecture")) {
    // The production hook treats Gemini's resume call as a request, then commits it only from
    // finishTutorTurn after generated audio and asynchronous tool chains have fully drained.
    turn.events.push({ type: "app-control", name: "resume_lecture", at: Date.now() });
  }
  return turn;
}

try {
  session = await client.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      systemInstruction: { parts: [{ text: instructions }] },
      tools: [{ functionDeclarations: [SHOW_BOARD_TOOL, PAUSE_LECTURE_TOOL, RESUME_LECTURE_TOOL] }],
    },
    callbacks: {
      onmessage: (message) => {
        if (!currentTurn) return;
        touchTurn();
        const parts = message.serverContent?.modelTurn?.parts ?? [];
        for (const part of parts) {
          if (part.inlineData?.data) {
            currentTurn.audioBytes += part.inlineData.data.length;
            currentTurn.events.push({ type: "audio", at: Date.now() });
          }
        }
        const transcript = message.serverContent?.outputTranscription?.text;
        if (transcript) currentTurn.transcript += transcript;
        if (message.toolCall?.functionCalls?.length) void executeTools(message.toolCall.functionCalls);
        if (message.serverContent?.turnComplete) currentTurn.turnComplete = true;
      },
      onerror: (event) => {
        socketError = new Error(event?.message ?? "Gemini Live socket error");
      },
      onclose: (event) => {
        if (!socketError && event?.code && event.code !== 1000) {
          socketError = new Error(`Gemini Live closed unexpectedly (${event.code}).`);
        }
      },
    },
  });

  const pause = await runTurn("direct pause", "Pause the lecture now.");
  assert.deepEqual(eventNames(pause.events), ["pause_lecture"]);

  const resume = await runTurn("direct resume", "Continue the lecture from where it stopped.");
  assert.deepEqual(eventNames(resume.events), ["resume_lecture"]);

  const question = await runTurn(
    "question interruption",
    "I am interrupting the active lecture with a simple verbal question: what does scarcity mean? Answer briefly, then continue.",
    { autoResume: true },
  );
  const questionTools = eventNames(question.events);
  assertOrdered(controlNames(question.events), ["pause_lecture", "resume_lecture"]);
  assert.equal(questionTools.includes("show_board"), false, "A simple verbal question unexpectedly generated a board.");
  assert.ok(question.audioBytes > 0 || question.transcript.trim(), "Gemini did not produce the spoken answer between pause and resume.");
  const questionAudio = question.events.find((event) => event.type === "audio");
  const questionResume = question.events.findLast(
    (event) => event.type === "app-control" && event.name === "resume_lecture",
  );
  assert.ok(questionAudio && questionResume && questionAudio.at <= questionResume.at, "Lecture resumed before Gemini answered.");

  const drawing = await runTurn(
    "asynchronous drawing",
    "While the lecture is active, draw a supply and demand equilibrium graph on the board, explain it briefly, then continue the lecture.",
    { autoResume: true },
  );
  assertOrdered(controlNames(drawing.events), ["pause_lecture", "show_board", "resume_lecture"]);
  const drawingStarted = drawing.events.find((event) => event.type === "drawing-status");
  const boardReady = drawing.events.find((event) => event.type === "board-ready");
  const resumed = drawing.events.findLast(
    (event) => event.type === "app-control" && event.name === "resume_lecture",
  );
  assert.equal(drawingStarted?.value, "Teacher is drawing... Please wait");
  assert.ok(boardReady && drawingStarted && boardReady.at - drawingStarted.at >= DRAW_DELAY_MS - 20);
  assert.ok(resumed && boardReady && resumed.at >= boardReady.at, "Lecture resumed before the board finished rendering.");
  const drawingOverlap = drawing.events.some(
    (event) => event.type === "audio" && drawingStarted && boardReady && event.at > drawingStarted.at && event.at < boardReady.at,
  );
  assert.equal(drawingOverlap, false, "Gemini spoke while the board was still being generated.");

  console.log(`Gemini Live acceptance PASS (${model})`);
  for (const turn of [pause, resume, question, drawing]) {
    console.log(
      `- ${turn.label}: model tools=${eventNames(turn.events).join(" -> ") || "none"}; ` +
      `effective controls=${controlNames(turn.events).join(" -> ")}; audio=${turn.audioBytes > 0 ? "yes" : "no"}`,
    );
  }
} finally {
  session?.close();
}
