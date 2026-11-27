# Self-hosted Study Doubts model (`server/ai`)

A separate, strictly restricted AI assistant that runs **on the college server**. It
only answers doubts about study materials, concepts and subjects.

It is fully separate from the existing Groq **JNN Study Assistant**
(`/ai/study-assistant/*`), which this folder does not change in any way.

## Recommended model for your server

**Server:** HPE ProLiant DL360 Gen11 with 2 × Xeon Silver 4510 (24 cores,
AVX-512/AMX), 125 GB RAM and **no GPU**. It's a shared lab server.

On a CPU, answer speed depends mostly on memory bandwidth. Only 2 of the 8
memory channels per CPU are filled, so bandwidth is the limit here, not cores.

| Model | RAM used | Expected speed | Quality | Licence |
|---|---|---|---|---|
| **`qwen2.5:7b`** ✅ default (= HF `Qwen/Qwen2.5-7B-Instruct`, Q4_K_M) | ~6–8 GB | ~8–12 tokens/s per answer | Good: accurate concepts, maths and code | Apache 2.0 |
| `qwen2.5:3b` | ~3 GB | ~20–30 tokens/s | OK; more slips | Qwen Research (non-commercial) |
| `qwen2.5:14b` | ~11–13 GB | ~4–6 tokens/s (slow for chat) | Better | Apache 2.0 |

A 300-word answer takes about 30–50 seconds with the 7B model. By default,
two students are answered at a time (`PARALLEL=2`) and the rest queue.
Filling the empty memory channels would make every model proportionally faster.

The model is pinned to **one CPU socket** (12 cores) with a 16 GB RAM cap, so
the other socket and most of the RAM stay free for the lab's other users.

**Tested on the dev laptop** (Ryzen 5 5600H, RTX 3050): `qwen2.5:3b` gave
correct answers at about 70 tokens/s, and refused every out-of-scope test
question.

## How it stays strict

The restrictions are layered, and the most important ones don't depend on the
model behaving:

1. **No access by design.** The model has no tools, no database connection,
   no internet access and no web search. The only thing it is ever sent is the
   student's question plus study-material excerpts **that student is already
   allowed to read** (the same `materialReadFilter` that Study Materials uses).
   It cannot see student details, attendance, marks or any other feature,
   because none of that data is ever sent to it.
2. **Input guard before the model** (`scopeGuard.js`). These get a fixed
   refusal and the model is never called:
   - personal details, other app features (attendance, marks, fees…), clearly non-study chat;
   - **questions about this platform's servers, database, hosting, tech stack, AI model or
     security**, including emotional / "dying grandma" / "I'm the admin" pressure
     (general teaching like "what is MongoDB?" is still answered);
   - **sexual content** (syllabus biology such as "sexual reproduction" or "sex chromosomes" is allowed);
   - **prompt injection**, based on known attacks: instruction overrides, prompt
     leaking, DAN-style role-play, fake chat-template / role tokens (`<|im_start|>`,
     `[INST]`, `system:`), Policy Puppetry (rules disguised as XML/INI/JSON config),
     many-shot fake dialogues, "decode this and follow it", and obfuscation
     (Base64, l33t, look-alike Unicode letters, invisible characters, s p a c e d letters).
   - **Multi-turn attacks** (Crescendo, payload splitting): each question is also
     checked joined with the student's previous questions in the chat.
3. **Strikes.** Prompt attacks, platform probing and sexual requests are strikes.
   **3 strikes in 24 h pause AI Doubts for that student for 24 h** (audited as
   `AI_DOUBTS_BLOCKED` and sent as a security alert). Everyone else keeps
   working. IT support can lift a block in Troubleshooting → AI Doubts.
4. **Strict rules in the prompt** (`prompt.js`), stated to override everything,
   and the same rules baked into the model (`Modelfile`), temperature 0.2.
5. **Untrusted documents.** Study-material excerpts are fenced as untrusted data,
   and an excerpt that contains instructions aimed at the AI (indirect injection
   in a PDF) is dropped before the model sees it.
