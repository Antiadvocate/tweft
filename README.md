# Management Assessment

A management **work-sample** tool. Instead of asking a candidate to *describe* how
they'd manage, it drops them into a live, reactive team situation and watches how
they actually manage it — then grades the interaction against a competency rubric.

Built on a persistent social-simulation engine: reports have personalities, hidden
drivers, moods, and relationships that shift in response to what the manager does.
The candidate has to read the room, because nobody announces their inner state.

It runs entirely in your browser and talks to language models through your own
[OpenRouter](https://openrouter.ai/keys) key (pasted once, stored only in
`localStorage`). No backend, no server.

## How it works

**1. Build an assessment (turn 0, the HR/designer side).**
Define the manager role being assessed (paste a job description to auto-extract it).
Add the team — each report's job, experience, personality, disposition toward a new
manager (including authored friction and *why* it's there), and a hidden driver that
only surfaces if the candidate diagnoses well. Write the literal opening message the
candidate sees and the fixed end-state. Set a time budget and a typing-speed baseline.
Optionally set a password that gates the reviewer-only "scopes."

Everything is frozen once built, so **every candidate faces the identical scenario,
clock, and rubric** — the fairness property a structured assessment needs.

**2. The candidate runs it.**
They read the opening and respond as the manager. The world reacts turn by turn.
A **locked clock** starts the instant they begin their first reply and ends the
assessment at the boundary — it can't be bypassed, idled past, or ended early to
dodge a bad state. Each response's *latency* (the pause before typing — a positive
composure signal) and *typing time* are measured against a length-adjusted baseline,
so pacing reads as pressure-handling, never as typing speed.

**3. Grading.**
An assessor scores eight management competencies — drawn from standard structured-
interview frameworks (SHRM / OPM): problem diagnosis, conflict management, decision-
making, communication, influence, developing people, composure under pressure, and
fairness & integrity. Each is scored by **matching the transcript to tiered
behavioral anchors**, flexed by the role's level (first-line / manager-of-managers /
peer-lead), and **grounded in the simulation's own relationship and engagement
deltas** rather than prose fluency. It names the management style neutrally (and how
it shifts under pressure), cites specific moments, and writes a paragraph for the
reviewer.

**4. The reviewer reads the report.**
Scores, evidence, style, composure/timing, missed signals. With the password, they
can unlock the "scopes" to see exactly what each report's hidden state was doing —
making the candidate's read-of-the-room legible.

## Important: what this is and isn't

This is **decision-support evidence for a human reviewer — not an automated hire/no-
hire gate.** Every report says so. As an AI-graded simulation it is internally
consistent and useful for practice and signal, but it is **not a validated selection
instrument**. Before using it in real hiring you must validate it against on-the-job
outcomes and audit it for adverse impact — that work is what stands between "a better
signal" and a discrimination liability.

By design, the candidate's own identity is never an input, and the builder exposes no
protected-characteristic field. Reports can have authored disposition and friction;
the person being scored is a neutral vessel who faces the identical scene. Scores are
grounded in behavioral state and the grader is instructed to assess managerial
decisions, not writing quality — the defenses against surface bias leaking into a
score.

## Run it

Local:
```bash
npm install
npm run dev
```

Deploy to GitHub Pages: push to `main`. The included workflow
(`.github/workflows/deploy.yml`) builds and publishes automatically — just enable
Pages → Source: GitHub Actions in the repo settings. `base: "./"` in the Vite config
means it works at any path (user or project pages) with no per-repo change.

## Stack

React 19 · Vite 6 · Tailwind 4 · Motion · IndexedDB (local saves) · OpenRouter.

## Perception & misreads (the "reading the room" signal)

Reports don't have perfect knowledge of the candidate. Each one builds a *private
model* of how the candidate feels toward them, and that model can be wrong — a report
can spend the session convinced the candidate has turned on them when they haven't, or
misjudge a firm decision as hostility. This is the engine's information-asymmetry layer,
and it's where the assessment's core skill lives.

The grader treats **noticing and correcting a misread** as a first-class management act:
it feeds problem diagnosis (did they detect it), communication and influence (did they
close the gap), and fairness (did they leave someone wrongly feeling mistreated). A
report left carrying an uncorrected false belief at the end is scored as a real cost.

In the reviewer scopes (password-gated), each report shows *their read of the candidate*
alongside the truth — so a reviewer can see at a glance whether the candidate noticed a
report was misreading them and did anything about it.
