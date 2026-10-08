# Aria in a classroom: full-body teacher decision report

2026-10-09. Written for the owner, from eight research angles and five gap-fill passes. Tags: **[confirmed]** checked against primary sources; **[partly]** checked and corrected (the corrected version is stated); **[reported]** unverified; **[repo]** checked in our code or data.

---

## 1. Executive answer

**Can we do it free, in the browser, live with the voice? Yes for a classroom. No for "indistinguishable from a recording" on a cheap Android.**

**What we can build.** A full-screen classroom with the board exactly as today. A whole-body Aria walks to the board, turns to the student, points, and writes with a marker whose tip rides the ink as it appears. It runs on the student's device in three.js: $0 per student, $0–$330 one-time for assets.

**What nobody can build yet.** No free, browser-based, real-time stack gives a photoreal full body, seen up close, on a cheap Android in October 2026. The best phone-browser candidate, GALA + DynaAvatar, has no released code, about 149 MB of weights, and was measured only on an iPhone 15.

**The realistic ceiling:**
- **Laptops and recent phones.** A gaussian-vrm splat body scanned from a real person, a FLAME splat head with today's lip-sync, and motion captured from a real teacher. Body about 6/10, motion 7–8/10. It breaks down at the hands and raised-arm joints, exactly the writing pose, so the camera cuts to the board when she writes.
- **Cheap Android.** Today's bust, a full-screen board and a hand-and-marker close-up, unless week 1 shows a body that adds 2 MB or less and holds 30 fps.

**Three gap-fill findings that change the plan:**
1. **Today's heads are not commercially safe [confirmed].** FLAME 2020/2023 is licensed for non-commercial research only, and our `skin.glb` ships FLAME-derived geometry to every browser. The four faces have no record of whose they are, and LAM's weights are CC BY-NC. The free fix: rebuild Aria's head on **FLAME 2023 Open (CC BY 4.0, November 2025)** from photos of a person who signs a release, ideally the same person whose body and motion we capture. The avatar is not deployed, so nothing has shipped yet.
2. **The hand mostly "writes" typeset text [repo].** Across 10 real lectures, text is 72–97% of a writing hand's travel. A marker gliding over Nunito glyphs looks fake unless it follows a handwriting path. Typed-prompt lectures (on the lesson canvas since 2026-10-02) can hand over a complete stroke plan before the board mounts; Motion boards need about 2 days of read-only instrumentation.
3. **We know nothing about our students' devices [repo].** There is no telemetry. Pakistan's web is 50.6% desktop and 48.4% mobile (StatCounter, September 2026), so a laptop tier reaches about half of students on day one. A device beacon ships first.

**The biggest lever is motion, not the body.** A real teacher's timing makes a 5/10 body read as a person; one capture day costs $20–$330.

**Framing.** The evidence favours a filmed lesson: a teacher angled to the camera, pointing at what she says, cutting to her hand while writing. Facing the viewer beat back-to-board by d = .54 (Fiorella et al. 2019).

**The decision in one line.** In week 1, ship the beacon, build the body-agnostic motion system on a placeholder (VRM rig, captured clips, an IK arm on a stroke plan, gesture tags, stage manager, camera director), race a splat body against a mesh body on two real Android phones, and start the licence-clean head. Tier by device.

---

## 2. The candidate architectures

**The shared composite.** Three layers, one camera: (1) a room backplate; (2) the existing board iframe, only ever 2D-scaled and translated; (3) the teacher's transparent WebGL canvas, `pointer-events:none`. She always stands between camera and board, so no depth hole is needed and the board keeps its sharp DOM text. Options 1–3 share the motion system (section 5); options 1, 2, 4 and 5 need the rebuilt head.