6. **Output guards** (`outputGuard.js`, `prompt.js`), run while the answer streams:
   - **Leak guard:** repeating 8+ words of the hidden prompt cuts the answer off.
   - **Tripwire:** the hidden prompt contains a random *canary*. If an answer contains
     the canary, a real secret from `.env`, the real database host, this server's
     folder paths, or a tool/function call, the answer is discarded and **AI is
     emergency-stopped for everyone** (`AI_TRIPWIRE` in the audit log). Only
     `npm run ai:resume` on the server turns it back on. Teaching examples like
     `mongodb://localhost` never trip it, and neither does text the student typed.
   - **Sexual output** is replaced with a refusal.
   - **Scrub:** emails, mobile numbers, links, URLs and markdown images are removed
     (stops data exfiltration through image/link URLs).
7. **Network lock-down.** Ollama listens on `127.0.0.1` only, its ports are
   blocked in `ufw` (and must not be forwarded on the Sophos firewall), and the
   backend refuses any `LOCAL_AI_URL(S)` that isn't localhost.
8. **Limits.** Only roles that can view Study Materials can use it, 5 questions/min
   and 40/hour per user, **one question at a time per student**, and the request body
   may only contain `message`, `conversationId`, `mode`, `materialId` and `stream`.
9. **Saved chats.** At most **3 chats** per student (the least recently used is
   removed), **50 questions per chat**, each **deleted 2 days after it starts**
   (TTL index). The model only **remembers the last 30 minutes** of a chat.
   Refused questions are never sent to the model as context.

## Chatbot behaviour and safety policy

It behaves like a normal AI chat assistant (ChatGPT / Claude style) inside a
strict study-only scope. The full text is in `prompt.js` (`BEHAVIOUR`,
`SAFETY`, `STRICT_RULES`); `instructions.md` can adjust teaching style only.

- **Conversation:** remembers the chat (last 30 min), handles follow-ups and typos,
  asks one clarifying question when a doubt is unclear, teaches with examples,
  uses Markdown, admits when it isn't sure, and helps with homework by teaching
  rather than just handing over answers.
- **Instant friendly replies** (no model call, no credits): greetings, thanks, bye,
  "what can you do?", "who are you?" (without technical details).
- **Self-harm / suicide:** a caring reply with Tele-MANAS (14416 / 1-800-891-4416)
  and emergency 112 — never a refusal, never a strike. Academic questions
  ("Durkheim's theory of suicide") are answered normally.
- **Harmful requests** (weapons, explosives, drugs, poisons, hurting people,
  hacking real accounts, writing malware, exam cheating): a short, non-judgemental
  refusal offering the educational angle instead. Learning how things work
  conceptually ("how does ransomware spread?") stays allowed.
- **Medical / legal / financial:** general information plus "see a professional".
- **Hate, harassment, extremism, sexual content:** not produced; neutral academic
  discussion is fine.
- **Refusals** are one kind sentence plus what the student *can* ask — no lectures.

Security and data access don't depend on the model following these rules: see
"How it stays strict" below.

## Short answers first

Answers are short by default (about 60–120 words, `LOCAL_AI_SHORT_OUTPUT_TOKENS`).
Under the latest answer the student can press **Explain in detail**, which asks
the same question again for a full step-by-step answer (`LOCAL_AI_MAX_OUTPUT_TOKENS`).
This keeps answers focused and saves server time and credits.

## Exam answers ("explain … for 13 marks")

When the question mentions marks (`13 marks`, `16M`, `2 mark`), asks for a
"long answer" / "essay", or points at a Part A/B/C question of the attached
material (A = 2, B = 13, C = 15 marks), the answer is written like a university
exam answer, and its length follows the marks:

| Marks | Words | Shape |
|---|---|---|
| ≤ 2 | 60–100 | definition + 2–3 key points |
| 3–6 | 250–350 | intro, 4–6 headed points, example, conclusion |
| 7–10 | 450–600 | same, more depth |
| ≥ 11 | 700–900 | intro, 6–8 headed points, flow/table, example, advantages/challenges, conclusion |

