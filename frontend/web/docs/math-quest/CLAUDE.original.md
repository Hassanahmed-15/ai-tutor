# CLAUDE.md: Math Quest

Context for Claude Code working in this repo.

## What this is
A complete browser game in **one file**: `public/index.html`. There is no framework, no bundler and no dependencies. The JS is a single `<script>` block wrapped in `{ … }`. `server/server.js` is a zero-dependency Node 18+ ESM server.

Run: `cd server && npm run mock` (fake AI) or `ANTHROPIC_API_KEY=… npm start`, then open http://localhost:3000.

## Map of public/index.html (search for these banners)
- `/* ================= save` — `S` (player state, saved in localStorage `mathquest-v2`), `DEF` (defaults), `ACH` (achievements).
- `/* ================= sound` — WebAudio sound effects (`sfx(name)`).
- `/* ================= canvas & scaling` — low-res buffer `VW×225` scaled to the screen; `R()` draws a pixel rect.
- `/* ================= themes` — `THEMES` palettes, procedural backgrounds `bgLayers()`, tiles `tileSet()`.
- `/* ================= questions` — `GEN.int/frac/alg/geo(tier, r)` generators, `fromGen`, `conceptQ(topic, 'A'|'B'|'M', tier)`, `CR` (which generator branches belong to concept A or B), `makeQ('custom')` for the AI bank.
- `/* ================= worlds` — `WORLDS` (id, topic, theme, boss, boss colours).
- `/* ================= level generation` — `genLevel(W, 'practice'|'boss')`: chunk functions (`flat`, `gap`, `floaters`, `spikes`, `slimes`, `bats`, `tower`, `bridge`, `knight`) and the boss arena. Tiles: 1 solid, 2 one-way platform, 3 spikes, 5 bridge, 6 energy wall.
- `/* ================= physics` — `GRAV, MAXF, ACC, MAXV, JV, DJV` (tuned for kids), `collide()`.
- `/* ================= challenges` / `update` — answer platforms (`aplat`), crystals, knights, cages, boss AI (`updBoss`), `hurt`, `respawn`, `gameOver`, `chargedTarget` (auto-aim).
- `/* ================= drawing` — sprites and `drawOverlay()`: HUD, question banner, labels, speech bubbles. These use the readable `FONT`, Nunito.
- `pm(text)` — turns AI plain-text maths into notation (`a^2` → a², `sqrt(x)` → √x). Wrap any AI text in it before display.
- `/* ================= platform adapter` — **the only code that talks to the outside world**: `MathQuestConfig`, `getSample()` (AI), `playerId()`. Leaderboard code is in `syncBoard()` and `loadBoard()`.
- `/* ================= Learning Portal` — `makeQuest()`: one AI call returns topic + diagnostic + learn cards + revise cards + 10 questions. Then come `cleanQs()` (validates each `check` expression with `evalX`), `verifyMC()` (second AI pass), `runDiag()`, `showPlan()` and `startPath()`.
- `/* ================= story & lesson content` — `NPC`, `STORIES`, `LESSONS` (per world, concept A/B). Edit text here.
- `/* ================= progression` — `NODES` (the 7 path steps), `addXP` (streak/day/week), `completeNode`, `showReward`.
- `/* ================= home` — Learn / League / Portal / Profile tabs.
- `/* ================= lesson player` — `playLesson(lesson, onDone)`. Card types: `learn`, `example` (steps), `check` (gen or qq), and `diag` mode.
- `/* ================= lesson visuals` — `drawVis()` animated diagrams (line, signs, bidmas, frac, fracadd, grid, ratio, balance, angle, tri, hex, rect, trirect, circle).
- `/* ================= story player` and portraits (`drawPortrait`, `npcSprite`).

## Rules when editing
- Text from the AI or from other users goes in with `textContent` (never `innerHTML`), and through `pm()` for maths.
- Every AI number question must keep a `check` expression, and the game must verify it with `evalX` before use. Never display an AI answer unverified.
- After changing question generators, re-run a correctness sweep: generate a few thousand questions with `conceptQ` and check that `choices.length === 3`, the choices are unique, and the right one is the computed answer.
- Keep the game a single file unless the user asks otherwise.

## Ideas / next steps the owner may ask for
- Sync `S` to the user's account: add `GET/PUT /api/progress` and call it from `save()`, debounced.
- A teacher dashboard: log `answered()` events to the server.
- More worlds: add to `WORLDS`, `THEMES`, `GEN`, `CR`, `LESSONS`, `STORIES`, `NPC`.
- A placement quick check for the main-world lessons, reusing `playLesson` with `diag:true`.
