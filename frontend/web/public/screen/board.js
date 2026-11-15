// The tiny blackboard on the desktop app's screen overlay (overlay.js; first built in screen-lab/public).
// Aria's words stream in from /api/screen/explain and are spoken sentence by sentence in her lesson
// voice (/api/tts, each finished sentence asked for at once and played in order), then a one-slide
// Manim video plays under them (/api/screen/slide). The server keeps nothing between calls, so each
// call carries the mark's picture and what Aria said.

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

function createVoice({ mock, enabled }) {
  // Mock mode speaks with the browser's own free voice, to test the sentence queue without spending.
  const speakFree = (text, gen, voice) =>
    new Promise((resolve) => {
      if (!window.speechSynthesis || gen !== voice.gen) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.onend = u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  return {
    buf: "",
    chain: Promise.resolve(),
    audio: null,
    gen: 0,
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
      if (!text || !enabled()) return;
      const gen = this.gen;
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
        if (mock) return speakFree(text, gen, this);
        const blob = await clip;
        if (gen !== this.gen) return console.info("[voice] skipped a sentence: the board moved on");
        if (blob) await this.play(blob);
      });
    },
    play(blob) {
      return new Promise((resolve) => {
        const a = new Audio(URL.createObjectURL(blob));
        this.audio = a;
        const done = () => {
          URL.revokeObjectURL(a.src);
          resolve();
        };
        a.onended = done;
        a.onplaying = () => console.info(`[voice] playing a sentence (${a.duration.toFixed(1)} s)`);
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
    stop() {
      if (this.audio && !this.audio.paused) console.info("[voice] stopped mid-sentence");
      this.gen++;
      this.buf = "";
      this.audio?.pause();
      this.audio = null;
      window.speechSynthesis?.cancel();
      this.chain = Promise.resolve();
    },
  };
}

export class Board {
  /**
   * opts: mock, voiceOn(), slideOn(), stayOpen() (closing shows an idle board instead of hiding it),
   * onClose(), onSpend(), onBigger(url), onPop().
   */
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = { mock: false, voiceOn: () => true, slideOn: () => true, stayOpen: () => false, ...opts };
    const $ = (sel) => el.querySelector(sel);
    this.p = {
      title: $(".b-title"),
      text: $(".b-text"),
      orb: $(".orb"),
      slide: $(".b-slide"),
      slideVideo: $(".b-slide video"),
      slideState: $(".b-slide-state"),
      meta: $(".b-meta"),
      ask: $(".b-ask"),
      head: $(".b-head"),
      full: $(".b-full"),
    };
    this.current = null; // the mark being explained: { abort, run, shot, box }
    this.voice = createVoice({ mock: this.opts.mock, enabled: () => this.opts.voiceOn() });

    el.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "close") this.close();
      else if (act === "pop") this.opts.onPop?.();
      else if (act === "replay") {
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
      const question = this.p.ask.q.value.trim();
      if (question && this.current?.run) this.explain(this.current.shot, { box: this.current.box, question });
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

  get isOpen() {
    return !this.el.hidden;
  }

  setOrb(state) {
    this.p.orb.className = `orb ${state}`;
  }

  /** Beside the mark: right of it, else left, else under or above it; always inside W x H. */
  place(box, W, H) {
    if (this.opts.stayOpen()) return;
    const bw = this.el.offsetWidth || 340;
    const bh = Math.max(this.el.offsetHeight, 420);
    const gap = 18;
    let left = box.right + gap;
    let top = box.top - 10;
    if (left + bw > W - 8) left = box.left - gap - bw;
    if (left < 8) {
      left = Math.min(Math.max(8, box.left), W - bw - 8);
      top = box.bottom + gap + bh <= H - 8 ? box.bottom + gap : box.top - gap - bh;
    }
    this.el.style.left = `${Math.max(8, left)}px`;
    this.el.style.top = `${Math.min(Math.max(8, top), Math.max(8, H - bh - 8))}px`;
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
    this.p.slideState.textContent = state === "waiting" ? "A slide comes next…" : "";
  }

  showError(message) {
    this.p.text.classList.add("error");
    this.p.text.textContent = message;
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
  async explain(shot, { box, question, W, H } = {}) {
    this.current?.abort.abort();
    this.voice.stop();
    const me = { abort: new AbortController(), run: null, shot, box, concept: "", said: "" };
    this.current = me;
    const p = this.p;
    const t0 = performance.now();
    let first = 0;
    p.title.textContent = question ? question : "Looking…";
    p.text.textContent = "";
    p.text.classList.remove("error");
    p.meta.textContent = "";
    p.ask.q.value = "";
    p.full.hidden = true;
    p.full.disabled = false;
    p.full.classList.remove("ready");
    p.full.textContent = "Make a full video";
    this.setOrb("thinking");
    this.resetSlide(this.opts.slideOn() ? "waiting" : "off");
    this.show();
    if (box && W && H) this.place(box, W, H);
    try {
      await readEvents(
        fetch("/api/screen/explain", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ crop: shot.crop, context: shot.context, question, mock: this.opts.mock }),
          signal: me.abort.signal,
        }),
        (ev) => {
          if (this.current !== me) return;
          if (ev.t === "run") me.run = ev.run;
          else if (ev.t === "concept" && !question) p.title.textContent = ev.concept;
          else if (ev.t === "text") {
            if (!first) {
              first = performance.now() - t0;
              this.setOrb("talking");
            }
            p.text.append(ev.text);
            p.text.scrollTop = p.text.scrollHeight;
            this.voice.feed(ev.text);
          } else if (ev.t === "done") {
            me.concept = ev.concept ?? "";
            me.said = ev.said ?? "";
            this.addMeta(`words in ${(first / 1000).toFixed(1)} s`);
            this.voice.end(() => this.current === me && this.setOrb("idle"));
            if (!this.opts.voiceOn()) this.setOrb("idle");
            const clear = !/^unclear$/i.test(ev.concept ?? "");
            if (this.opts.slideOn() && clear) this.makeSlide(me);
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
      if (this.current === me && !me.video.url) b.textContent = `${label}… ${Math.round((performance.now() - t0) / 1000)} s`;
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
            b.textContent = `▶ Watch the full video (${m}:${String(Math.round(ev.seconds % 60)).padStart(2, "0")})`;
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
        b.textContent = "The video failed: try again";
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