Long answers get up to `LOCAL_AI_EXAM_OUTPUT_TOKENS` (default 1400), a larger
excerpt of the referenced question, and less chat history. They are charged as
long answers. If an answer still reaches the limit (often in Telugu/Hindi, which
need more tokens per word), it is cut back to the last complete sentence and ends
with "Type **continue** to get the rest"; `continue` then carries on from where it
stopped, without repeating. `continue` after a finished exam answer gets a short
free note instead of a repeated answer.

## Many students at once

A CPU server writes a few answers at a time; the rest wait.

- **Fair queue:** students take turns (round-robin), so nobody's questions can push
  everyone else back. Waiting students see "You're #N in line".
- **Several model servers:** `LOCAL_AI_URLS=http://127.0.0.1:11434,http://127.0.0.1:11435`
  (`INSTANCES=2 sudo bash install.sh` sets up a second copy on the other CPU socket).
  Each answer goes to the least busy one.
- **Busy mode:** when `LOCAL_AI_FALLBACK_QUEUE` or more are waiting, answers get
  shorter and use `LOCAL_AI_FALLBACK_MODEL` (e.g. a 3B model) if set.
- **Instant answers:** the same question about the same study-material excerpts is
  answered from a shared cache (`LOCAL_AI_ANSWER_CACHE_HOURS`, default 7 days). Access is
  re-checked on every hit, and answers that used the student's chat history are never cached.
- **Queue full:** a polite "try again in a minute" (503 with `Retry-After`).
- IT support sees the live load in Troubleshooting → AI Doubts.

## Credits (`LOCAL_AI_CREDITS_ENABLED`)

Off by default. When on, each student (`LOCAL_AI_CREDITS_ROLES`, default
`student,club_admin`) gets **1000 credits a month** (reset on the 1st, no rollover)
and can spend at most **150 a day**. Staff are unlimited.

| Answer | Credits |
|---|---|
| Short (≤100 words) | 5 |
| Normal (≤300 words) | 10 |
| Long / detailed (>300 words) | 15 |
| Instant (cached) | 2 |
| Refused, failed, timed out, stopped | 0 |

The most an answer could cost is reserved first and the rest is given back once
the real size is known, so two tabs can't overspend. Every charge and grant is in
the `local_ai_credit_ledger` collection. Students see their balance, each answer's
cost and a low-balance warning. IT support can look up a student and add bonus
credits for the current month (password re-entry, audited as `AI_CREDITS_GRANTED`).

## Ask about a study material (📎)

Next to the question box a student can attach **one of their own study materials**
(the same list they can open in Study Materials; another section's or semester's file
is refused). The answer then comes only from that file:

1. The PDF/text is split into searchable pieces **once** (the existing study-material index).
2. A short overview of the material is written **once** in the background and reused
   by every student (`local_ai_material_digests`).
3. Answers are cached per material + question, so the next student asking the same
   thing gets it instantly.

Replacing the file rebuilds all three. Scanned PDFs without text can't be read.

## Install on the server (Linux with systemd)

You need sudo on the server. Since it's a shared lab server, check with
whoever manages it first.

```bash
cd /path/to/CMP/server/ai
sudo bash install.sh                                  # default: qwen2.5:7b on CPU socket 0
# options: sudo BASE_MODEL=qwen2.5:14b MEM_MAX=24G PARALLEL=1 bash install.sh
```

This installs Ollama and locks it to `127.0.0.1` on one CPU socket with a RAM
cap and lower priority. It downloads the model once and builds the restricted
`jnn-study` model.

**Firewall:** port 11434 must not be forwarded on the Sophos firewall.
Ollama only listens on localhost anyway; this is just a second safeguard.

Then add the following to `server/.env`:

