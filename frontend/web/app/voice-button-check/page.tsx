"use client";
/**
 * Dev harness: the real VoiceExploreButton, reachable without signing in.
 *
 * The button ships mounted on the authenticated main page, so every automated check of it hit the
 * sign-up form instead — which is how a voice path that could never answer survived several
 * deploys. The failure was a 404 on the ONNX runtime, visible in one network log, and nothing that
 * could see a network log could get to the button.
 *
 * This mounts the same component with no props and no wrapper, so what is exercised here is what
 * ships. It deliberately renders nothing else: no lecture, no board, no second voice session
 * competing for the microphone.
 */
import { useEffect, useState } from "react";
import { VoiceExploreButton } from "@/components/voice/VoiceExploreButton";
import { sileroStatus } from "@/lib/voice/sileroVad";

export default function VoiceButtonCheck() {
  const [status, setStatus] = useState("idle");
  const [secure, setSecure] = useState("");

  useEffect(() => {
    // Both reads live on the interval rather than firing synchronously on mount: a setState in the
    // effect body is a render-phase update, and the values are only interesting once a session runs.
    const id = window.setInterval(() => {
      setStatus(sileroStatus());
      setSecure(`isSecureContext=${window.isSecureContext} getUserMedia=${!!navigator.mediaDevices?.getUserMedia}`);
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  return (
    <main style={{ minHeight: "100vh", background: "#0b0d12", color: "white", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 18, fontWeight: 700 }}>Voice button harness</h1>
      <p style={{ marginTop: 8, fontSize: 13, color: "rgba(255,255,255,0.6)", maxWidth: 560 }}>
        The production <code>VoiceExploreButton</code>, top right. Click it, allow the microphone and
        speak. The model status below is read from the loader, so <code>failed</code> means the
        runtime genuinely did not load — distinct from <code>loading</code>, which is the normal
        first few seconds of a cold session.
      </p>
      <pre style={{ marginTop: 16, fontSize: 12, color: "#a7f3d0" }}>
        silero: {status}
        {"\n"}
        {secure}
      </pre>
      <VoiceExploreButton />
    </main>
  );
}