| | **1. Splat body** | **2. Mesh body + splat head** | **3. All-mesh teacher** | **4. Director's cut (no body)** | **5. Pre-rendered body loops** |
|---|---|---|---|---|---|
| **Stack** | gaussian-vrm (MIT code), body from our own Scaniverse scan, FLAME head on the neck bone (the loader treats bone 57 as the head group, so the scan's head can be hidden), VRM clips | Rocketbox lowpoly (MIT) or MPFB2 (CC0) re-rigged to VRM humanoid, meshopt GLB, splat head grafted on, collar over the seam | Rocketbox with its own ARKit face (AK_01..AK_52 renamed), driven by our 52 weights | Bust beside a full-screen board, plus a rigged forearm, hand and marker GLB in close-ups, plus camera cuts | Option 1 or 2's body rendered offline into stacked-alpha H.264 loops per state (idle, walk A→B, turn, point); live head on a baked neck track; live IK forearm while writing |
| **Realism (body / face)** | 6/10 / head | 5/10 / head; clash up close | 4–5/10 / 4–5/10 | none / head | 6–7/10 / head; loops repeat |
| **Movement** | Walk, turn, point; 7–8/10 captured, 6/10 library | same | same | head and hand | baked paths only |
| **Writing** | 5/10: skinning stretches, soft hands; cut to close-up | 7/10: clean arm, real marker, IK | 7/10 | 6/10: tip exactly on the ink | 4–5/10: elbow seam |
| **Cheap Android** | **Unknown**; iPhone 13 Pro 40–50 fps; two sorters | Likely; 30–60 fps estimated | Best 3D: one renderer | Yes, today's cost | Likely: 1–2 streams + shader |
| **Download (head 4.1 MB)** | .gvrm 26.9–62.3 MB incl. a fixed 10.3 MB mesh: fails the phone budget | 3–8 MB GLB (unverified) + clips; phones need ≤2 MB | 3–8 MB + clips | +0.5–1 MB | ~0.5–1.5 MB/s at 720p (est.); 10 states at 360p ≈ 5–10 MB (est.) |
| **Cost** | $0; scan release | $0 | $0 | $0 | $0 |
| **Effort (motion system +15–22 d)** | 8–15 d | 10–20 d | 10–15 d | 4–6 d | 15–25 d |
| **Main risk** | Android fps, size, sotai.vrm terms, upstream renderer in maintenance | Uncanny face on game body; neck seam | Misses the photoreal brief | Not "whole body" | Download, repetition, seams |

**Rejected, now with numbers:**
- **Server-rendered streaming avatars.** Gemini Live already costs at least **$0.023/min** with the mic open [confirmed: `lib/modelPricing.ts`, Google's pricing]. Tavus is $0.32–0.37/min (about 15x), Anam $0.11–0.16 ($0.04 enterprise), bitHuman $0.04 cloud or $0.02 self-hosted; MuseTalk-class on an Azure spot T4 ($0.164/h) is about $0.003/min at one stream per GPU. The cheap ones fit under 2x Gemini, but all render only a face or bust, none takes stroke input, and a 480p stream costs the student 4–7 MB per minute: our whole one-time download every 2–4 minutes.
- **2D puppets (Spine, Rive, Live2D).** Tiny runtimes (Spine 77 kB, Live2D Core 61 kB, Rive 367–925 kB gzipped), likely 60 fps anywhere, and Spine and Rive IK can follow ink at runtime. But a photo cut-out cannot turn or walk convincingly; 20–30 days plus art. Spine $379 per developer, Rive $9/seat/month without the splash, Live2D free under ¥20M a year.
- **Filmed green-screen teacher with live head and arm.** Most realistic standing still, but seams at collar and wrist, no paths beyond those filmed, 20–35 days plus a shoot. This replaces my earlier one-line dismissal of video sprites.
- **Unity WebGL** (20–50 MB+, poor on low-end Android); **MetaHuman** (XL effort, no glTF, web creator closes 5 Nov 2026); **native runtimes** (HRM²Avatar is Metal-only; MNN-TaoAvatar needs Snapdragon 8 Gen 3, 8 GB RAM, 5 GB storage); **FlowMDM ONNX** (non-commercial, 86.8 MB).
- **Watch list:** GALA/DynaAvatar (unreleased, unlicensed, 149 MB) and Visionary + LHM++ (WebGPU, discrete GPU recommended). SMPL-X needs a commercial licence. Recheck Q1 2027.

---

## 3. Evidence highlights, with corrections

**Photoreal splat bodies**
- **gaussian-vrm [partly].** Code MIT; `assets/` and `examples/assets/` are research-only; only the six Google Drive samples are MIT (with a public-morality condition). Every .gvrm embeds JOKER's sotai.vrm (free use, no standalone redistribution). 40–50 fps on iPhone 13 Pro; "240 fps" on an RTX 3060 is the display cap; no Android, resolution or Gaussian count. Samples are **26.9–62.3 MB** (not 27–47): a fixed 10.3 MB VRM, a 12–37 MB PLY and a 4.6–14.5 MB JSON.
- **GALA [confirmed].** 40,000 Gaussians, 60 fps in a phone browser, WebGL only ("iPhone 15" is from the project page); five avatars at 20 fps; 88.3 + 60.7 MB ≈ 149 MB; "Code coming soon", no licence; test subjects were in training.
- **Visionary [reported]:** WebGPU, no mobile figures. **Spark SplatSkinning [reported]:** experimental, no example. **LHM++ [reported]:** T-pose PLY for two variants only.

**Licences of what we already ship [confirmed unless noted]**
- **FLAME 2020/2023:** "non-commercial scientific research, non-commercial education"; bans "use in a commercial service" and making it "available in any form to any third party". Commercial licence via ps-license@tue.mpg.de, price unpublished.
- **FLAME 2023 Open** (November 2025): CC BY 4.0, bans pornographic and defamatory use; conversion code published.
- **`skin.glb` [repo]:** 20,018 vertices and 39,904 faces, i.e. FLAME's 5,023/9,976 mesh subdivided once, 51 ARKit morph targets. DAZ Genesis-style bone names (`lThighBend`, `abdomenLower`) may carry DAZ terms (unresolved).
- **Jack, Jane, John, Sasha:** from NavodPeiris/gsplat-talkinghead (MIT, one commit, 2026-09-28), "LAM Gaussian-Splat Avatars"; no source photos or consent stated.
- **LAM:** code Apache-2.0, weights CC BY-NC 4.0, loads research-only `flame2023.pkl`. Whether NC reaches generated heads is uncertain.
- **Clean:** the @myned-ai renderer 1.4.0 and its upstream (MIT, code only), GaussianSplats3D (MIT), three-vrm (MIT), Quaternius (CC0). VRoid terms unchecked; each VRM carries `commercialUsage` metadata.

**Platforms and rigged bodies**
- **Platforms [partly].** Netflix bought Ready Player Me (services off from 31 Jan 2026); Union Avatars' closure is second-hand; Epic bought Meshcapade on 18 Feb 2026. **Correction:** meshcapade.com now states its platforms shut down "as of April 18th"; the earlier draft said nothing supported that date. It lists no licensing path, so who sells FLAME licences after Epic is uncertain.
- **Rocketbox [partly].** MIT, archived 2 Oct 2026. ARKit-equivalent shapes AK_01..AK_52 in a separate `*_facial.fbx`; Biped skeleton needs a re-rig; TalkingHead ships the rename script; 471 animation FBXs. Also the licence-clean fallback face.
- **RPM clips** are licensed for Ready Player Me avatars only: the `unity-campus-poc` clips must not ship. **Mixamo [partly]:** recurring outages, unsupported.

**Motion**
- **CPU cost [partly].** Apple M4: 65 bones, 3 clips and a CCDIK arm ≈ 26 µs/frame; budget Android estimated 0.15–0.5 ms. Rendering is the bottleneck.
- **Mesh2Motion [reported]:** 96 CC0 clips. **HY-Motion [reported, conflicting]:** territory limits; needs a legal read. **Co-speech gesture models:** no usable licence.
- **Purdue instructor avatar [reported].** Writes, points, underlines and circles by IK from three scripted pose stations. Closest precedent.

**Our boards and the writing hand [repo]** (10 production lectures from Cosmos replayed through `ReactAnimationSandbox` and `/canvas-lab` at 2.6 words/s; $0 API cost)
- **Correction:** the `marker` posts (lines 839, 873) come only from the legacy timeline. Motion boards "reveal and animate themselves from the sentence clock", and the host's stroke tracing "does not run on" them (lines 274–280).
- **Canvas (36 boards):** positions come from the pure `layoutPanel(spec)`, every mark carries its sentence, durations are fixed CSS (write 0.9 s, stroke 0.85 s, pop-in 0.48 s). Text ≈ 80% of hand travel.
- **Motion (20 boards):** 11% `pathLength` strokes (0.87 s, 82% within 0.25 s of their sentence); 37% clip-revealed text (median 0.72 s, only 51% on their sentence, pen-queue lag p90 1.79 s); 52% fades or instant shapes. Text ≈ 97% of hand travel. Geometry is knowable at mount; the sentence is not in the DOM.
- **Legacy (10 boards):** 60% strokes; `planFor` already computes each step's window.
- **No 3D board texture.** The iframe has no `allow-same-origin` (line ~866), and three.js HTMLTexture (r184) cannot paint it [reported]. Keep the sandbox.
- **Two contexts in v1:** the head renderer creates its own `WebGLRenderer`; gaussian-vrm bundles another GaussianSplats3D fork. `AvatarFlyer.tsx` already moves Aria between slots.

**Devices and network**
- **No telemetry [repo].** Container logs only; one unrecorded WebGL2 check (`AriaAvatar.tsx:96`). Cosmos, 60 days: 33 users, 417 sessions, mostly the team.
- **Pakistan [confirmed].** Android 45.2%, Windows 43.2%; phones Samsung 17%, Infinix 15%, Vivo 12%, Xiaomi 11%.
- **Chromium [confirmed, source].** Android allows 8 WebGL contexts (oldest evicted): two fit, memory is the risk. `deviceMemory` rounds to powers of two (3 GB reports 2). `downlink` caps at 10 Mbps with noise; "3g" means ≤700 kbps.
- **Alpha video [confirmed].** Safari lacks VP9 alpha; Chrome decodes alpha in software. Stacked-alpha (colour above alpha, joined by a shader) works everywhere; use H.264 on budget Mali phones.

---

## 4. Pedagogy: does a body help, and how should we frame it?

**The evidence, now mostly verified:**
- **Guo, Kim, Rubin 2014 [confirmed].** 6.9M sessions: shorter videos, informal talking heads and Khan-style drawing were more engaging (watch time, question attempts). Engagement, not learning.
- **Fiorella, Stull, Kuhlmann, Mayer 2019 [confirmed; attribution corrected].** Drawing live beat static drawings (d = .54); a see-through board with eye contact beat a back-turned normal board (d = .54). Visibility alone gave no benefit.
- **Alemdag 2022 meta-analysis [confirmed].** 20 studies: instructor presence had no significant learning effect and raised both cognitive load and motivation; hand-only video was favoured. (Polat 2022 is a review, not a meta-analysis.)
- **Mayer & DaPra 2012 [confirmed].** Human-like gesture and movement improved transfer across 3 experiments, only with a human voice. Gemini's voice qualifies: the strongest case for a gesturing body.
- **Purdue and Frontiers 2025 [reported; verification did not find them].** Students preferred full upper-body or pointing-only avatars; removing gestures lowered male students' trust ratings.
- No 2020–26 full-body versus head-only study was found.

**What follows.** A body earns its place through **signalling** (pointing, eye contact), **social presence** (motivation, trust) and **pacing** (walking marks a section change). Its cost is cognitive load, so she stays mostly out of frame while ink goes down. The brief is "a good camera operator filming a teacher"; a back-of-classroom camera is the weakest format in the evidence.

**Screen arithmetic:**
- **Phone landscape (~800×360).** Full figure ~330 px, face ~43 px: lip-sync invisible. Wide shots establish only; talking is waist-up (head ~110 px).
- **Laptop (1366×768).** Body ~690 px, head ~92 px; board ~72% of width.
- **Phone portrait (360×780).** No body; full-width board, bust as today.

**Shots, run by a camera director** (3D camera and board transform move together):
1. **Establishing (wide):** 2–3 s at start and each section change; no new ink.
2. **Explaining (medium):** board at ~72–80% scale, Aria waist-up in her column.
3. **Writing (close-up):** board at native 1.0, forearm, hand and marker only; any stroke over ~4 s, always on phones.
4. **Answering or revisiting (face close-up):** where the photoreal head pays off.

**Occlusion rules, every frame:**
1. **Ink is sacred.** Her silhouette never covers the active stroke's box or ink from the last 10 s, except the writing forearm. Zero violating frames, checked automatically.
2. **Stations (Purdue):** A frontal, B near-profile, C far-profile reaching; she walks there while talking, before an out-of-reach stroke.
3. **Three-quarters to camera** when writing, never full back.
4. **Write strokes and text; point at fades** (52% of Motion elements), never a fake writing motion.
5. **4–6 gestures per minute;** the writing hand wins.
6. **Student turns** (Try-it, Draw-it, Predict, student pen): she steps clear into a listening pose; her layer never takes input.

---

## 5. Recommended path and staged plan

**The recommendation:**
- Build the composite on the **VRM humanoid rig**, so one clip library, IK setup and gesture bank serve any body.
- Drive motion from a real teacher's captured clips; fill gaps with Mesh2Motion and Quaternius (CC0).
- **Rebuild the head** on FLAME 2023 Open from a consenting person's photos. Today's heads stay off any public deployment.
- Choose the body by a measured race; tier by device from beacon data.

### Week 0 (now, 1–2 days)
- **Device beacon:** one `sendBeacon` on `pagehide` into a 90-day-TTL Cosmos container, no user id or IP: `deviceMemory`, cores, WebGL2, GPU family, screen, orientation, connection, `saveData`, avatar time-to-ready, frame-time p50/p95, context losses, `wasDiscarded`.
- **Licence emails** to ps-license@tue.mpg.de (FLAME commercial price) and JOKER (sotai.vrm), in parallel with the Open route.

### Week 1: spike in anim-lab, run the race

| Day | Work |
|---|---|
| 1 | Two phones: budget Helio G85 / Mali-G52 and mid-range Helio G99 (Infinix or Tecno; Infinix holds 15%). Baseline today: board animating, bust lip-syncing, live voice. |
| 1–2 | Composite with a placeholder VRM body (Quaternius, 1.7 MB) and the head tracked to the neck bone; Mesh2Motion idle, walk, turn; state machine (idle → walk to station → write → turn and explain); two-bone IK arm; **canvas stroke plan** (0.5 day). |
| 2–4 | **Splat spike:** Scaniverse A-pose scan → .gvrm, 100–150k splats, deflated JSON; size and fps on both phones with the board running. |
| 4–5 | **Mesh spike:** Rocketbox lowpoly, re-rigged, decimated toward 2 MB. Owner reviews both at a medium shot. |

**Stroke plans per board type (board render unchanged):**
1. **Canvas:** built in the parent from layout marks; `Ink` centre lines are exact paths. 0.5 day, no sandbox change.
2. **Motion:** at boot, while animations are skipped, render once per sentence to map elements to sentences; wrap `motion` to copy each delay and duration into `data-ink-*` attributes; `PEN.begin` posts the text box, character count and speed (16–30 chars/s). About 2 days. The hand follows `PEN.begin`, not the sentence clock, and the extra renders must finish before `ready`.
3. **Legacy:** emit `planFor`'s output, consume `marker`. 0.5 day.
4. **Text as handwriting:** a baseline sweep at the pen tip (+0.5 day), or Relief SingleLine (OFL) fitted to measured word boxes as an invisible hand path (+2 days). Not Vara.js: it draws its own text.

The host moves the IK target on its own clock; `pen paused` and `settle` say when to stop.

**Go/no-go gates, end of week 1:**
- **G1, performance.** Budget phone, board animating, voice live: ≥30 fps over 5 minutes, p95 ≤40 ms, ≥24 fps at 10 minutes; no context loss or tab discard over 10 minutes on a 3 GB phone.
- **G2, download.** Phone tier: body plus clips add **≤2 MB** to the 4.1 MB head, after the first board (6 MB at 700 kbps ≈ 70 s). Laptop tier: ≤15 MB total. Use the app's own measured speed; `downlink` is capped and noisy.
- **G3, writing sync.** Tip within 12 px of the ink at 1080p, ≤1 frame lag; canvas lectures first, then Motion text.
- **G4, look.** Owner accepts the neck join at a medium shot.
- **G5, ink.** Zero frames covering recent ink.
- **G6, licence.** A commercially usable head route is confirmed, or option 3 is the fallback.

**Decisions:**
- The splat body cannot meet phone G2 with its fixed 10.3 MB mesh: at best it is the laptop photoreal tier.
- The mesh body passes G1 and G2 on the mid-range phone → the phone 3D tier; budget phones get the director's cut.
- Both fail on the budget phone → expected; it still gains the full-screen board, hand close-ups and camera language. If that feels thin, test option 5 in week 3 (ten 360p loops, decode measured on the budget phone).

### Weeks 2–4: one real person
- **Capture.** One person signs a release for likeness, scan, photos and motion. About 25 states from the state machine plus ~12 Purdue gestures. Kit: Sony mocopi (~US$330, drifts), Rokoko Vision (~$20/month), FreeMoCap (free; AGPL software, our data) or NVIDIA GEM-X (Apache-2.0 code, NVIDIA Open Model License weights). Avoid GVHMR and WHAM (non-commercial).
- **Head.** Fit the same person to FLAME 2023 Open with a commercially licensed generator, keeping the 52-weight lip-sync. Failing that, option 3's face or a bought FLAME licence.
- **Clean-up.** Blender retarget onto VRM (2–3 days); IK corrects the writing hand; quaternion-averaged skinning (2–3 days).

### Weeks 4–8: polish
- **Gestures.** Tags in the lecture text (`::point T2::`, `::underline::`), scheduled ahead because the transcript precedes the audio; beat pulses on speech peaks; free hand only.
- **Room.** 150–300 KB WebP backplate, soft shadow on the board.
- **Tiers** (revise from beacon data): **T0** no WebGL2, `deviceMemory` ≤2, `saveData` or 3g → orb or 2D bust. **T1** budget or portrait → director's cut. **T2** `deviceMemory` 4, ≥6 cores, passing a 3 s probe → mesh body sharing the head's context. **T3** `deviceMemory` ≥8 or desktop → splat body; WebGPU later. A watchdog drops to T1, voice untouched, if p95 exceeds 40 ms for 5 s.

**Total effort.** About 9–11 engineer-weeks to production, demo-able after ~3, plus the head rebuild (unestimated; depends on the generator). One-time $0–$330 plus releases; $0 per student.

---

## 6. What stays untouched

- **The board.** It stays in its opaque-origin sandbox: no texture capture, no CSS3D. The camera faces it straight on, so moves are pure 2D scale and translate, and "author at full size, only scale down" keeps text sharp. Pictures, notes, labels, the pen, the lesson canvas, the student pen and Try-it behave as today. The only additions are read-only: `data-ink-*` attributes and boot measurement renders on Motion boards, plus stroke-plan messages. The canvas needs no sandbox change.
- **Lip-sync.** The 52 ARKit weights, audio-clock mouth timeline and forced alignment are unchanged; only the head asset is replaced. The head takes its pose from the neck bone and keeps its own canvas in version 1.
- **Voice.** Gemini Live, barge-in and gating as they are.
- **Cost.** Nothing runs on a server for the teacher.

---

## 7. Open questions

1. **gaussian-vrm on Android:** fps at ~150k splats with head and board running. No figure exists.
2. **.gvrm size and sotai.vrm:** can the loader drop the 10.3 MB mesh, and may every file serve it?
3. **Head generator:** which photo-to-FLAME generator has commercially usable weights and supports FLAME 2023 Open? Does LAM's CC BY-NC reach generated heads? Who sells FLAME licences after Epic, at what price?
4. **DAZ:** do the Genesis-style bone names in `skin.glb` bring DAZ terms?
5. **One real person:** will a teacher sign a release for scan, photos, motion and likeness?
6. **Unread licences:** HY-Motion, Mixamo and Reallusion web delivery, VRoid placeholders, Hershey fonts (the Hershey Text extension is GPL).
7. **Neck seam:** acceptable at a medium shot, or does "filmed up close" force one representation?
8. **Memory:** do two WebGL contexts fit 2–3 GB phones?
9. **Motion boards:** cost of the boot renders; does the handwriting path cover Urdu?
10. **GALA and Visionary:** release, licence, sub-20 MB quantisation; WebGPU on mid-range Android.
11. **Fleet:** portrait share, GPU mix, bandwidth, from the beacon.
12. **Pedagogy gaps:** Purdue and Frontiers 2025 unverified; Fiorella's n, Alemdag's pooled g.

---

## 8. Sources

**Splat bodies and runtimes**
- https://github.com/naruya/gaussian-vrm
- https://arxiv.org/html/2510.13978v2
- https://arxiv.org/html/2610.02207v1
- https://ramazan793.github.io/gala/
- https://github.com/ramazan793/gala
- https://github.com/Visionary-Laboratory/visionary
- https://arxiv.org/html/2512.08478v1
- https://github.com/sparkjsdev/spark/blob/main/src/SplatSkinning.ts
- https://github.com/sparkjsdev/spark/releases
- https://github.com/aigc3d/LHM-plusplus
- https://arxiv.org/abs/2509.11411
- https://github.com/mkkellogg/GaussianSplats3D
- https://github.com/myned-ai/gsplat-flame-avatar-renderer
- https://github.com/aigc3d/LAM_WebRender
- https://github.com/alibaba/Taobao3D/tree/main/HRM2Avatar
- https://github.com/alibaba/MNN/tree/master/apps/Android/MnnTaoAvatar

**Head and model licences**
- https://flame.is.tue.mpg.de/modellicense.html
- https://flame.is.tue.mpg.de/
- https://meshcapade.com/
- https://github.com/aigc3d/LAM
- https://github.com/NavodPeiris/gsplat-talkinghead
- https://smpl-x.is.tue.mpg.de/modellicense.html

**Rigged bodies and platforms**
- https://github.com/microsoft/Microsoft-Rocketbox
- https://github.com/met4citizen/TalkingHead
- https://github.com/makehumancommunity/mpfb2
- https://github.com/pixiv/three-vrm
- https://quaternius.itch.io/universal-base-characters
- https://quaternius.com/faq.html
- https://www.pocketgamer.biz/netflix-acquires-avatar-creation-platform-ready-player-me
- https://roadtovr.com/netflix-acquires-xr-avatar-startup-ready-player-me/
- https://avatarsdk.com/blog/2026/07/07/union-avatars-shut-down/
- https://www.mpg.de/26082348/max-planck-spin-off-draws-epic-games-to-tuebingen
- https://heise.de/-11182302
- https://github.com/readyplayerme/animation-library
- https://community.adobe.com/questions-696/mixamo-down-589819
- https://community.adobe.com/questions-696/mixamo-faq-licensing-royalties-ownership-eula-and-tos-589400
- https://forum.reallusion.com/PrintTopic335621.aspx
- https://www.cgchannel.com/2025/06/you-can-now-sell-metahumans-or-use-them-in-unity-or-godot/
- https://unrealsource.com/d/metahuman-creator-web-app-discontinued/

**Motion**
- https://github.com/Mesh2Motion/mesh2motion-assets
- https://github.com/scottpetrovic/mesh2motion-app
- https://quaternius.itch.io/universal-animation-library
- http://mocap.cs.cmu.edu/
- https://github.com/Tencent-Hunyuan/HY-Motion-1.0
- https://huggingface.co/ZeyuLing/Motius-GEM-X
- https://rokoko.com/products/video
- https://www.sony.jp/mocopi/info/20260605.html
- https://github.com/zju3dv/GVHMR
- https://www.cs.purdue.edu/cgvlab/www/resources/papers/Cui-IEEE-2017-Animation_Stimuli_system_for_research_on_Instructor_gestures_in_education.pdf
- https://threejs.org/docs/pages/CCDIKSolver.html
- https://github.com/mrdoob/three.js/blob/dev/examples/webgl_animation_walk.html
- https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_animation_retargeting.html
- https://openaccess.thecvf.com/content/CVPR2026/html/Saleem_LiveGesture_Streamable_Co-Speech_Gesture_Generation_Model_CVPR_2026_paper.html
- https://github.com/PantoMatrix/PantoMatrix
- https://github.com/facebookresearch/audio2photoreal
- https://huggingface.co/dasilva333/flowmdm-onnx
- https://github.com/BarqueroGerman/FlowMDM

**Board ink and handwriting**
- https://github.com/isdat-type/Relief-SingleLine
- https://github.com/akzhy/Vara
- https://gitlab.com/oskay/hershey-text

**2D, video and puppet routes**
- https://jakearchibald.com/2024/video-with-transparency/
- https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/
- https://github.com/jakearchibald/stacked-alpha-video
- https://rive.app/pricing
- https://rive.app/docs/editor/constraints/ik-constraint
- https://rive.app/docs/editor/data-binding/overview
- https://esotericsoftware.com/spine-purchase
- https://esotericsoftware.com/spine-runtimes-license
- https://en.esotericsoftware.com/spine-runtime-skeletons
- https://www.live2d.com/en/sdk/license/

**Streaming cost**
- https://ai.google.dev/gemini-api/docs/pricing
- https://www.tavus.io/pricing
- https://anam.ai/pricing
- https://bithuman.ai/pricing
- https://prices.azure.com/api/retail/prices
- https://github.com/TMElyralab/MuseTalk

**Devices and network**
- https://raw.githubusercontent.com/chromium/chromium/main/content/renderer/webgraphicscontext3d_provider_impl.cc
- https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/common/device_memory/approximated_device_memory.cc
- https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/network/network_state_notifier.cc
- https://wicg.github.io/netinfo/
- https://gs.statcounter.com/platform-market-share/desktop-mobile-tablet/pakistan
- https://gs.statcounter.com/vendor-market-share/mobile/pakistan

**Composition and pedagogy**
- https://drei.docs.pmnd.rs/misc/html
- https://github.com/mrdoob/three.js/blob/dev/examples/jsm/renderers/CSS3DRenderer.js
- https://discourse.threejs.org/t/css3drenderer-gets-blurry-in-some-situations-what-might-be-the-problem/50179
- https://onbugs.webkit.org/show_bug.cgi?id=263454
- https://public-pages-files-2025.frontiersin.org/journals/computer-science/articles/10.3389/fcomp.2025.1615791/text
- https://doi.org/10.1145/2556325.2566239
- https://doi.org/10.1037/edu0000325
- https://doi.org/10.1016/j.compedu.2018.02.005
- https://doi.org/10.1007/s10639-022-11154-w
- https://doi.org/10.1007/s10639-022-11532-4
- https://doi.org/10.1037/a0028616
- https://doi.org/10.1037/edu0000221