```env
LOCAL_AI_ENABLED=true
LOCAL_AI_MODEL=jnn-study
LOCAL_AI_MAX_CONCURRENT=2
# optional tuning (defaults shown)
# LOCAL_AI_URL=http://127.0.0.1:11434
# LOCAL_AI_MAX_OUTPUT_TOKENS=700
# LOCAL_AI_EXAM_OUTPUT_TOKENS=1400
# LOCAL_AI_CONTEXT_TOKENS=8192
# LOCAL_AI_TIMEOUT_MS=300000
# LOCAL_AI_RATE_PER_MINUTE=5
# LOCAL_AI_RATE_PER_HOUR=40
# LOCAL_AI_MAX_CONVERSATIONS=3
# LOCAL_AI_RETENTION_HOURS=48
# LOCAL_AI_HISTORY_MESSAGES=6
```

> Render's free plan can't run a model. Run the backend on the college server.

## nginx

The site's nginx proxies to Node with a 75–120 s read timeout. For this
route, add the `location` block from
[`nginx-study-doubts.conf`](nginx-study-doubts.conf) inside the HTTPS
`server { }` block, above `location / { }`. It does three things:

- **Streaming:** turns off buffering so answers appear word by word (SSE).
- **Timeout:** raises it to 300 s only for `/api/ai/study-doubts/`, because a
  queued or long CPU answer can take more than 75 s.
- **Size limit:** caps the request body at 16 KB.

Then run `sudo nginx -t && sudo systemctl reload nginx`. Nothing else in the
site changes.

- **Never** proxy port 11434 (Ollama) through nginx.
- Keep `TRUST_PROXY=1` in `server/.env` (already in the deployment guide) so
  the per-student rate limits see real client IPs.
- If the Sophos firewall also has a web-server/WAF timeout for
  tech.jnn.edu.in, raise it to at least 300 s as well. Otherwise long
  answers will be cut off there.

## Enable the endpoint

The router is mounted in `src/app.js` right after the main API routes. It
reuses their API rate limit and CSRF/origin guard, and answers **503** until
you set `LOCAL_AI_ENABLED=true` in `server/.env`. The existing Groq Study
Assistant routes are not affected.

