// The tiny blackboard on the desktop app's screen overlay (overlay.js; first built in screen-lab/public).
// Aria's words stream in from /api/screen/explain and are spoken sentence by sentence in her lesson
// voice (/api/tts, each finished sentence asked for at once and played in order), then a one-slide
// pencil board draws in step with her sentences (sketch.js, planned by /api/screen/sketch; the
// default) or a one-slide Manim video plays (/api/screen/slide, with ?draw=manim). The server keeps
// nothing between calls, so each call carries the mark's picture and what Aria said.
import { Sketch } from "./sketch.js";

/** Reads a newline-delimited JSON response, one event at a time. */
export async function readEvents(responsePromise, onEvent) {
  const res = await responsePromise;
  if (!res.ok) {
    const text = await res.text();
    let message = "";
    try {
      message = JSON.parse(text).error ?? "";
    } catch {
      // Not JSON: said plainly below.
    }
    throw new Error(message || (res.status === 401 ? "Sign in to Aria first, then mark again." : `Aria could not answer (HTTP ${res.status}).`));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}

function createVoice({ mock, enabled, onStart = () => {} }) {
  // Mock mode speaks with the browser's own free voice, to test the sentence queue without spending.
  // onStart(idx, ms) tells the pencil board which sentence she has just begun and how long it lasts.
  const estimateMs = (text) => (text.split(/\s+/).length / 2.6) * 1000;
  const speakFree = (text, gen, voice, idx) =>
    new Promise((resolve) => {
      if (gen !== voice.gen) return resolve();
      onStart(idx, estimateMs(text));
      if (!window.speechSynthesis) return setTimeout(resolve, estimateMs(text));
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      // Some browsers never say a sentence ended: move on after its spoken length.
      const safety = setTimeout(resolve, estimateMs(text) * 1.6 + 800);
      u.onend = u.onerror = () => {
        clearTimeout(safety);
        resolve();
      };
      speechSynthesis.speak(u);
    });
  return {
    buf: "",
    chain: Promise.resolve(),
    audio: null,
    gen: 0,
    count: 0, // sentences queued
    feed(text) {
      this.buf += text;
      for (;;) {
        const m = /^([\s\S]*?[.!?])(?=\s)/.exec(this.buf);
        if (!m) break;
        this.say(m[1]);
        this.buf = this.buf.slice(m[1].length);
      }
    },
    end(onDone) {
      if (this.buf.trim()) this.say(this.buf);
      this.buf = "";
      const gen = this.gen;
      this.chain = this.chain.then(() => gen === this.gen && onDone?.());
    },
    say(sentence) {
      const text = sentence.trim();
      if (!text) return;
      const idx = ++this.count;
      const gen = this.gen;
      if (!enabled()) {
        // Silent: the board still moves on at a speaking pace.
        this.chain = this.chain.then(async () => {
          if (gen !== this.gen) return;
          onStart(idx, estimateMs(text));
          await new Promise((r) => setTimeout(r, estimateMs(text)));
        });
        return;
      }
      const clip = mock
        ? null
        : fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json", "x-aria-spend": "screen" }, body: JSON.stringify({ text }) })
            .then((r) => {
              if (r.ok && r.status === 200) return r.blob();
              console.warn(`[voice] no clip: HTTP ${r.status}`);
              return null;
            })
            .catch((err) => {
              console.warn(`[voice] no clip: ${err?.message}`);
              return null;
            });
      this.chain = this.chain.then(async () => {
        if (gen !== this.gen) return;
        if (mock) return speakFree(text, gen, this, idx);
        const blob = await clip;
        if (gen !== this.gen) return console.info("[voice] skipped a sentence: the board moved on");
        if (blob) await this.play(blob, (ms) => onStart(idx, ms || estimateMs(text)));
        else onStart(idx, 0);
      });
    },
    play(blob, started = () => {}) {
      return new Promise((resolve) => {
        const a = new Audio(URL.createObjectURL(blob));
        this.audio = a;
        const done = () => {
          URL.revokeObjectURL(a.src);
          resolve();
        };
        a.onended = done;
        a.onplaying = () => {
          console.info(`[voice] playing a sentence (${a.duration.toFixed(1)} s)`);
          started(Number.isFinite(a.duration) ? a.duration * 1000 : 0);
        };
        a.onerror = () => {
          console.warn(`[voice] the clip would not play (media error ${a.error?.code})`);
          done();
        };
        a.play().catch((err) => {
          console.warn(`[voice] play() refused: ${err?.name} ${err?.message}`);
          done();
        });
      });
    },
    /** True while she is saying something (the listener then needs a louder voice to count). */
    get speaking() {
      return Boolean((this.audio && !this.audio.paused) || window.speechSynthesis?.speaking);
    },
    stop() {
      if (this.audio && !this.audio.paused) console.info("[voice] stopped mid-sentence");
      this.gen++;
      this.buf = "";
      this.count = 0;
      this.audio?.pause();
      this.audio = null;
      window.speechSynthesis?.cancel();
      this.chain = Promise.resolve();
    },
  };
}

/** Sentences, split as the voice splits them, so subtitles and her voice move together. */
function sentencesOf(text) {
  const out = [];
  let buf = String(text ?? "");
  for (;;) {
    const m = /^([\s\S]*?[.!?])(?=\s)/.exec(buf);
    if (!m) break;
    if (m[1].trim()) out.push(m[1].trim());
    buf = buf.slice(m[1].length);
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** The chips under the board: what is asked, and the title the capsule shows meanwhile. */
const FOLLOW_UPS = {
  simpler: { title: "Simpler", ask: "Explain that again more simply, in everyday words, with a tiny example." },
  example: { title: "An example", ask: "Show me a worked example of this, step by step." },
  quiz: { title: "Quiz me", ask: "Quiz me: ask me one short question to check I understood it. Do not give the answer yet." },
};

export class Board {
  /**
   * opts: mock, voiceOn(), slideOn(), stayOpen() (closing shows an idle board instead of hiding it),
   * drawMode() ("pencil" or "manim"), onClose(), onSpend(), onBigger(url), onPop(), onMic() (the
   * microphone light was pressed).
   */
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = { mock: false, voiceOn: () => true, slideOn: () => true, stayOpen: () => false, drawMode: () => "pencil", ...opts };
    const $ = (sel) => el.querySelector(sel);
    this.p = {
      title: $(".b-title"),
      text: $(".b-text"),
      orb: $(".orb"),
      slide: $(".b-slide"),
      slideVideo: $(".b-slide video"),
      sketch: $(".b-sketch"),
      mic: $(".b-mic"),
      slideState: $(".b-slide-state"),
      meta: $(".b-meta"),
      ask: $(".b-ask"),
      head: $(".b-head"),
      full: $(".b-full"),
      status: $(".b-status"),
      cap: $(".b-cap"),
    };
    this.current = null; // the mark being explained: { abort, run, shot, box }
    this.voice = createVoice({
      mock: this.opts.mock,
      enabled: () => this.opts.voiceOn(),
      onStart: (idx, ms) => {
        const me = this.current;
        if (!me) return;
        me.spoken = idx;
        (me.msOf ??= {})[idx] = ms;
        me.sketch?.sentence(idx, ms);
        this.renderCap();
        this.renderStatus();
      },
    });

    el.addEventListener("click", (e) => {
      // One-tap follow-ups (the chips under the board).
      const chip = e.target.closest("[data-ask]")?.dataset.ask;
      if (chip && FOLLOW_UPS[chip]) return void this.ask(FOLLOW_UPS[chip].ask, FOLLOW_UPS[chip].title);
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "close") this.close();
      else if (act === "pop") this.opts.onPop?.();
      else if (act === "mic") this.opts.onMic?.();
      else if (act === "replay") {
        if (this.current?.sketch) return void this.current.sketch.replay();
        this.p.slideVideo.currentTime = 0;
        this.p.slideVideo.play().catch(() => {});
      } else if (act === "bigger") this.opts.onBigger?.(this.p.slideVideo.currentSrc || this.p.slideVideo.src);
      else if (act === "video") {
        const made = this.current?.video;
        if (made?.url) this.opts.onBigger?.(made.url, made.vtt);
        else if (this.current?.run && !made) this.makeVideo(this.current);
      }
    });
    this.p.ask.addEventListener("submit", (e) => {
      e.preventDefault();
      this.ask(this.p.ask.q.value);
    });
    // Drag the board by its heading.
    this.p.head.addEventListener("pointerdown", (e) => {
      if (this.opts.stayOpen() || e.target.closest("button")) return;
      const start = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop };
      const move = (ev) => {
        el.style.left = `${start.left + ev.clientX - start.x}px`;
        el.style.top = `${start.top + ev.clientY - start.y}px`;
      };
      const view = el.ownerDocument.defaultView;
      view.addEventListener("pointermove", move);
      view.addEventListener("pointerup", () => view.removeEventListener("pointermove", move), { once: true });
    });
  }

  /** A follow-up about the same mark (typed, or said as "Aria, …"): answered and drawn afresh. */
  ask(text, title) {
    const question = String(text ?? "").trim();
    const now = this.current;
    if (!question || !now?.run) return false;
    // What she has said about this mark so far, so the answer builds on it instead of repeating it.
    const before = [now.before, now.said].filter(Boolean).join(" ").slice(-1000);
    this.explain(now.shot, { box: now.box, question, before, title });
    return true;
  }

  /** Her words as subtitles: the sentence she is saying, bright, and the next one faint. */
  renderCap() {
    const cap = this.p.cap;
    if (!cap) return;
    const me = this.current;
    const all = sentencesOf(this.p.text.textContent);
    if (!me || !all.length || this.p.text.classList.contains("error")) {
      cap.replaceChildren();
      return;
    }
    // Before her voice starts (or with it off) the newest sentence shows.
    const at = me.voiceDone || !me.spoken ? all.length - 1 : Math.min(me.spoken, all.length) - 1;
    const now = document.createElement("span");
    now.className = "now";
    now.textContent = all[at];
    const parts = [now];
    if (!me.voiceDone && all[at + 1]) {
      const later = document.createElement("span");
      later.className = "later";
      later.textContent = ` ${all[at + 1]}`;
      parts.push(later);
    }
    cap.replaceChildren(...parts);
  }

  /** The capsule's second line: what she is doing now. */
  renderStatus() {
    const s = this.p.status;
    if (!s) return;
    const me = this.current;
    const state = this.p.orb.classList.contains("thinking") ? "thinking" : this.p.orb.classList.contains("talking") ? "talking" : "idle";
    const n = sentencesOf(this.p.text.textContent).length;
    const mic = this.p.mic?.dataset.state;
    if (this.p.text.classList.contains("error")) s.textContent = "Something went wrong";
    else if (state === "thinking") s.textContent = me?.title ? "Thinking about it…" : "Looking at what you marked…";
    else if (state === "talking") s.textContent = me?.spoken && n ? `Explaining · ${Math.min(me.spoken, n)} of ${n}` : "Explaining…";
    else if (mic === "waiting") s.textContent = "Yes? Ask your question";
    else if (mic === "hearing") s.textContent = "Hearing you…";
    else if (mic === "listening") s.textContent = "Say “Aria, …” to ask more";
    else s.textContent = "Ask a follow-up below";
  }

  /** Stops her talking (the student said "Aria, stop" or just "Aria"). */
  hush() {
    this.voice.stop();
    if (this.current) this.setOrb("idle");
  }

  /** The microphone light: "off" | "listening" | "hearing" | "waiting" | "blocked". */
  setMic(state) {
    const b = this.p.mic;
    if (!b) return;
    // Mock tests start with the microphone off and keep the light out of the way.
    b.hidden = state === "off" && this.opts.mock && !b.dataset.used;
    if (state !== "off") b.dataset.used = "1";
    b.dataset.state = state;
    b.title = {
      listening: "Listening: say “Aria, …” to ask (click to turn off)",
      hearing: "Hearing you…",
      waiting: "Yes? Ask your question",
      blocked: "No microphone: allow Aria in System Settings → Privacy & Security → Microphone",
      off: "Microphone off (click to listen for “Aria, …”)",
    }[state] ?? "";
    this.p.ask.q.placeholder = state === "off" || state === "blocked" ? "Ask about this…" : state === "waiting" ? "Yes? I'm listening…" : "Ask, or say “Aria, …”";
    this.renderStatus();
  }

  get isOpen() {
    return !this.el.hidden;
  }

  setOrb(state) {
    this.p.orb.className = `orb ${state}`;
    this.el.dataset.state = state;
    this.renderStatus();
    this.opts.onState?.(state);
  }

  /** Beside the mark: right of it, else left, else under or above it; always inside W x H. */
  place(box, W, H) {
    if (this.opts.stayOpen()) return;
    // Room for the pencil board, which widens the board once she names the idea.
    const pencil = this.opts.slideOn() && this.opts.drawMode() === "pencil";
    const bw = Math.max(this.el.offsetWidth || 340, pencil ? 460 : 0);
    // The sheet is 4:3 plus its subtitles and the row of follow-ups under it.
    const bh = Math.max(this.el.offsetHeight, pencil ? Math.round(bw * 0.75) + 150 : 420);
    // Never under the capsule at the top of the screen.
    const TOP = this.opts.stayOpen() ? 8 : 78;
    const gap = 18;
    let left = box.right + gap;
    let top = box.top - 10;
    if (left + bw > W - 8) left = box.left - gap - bw;
    if (left < 8) {
      left = Math.min(Math.max(8, box.left), W - bw - 8);
      top = box.bottom + gap + bh <= H - 8 ? box.bottom + gap : box.top - gap - bh;
    }
    this.el.style.left = `${Math.max(8, left)}px`;
    this.el.style.top = `${Math.min(Math.max(TOP, top), Math.max(TOP, H - bh - 8))}px`;
  }

  show() {
    this.el.hidden = false;
    if (this.opts.stayOpen()) return;
    this.el.classList.remove("show");
    void this.el.offsetWidth;
    this.el.classList.add("show");
  }

  close() {
    this.current?.abort.abort();
    this.current = null;
    this.voice.stop();
    this.resetSlide("off");
    if (this.opts.stayOpen()) {
      this.p.title.textContent = "Mark something";
      this.p.text.textContent = "Drag the cursor around anything and I'll explain it here.";
      this.p.meta.textContent = "";
      this.setOrb("idle");
    } else {
      this.el.hidden = true;
    }
    this.opts.onClose?.();
  }

  resetSlide(state) {
    const v = this.p.slideVideo;
    v.pause();
    v.removeAttribute("src");
    v.onended = null;
    v.load();
    this.p.slide.classList.remove("ready");
    this.p.slide.hidden = state === "off";
    this.sketchView?.destroy();
    this.sketchView = null;
    if (this.p.sketch) this.p.sketch.hidden = true;
    this.p.slide.classList.remove("sketch");
    this.el.classList.remove("sketching");
    this.p.slideState.textContent = state === "waiting" ? (this.opts.drawMode() === "pencil" ? "" : "A slide comes next…") : "";
  }

  showError(message) {
    this.p.text.classList.add("error");
    this.p.text.textContent = message;
    this.renderCap();
    this.setOrb("idle");
  }

  addMeta(part) {
    const m = this.p.meta;
    m.textContent = m.textContent ? `${m.textContent} · ${part}` : part;
  }

  /** What the slide and video calls need about a mark: the server keeps nothing between calls. */
  markOf(me) {
    return { run: me.run, concept: me.concept, said: me.said, crop: me.shot.crop, mock: this.opts.mock };
  }

  /** shot: { crop, context }. Opens the board beside `box` (page pixels) when given. */
  async explain(shot, { box, question, before, title, W, H } = {}) {
    this.current?.abort.abort();
    this.voice.stop();
    const me = { abort: new AbortController(), run: null, shot, box, concept: "", said: "", before: before ?? "", title: title ?? question ?? "" };
    this.current = me;
    const p = this.p;
    const t0 = performance.now();
    let first = 0;
    p.title.textContent = me.title || "Looking…";
    p.text.textContent = "";
    p.cap?.replaceChildren();
    p.text.classList.remove("error");
    p.meta.textContent = "";
    p.ask.q.value = "";
    p.full.hidden = true;
    p.full.disabled = false;
    p.full.classList.remove("ready");
    p.full.textContent = "▶ Video";
    this.setOrb("thinking");
    this.resetSlide(this.opts.slideOn() ? "waiting" : "off");
    this.show();
    if (box && W && H) this.place(box, W, H);
    try {
      await readEvents(
        fetch("/api/screen/explain", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ crop: shot.crop, context: shot.context, question, before, mock: this.opts.mock }),
          signal: me.abort.signal,
        }),
        (ev) => {
          if (this.current !== me) return;
          if (ev.t === "run") me.run = ev.run;
          else if (ev.t === "concept") {
            // A follow-up keeps the question as the board's title; the pencil board gets the idea.
            if (!question) p.title.textContent = ev.concept;
            // The pencil board opens now with its heading, while she starts to speak.
            if (this.opts.slideOn() && this.opts.drawMode() === "pencil" && !/^unclear$/i.test(ev.concept)) this.openSketch(me).preTitle(ev.concept);
          }
          else if (ev.t === "text") {
            if (!first) {
              first = performance.now() - t0;
              this.setOrb("talking");
            }
            p.text.append(ev.text);
            p.text.scrollTop = p.text.scrollHeight;
            this.voice.feed(ev.text);
            this.renderCap();
          } else if (ev.t === "done") {
            me.concept = ev.concept ?? "";
            me.said = ev.said ?? "";
            this.addMeta(`words in ${(first / 1000).toFixed(1)} s`);
            this.voice.end(() => {
              if (this.current !== me) return;
              me.voiceDone = true;
              this.setOrb("idle");
              this.renderCap();
              me.sketch?.finish();
            });
            if (!this.opts.voiceOn()) this.setOrb("idle");
            const clear = !/^unclear$/i.test(ev.concept ?? "");
            if (this.opts.slideOn() && clear) this.opts.drawMode() === "pencil" ? this.makeSketch(me) : this.makeSlide(me);
            else this.resetSlide("off");
            p.full.hidden = !clear;
            this.opts.onSpend?.();
          } else if (ev.t === "error") this.showError(ev.error);
        },
      );
    } catch (err) {
      if (err?.name !== "AbortError" && this.current === me) {
        // "Failed to fetch" means the lab server is not running.
        const down = err instanceof TypeError && /fetch/i.test(err.message);
        this.showError(down ? "Can't reach Aria. Check the internet connection and mark again." : err?.message ?? String(err));
      }
    }
  }

  /** The live pencil board: one fast call plans it, then it draws as she speaks each sentence. */
  openSketch(me) {
    const p = this.p;
    if (me.view && this.sketchView === me.view) return me.view;
    p.slide.hidden = false;
    p.slide.classList.add("sketch");
    this.el.classList.add("sketching");
    p.sketch.hidden = false;
    p.slideState.textContent = "";
    this.sketchView?.destroy();
    this.sketchView = new Sketch(p.sketch);
    me.view = this.sketchView;
    return me.view;
  }

  async makeSketch(me) {
    const t0 = performance.now();
    const p = this.p;
    this.openSketch(me);
    try {
      await readEvents(
        fetch("/api/screen/sketch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(this.markOf(me)), signal: me.abort.signal }),
        async (ev) => {
          if (this.current !== me) return;
          if (ev.t === "scene") {
            const view = this.sketchView;
            const first = !me.sketch;
            await view.load(ev.scene, ev.sentences ?? []);
            for (const [k, ms] of Object.entries(me.msOf ?? {})) if (ms) view.sentenceMs.set(Number(k), ms);
            if (this.current !== me) return;
            me.sketch = view;
            p.slide.classList.add("ready");
            if (first) this.addMeta(`board in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
            if (me.voiceDone) view.finish();
            else view.sentence(me.spoken ?? 1, 0);
            window.__sketchReport = view.report;
          } else if (ev.t === "done") {
            if (!ev.ok) p.slideState.textContent = "No board this time.";
            this.opts.onSpend?.();
          } else if (ev.t === "error") p.slideState.textContent = ev.error;
        },
      );
    } catch (err) {
      if (err?.name !== "AbortError" && this.current === me) p.slideState.textContent = "The board failed.";
    }
  }

  async makeSlide(me) {
    const t0 = performance.now();
    const labels = { writing: "Writing the slide", fixing: "Fixing the slide", rendering: "Drawing it" };
    let label = "Writing the slide";
    let shown = false;
    const tick = setInterval(() => {
      if (this.current === me && !shown) this.p.slideState.textContent = `${label}… ${Math.round((performance.now() - t0) / 1000)} s`;
    }, 250);
    try {
      await readEvents(
        fetch("/api/screen/slide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(this.markOf(me)), signal: me.abort.signal }),
        (ev) => {
          if (this.current !== me) return;
          if (ev.t === "stage") label = labels[ev.stage] ?? label;
          else if (ev.t === "video") {
            shown = true;
            this.showSlide(ev.url, ev.better);
            if (!ev.better) this.addMeta(`slide in ${Math.round((performance.now() - t0) / 1000)} s`);
          } else if (ev.t === "done") {
            if (!ev.ok) this.p.slideState.textContent = "No slide this time (the code did not render).";
            this.opts.onSpend?.();
          } else if (ev.t === "error") this.p.slideState.textContent = ev.error;
        },
      );
    } catch (err) {
      if (err?.name !== "AbortError" && this.current === me) this.p.slideState.textContent = "The slide failed.";
    } finally {
      clearInterval(tick);
    }
  }

  /** The full narrated video (lib/video.mjs): progress on the button, then a button that plays it big. */
  async makeVideo(me) {
    const b = this.p.full;
    const t0 = performance.now();
    let label = "Planning the video";
    me.video = { url: null };
    b.disabled = true;
    const tick = setInterval(() => {
      if (this.current === me && !me.video.url) b.textContent = `Video… ${Math.round((performance.now() - t0) / 1000)} s`;
      b.title = label;
    }, 250);
    try {
      await readEvents(
        fetch("/api/screen/video", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(this.markOf(me)), signal: me.abort.signal }),
        (ev) => {
          if (this.current !== me) return;
          if (ev.t === "plan") label = `Voicing and drawing ${ev.scenes.length} scenes`;
          else if (ev.t === "scene" && ev.stage === "done") label = `Scenes ready ${ev.drawn}/${ev.of}`;
          else if (ev.t === "stage" && ev.stage === "joining") label = "Joining the scenes";
          else if (ev.t === "done") {
            me.video = { url: ev.url, vtt: ev.vtt };
            const m = Math.floor(ev.seconds / 60);
            b.textContent = `▶ Watch (${m}:${String(Math.round(ev.seconds % 60)).padStart(2, "0")})`;
            b.classList.add("ready");
            b.disabled = false;
            this.addMeta(`video in ${Math.round((performance.now() - t0) / 1000)} s`);
            this.opts.onSpend?.();
          } else if (ev.t === "error") throw new Error(ev.error);
        },
      );
    } catch (err) {
      if (err?.name !== "AbortError" && this.current === me) {
        me.video = null;
        b.disabled = false;
        b.textContent = "Video failed: retry";
        console.warn(`[video] ${err?.message ?? err}`);
      }
    } finally {
      clearInterval(tick);
    }
  }

  showSlide(url, better) {
    const v = this.p.slideVideo;
    const start = () => {
      v.onended = null;
      v.src = url;
      v.play().catch(() => {});
    };
    this.p.slideState.textContent = "";
    this.p.slide.classList.add("ready");
    // A tidier second version waits for the first to finish playing.
    if (better && v.getAttribute("src") && !v.paused && !v.ended) v.onended = start;
    else start();
  }
}
