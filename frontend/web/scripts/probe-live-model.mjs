/**
 * Which Gemini Live models will actually open a session on this key, with which config?
 *
 *   node scripts/probe-live-model.mjs [model ...]
 *
 * Exists because `client.live.connect()` can hang forever instead of rejecting: the socket opens,
 * the server closes it with a reason, and the SDK's promise never settles. The acceptance script
 * then exits with an "unsettled top-level await" and no explanation. This logs the close code and
 * reason, which is the only place the server says why.
 */
import fs from "node:fs";
import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^GEMINI_API_KEY=(.*)$/);
  if (m) process.env.GEMINI_API_KEY = m[1].trim().replace(/^["']|["']$/g, "");
}
const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: "v1alpha" } });
const models = process.argv.slice(2).length ? process.argv.slice(2) : ["gemini-3.8-live", "gemini-3.1-flash-live-preview"];

const CONFIGS = {
  minimal: { responseModalities: [Modality.AUDIO] },
  fullNoThinking: {
    responseModalities: [Modality.AUDIO],
    outputAudioTranscription: {},
    inputAudioTranscription: {},
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
    realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
    systemInstruction: { parts: [{ text: "You are a tutor. Say hello in five words." }] },
    tools: [{ functionDeclarations: [{ name: "pause_lecture", description: "Pause.", parameters: { type: "OBJECT", properties: {} } }] }],
  },
  full: {
    responseModalities: [Modality.AUDIO],
    outputAudioTranscription: {},
    inputAudioTranscription: {},
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
    realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
    systemInstruction: { parts: [{ text: "You are a tutor. Say hello in five words." }] },
  },
};

function probe(model, configName) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolve({ model, configName, ms: Date.now() - startedAt, ...result }); } };
    const timer = setTimeout(() => done({ outcome: "timeout(15s)" }), 15_000);
    client.live.connect({
      model,
      config: CONFIGS[configName],
      callbacks: {
        onopen: () => {},
        onmessage: (msg) => {
          if (msg.setupComplete) { clearTimeout(timer); done({ outcome: "OPEN" }); }
        },
        onerror: (e) => { clearTimeout(timer); done({ outcome: "error", detail: e?.message }); },
        onclose: (e) => { clearTimeout(timer); done({ outcome: "closed", code: e?.code, reason: (e?.reason || "").slice(0, 200) }); },
      },
    }).then((session) => {
      setTimeout(() => { try { session.close(); } catch {} }, 1500);
    }).catch((e) => { clearTimeout(timer); done({ outcome: "reject", detail: String(e).slice(0, 200) }); });
  });
}

for (const model of models) {
  for (const configName of Object.keys(CONFIGS)) {
    const r = await probe(model, configName);
    console.log(JSON.stringify(r));
    await new Promise((r) => setTimeout(r, 2000));
  }
}
process.exit(0);
