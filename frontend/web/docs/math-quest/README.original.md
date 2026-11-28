# Math Quest

A 2D pixel-art maths platformer for ages 11–14, built as a single-page web game:

- **Learning path:** four worlds (Integers, Fractions, Algebra, Geometry). Each world has seven steps: Story → Lesson A → Practice A → Lesson B → Practice B → Revise → Boss.
- **Lessons:** explanation cards with animated diagrams, worked examples and quick checks, with Duolingo-style feedback.
- **Practice levels:** answer bridges, shield knights guarding captives, and boss fights. Questions adapt to the player.
- **Rewards:** streaks, a daily XP goal, a weekly league, achievements and a profile.
- **Learning Portal:** the student types any topic. Claude runs a 4-question quick check, recommends teaching from scratch, a quick revision or going straight to the game, then builds a level for that topic.
- **Euclid:** an AI tutor available in lessons and in the pause menu.

Built-in questions come from code generators that compute the answer. AI-written questions are checked by the game: number answers by its own calculator, and multiple-choice answers by a second, independent AI pass.

## Project layout

```
public/index.html   the whole game (HTML + CSS + JS, no build step)
server/server.js    zero-dependency Node server: serves the game, /api/ai, /api/leaderboard
server/package.json
.env.example        environment variables
CLAUDE.md           notes for Claude Code
```

## Run it locally

Requires Node 18 or newer.

```bash
# test without an API key (fake AI replies)
cd server && npm run mock          # → http://localhost:3000

# real AI
export ANTHROPIC_API_KEY=sk-ant-...
cd server && npm start
```

The four worlds, lessons, story and leaderboard work without AI. Only the Learning Portal and Euclid's live answers need `ANTHROPIC_API_KEY`.

## Putting it on your site

### Option A: iframe (quickest)
Host `public/index.html` and the two API routes on your domain, then embed:

```html
<iframe src="/math-quest/index.html?playerId=USER_ID&playerName=FIRST_NAME"
        style="width:100%;height:100vh;border:0" allow="autoplay" title="Math Quest"></iframe>
```

### Option B: your own page
Copy `public/index.html` into your site, then set the config near the top of the file, or define it before the game script:

```html
<script>
window.MathQuestConfig = {
  aiEndpoint: '/api/ai',                  // false turns AI features off
  leaderboardEndpoint: '/api/leaderboard', // remove to race practice bots only
  player: { id: currentUser.id, name: currentUser.firstName },
  headers: { 'X-CSRF-Token': csrfToken }   // optional
};
</script>
```

The game fills the whole viewport (`position: fixed`). Give it its own page or route.

## API contract (if you rewrite the server in your own stack)

**`POST /api/ai`**
- Request body: `{ "prompt": string, "mode": "text" | "json", "tier": "quick" | "default" }`.
- Call the Claude Messages API with the prompt as a single user message:
  - `tier: "quick"` → a fast model (default `claude-haiku-5-5`)
  - `tier: "default"` → `claude-sonnet-5-5`
- Response:
  - `mode: "text"` → `{ "text": "..." }`
  - `mode: "json"` → `{ "json": <parsed object> }`. Strip any ``` fences and parse the first `{…}` block.
- Rate limited → HTTP 429 or `{ "error": "rate_limited" }`. The game then shows a countdown and retries.

**`GET /api/leaderboard?week=YYYY-MM-DD`** (the week's Monday)
- Response: `{ "rows": [ { "id", "name", "wxp", "streak" } ] }`, sorted by `wxp` descending, max 30 rows.

**`POST /api/leaderboard`**
- Request body: `{ "id", "name", "wk", "wxp", "xp", "streak" }`.
- Upsert the player's row.
- In production, take `id` and `name` from your session, not from the request body.

## Before going live

- [ ] Keep `ANTHROPIC_API_KEY` on the server only.
- [ ] Put `/api/ai` behind your login, and keep a per-user rate limit. The sample server allows 12 calls per minute per IP (`MQ_AI_PER_MIN`).
- [ ] Swap `server/data/board.json` for your database.
- [ ] Derive the leaderboard `id`/`name` from the authenticated user.
- [ ] Optional: self-host the Google Fonts (Pixelify Sans, Nunito) if your CSP blocks fonts.googleapis.com.
- [ ] Progress is saved in the browser's `localStorage` (key `mathquest-v2`). To sync progress across devices, see "Ideas" in CLAUDE.md.