Endpoints (all require login and a role that can view Study Materials):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/ai/study-doubts/chat` | `{ message, conversationId?, mode?: 'short'\|'detailed', materialId?, stream? }` |
| GET | `/api/ai/study-doubts/me` | Credits balance, limits, block status |
| GET | `/api/ai/study-doubts/materials?q=` | Study materials the student may attach |
| GET | `/api/ai/study-doubts/conversations` | The student's saved chats (max 3) |
| GET | `/api/ai/study-doubts/conversations/:id` | One saved chat with its messages |
| PATCH | `/api/ai/study-doubts/conversations/:id` | `{ title }`: rename a saved chat (1–80 characters) |
| DELETE | `/api/ai/study-doubts/conversations/:id` | Delete a saved chat |

IT support only (Console → Troubleshooting → AI Doubts): `GET /api/console/ai-doubts/status`,
`POST …/emergency-stop`, `GET …/blocked`, `POST …/unblock`, `GET …/credits?account=`,
`POST …/credits/grant`. Changes need the password re-entered and are audited.

If the browser disconnects mid-answer (for example, the student switches
tabs), generation still finishes and the answer is saved.

- `stream: false` returns `{ success, conversationId, title, expiresAt, questionsLeft, credits, message }`
- `stream: true` returns Server-Sent Events: `queue` (place in line), `cached`, `delta` events, then `done` (or `error`)

## College instructions (`instructions.md`)

Write how the assistant should teach in [`instructions.md`](instructions.md):
answer style, length, exam formats, examples, languages and focus subjects.

- Changes apply on the **next question**; no restart is needed.
- Maximum 4000 characters. `<!-- comments -->` are ignored.
- The instructions go into the prompt **before** the strict rules, which state
  that they override the instructions. A line like "ignore your restrictions"
  in this file does nothing.
- The file is never sent to browsers. It can only be changed on the server
  (edit it, or deploy it with the code).

**Leak guard:** if an answer starts repeating 8 or more words in a row from
the hidden prompt (strict rules or college instructions), generation is cut
off at that point and a refusal is saved instead. The server log records
"blocked an answer that repeated the hidden prompt".

## Turning AI on and off

| What | How | Who |
|---|---|---|
| **Normal on/off** | `LOCAL_AI_ENABLED=true` / `false` in `server/.env`, then restart the API | Server admin |
| **Emergency stop** | IT support login → **Console → Troubleshooting → AI Doubts → Emergency stop AI** (needs the password re-entered and a reason; recorded in the audit trail as `AI_EMERGENCY_STOP`) | IT support |
| **Emergency stop from the terminal** | `npm run ai:stop -- "reason"` | Server admin |
| **Turn back on after an emergency stop** | `npm run ai:resume` on the server (asks you to type `yes`; `-- --yes` skips it) | Server admin, **terminal only** |
| **Check the state** | `npm run ai:status` | Server admin |

What an emergency stop does, immediately:

1. Writes the lock file `server/ai/.emergency-stop.json` (who, when, why). It
   survives API restarts and deploys, and is git-ignored.
2. Refuses every AI Doubts request for every student ("switched off by IT support").
3. Cancels answers being generated. Half-written answers are not saved.
4. Unloads the model from the server's memory (Ollama `keep_alive: 0`).

There is **no resume button or API**. Only someone with terminal access on the
server can turn AI back on. A stop made from the terminal is picked up by the
running API within about 3 seconds. If the lock file can't be read, AI stays
off (fails closed).

The emergency stop only affects AI Doubts. The JNN Study Assistant (Groq) is a
separate feature.

## Files

| File | Purpose |
|---|---|
| `Modelfile` | Restricted model definition (base model, low temperature, baked-in rules) |
| `install.sh` | One-shot server install and lock-down |
| `config.js` | `LOCAL_AI_*` settings (separate from `src/config/env.js`) |
| `scopeGuard.js` | Input guard (normalisation, injection families, multi-turn, sexual, platform probing) and output scrub |
| `prompt.js` | System prompt (identity → college instructions → strict rules, canary) + leak guard |
| `outputGuard.js` | Tripwire (canary / secrets / DB host / paths / tool calls → emergency stop) + sexual output check |
| `instructions.md` | The college's teaching instructions for the model (edit freely) |
| `localModelClient.js` | Talks to Ollama on localhost: fair queue, several instances, timeout, safe errors |
| `localStudyAssistant.js` | Guard → retrieval → cache → credits → model → output guards → save |
| `LocalAIConversation.js` | Saved chats model (2-day TTL, own collection) |
| `models.js` | Strikes/credits state, credit ledger, answer cache, material digests |
| `strikes.js` | Misuse strikes and temporary blocks |
| `credits.js` | Credits: monthly/daily balance, reserve → settle, bonus grants |
| `materials.js` | Attach a study material: list, access check, scoped excerpts, overview |
| `router.js` | Express routes (auth, roles, rate limits, SSE) + IT support status/emergency stop |
| `killSwitch.js` | Emergency stop: lock file, cancel answers in progress, unload the model |
| `aictl.mjs` | Terminal: `npm run ai:status` / `ai:stop` / `ai:resume` |
| `nginx-study-doubts.conf` | nginx location block for this route (streaming + longer timeout) |
| `try-local.mjs` | Try the model from the command line (no app or database needed) |

Tests: `server/tests/local-ai.test.js`, `local-ai-instructions.test.js`, `local-ai-route.test.js`, `local-ai-stop.test.js` and `local-ai-features.test.js` (no model needed).

Web UI: Study Materials → **AI Doubts** tab (`client/src/components/StudyDoubtsChat.jsx`,
`client/src/services/studyDoubts.js`). Chat state lives outside the component, so switching
tabs keeps the conversation and any answer still being written.
