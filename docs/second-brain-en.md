# Graph RAG & Second Brain

[← Back to README.md](../README.md)

[English](second-brain-en.md) | [한국어](second-brain-kr.md) | [日本語](second-brain-ja.md)

This document covers the vault search (Graph RAG) and knowledge-writing (Second Brain) layers in detail. For installation and basic usage, see the README.

> Command palette labels are currently Korean only; the Korean strings below are what you will see in Obsidian.
### Graph RAG Vault Search

Search combines vector similarity with the link graph instead of ranking whole notes by a single embedding.

- **Chunk-level embeddings** — Each note is split into chunks (default 2,000 characters, 200-character overlap) and every chunk is embedded.
- **Graph traversal** — Seed notes found by vector search are expanded along their outlinks and backlinks. Depth is 0–3 hops (default 1); `0` disables traversal and returns seeds only.
- **Combined score** — Relevance *multiplied* by graph distance decay: `relevance × 0.5^hop`, in the range 0.0–1.0. A seed sits at hop 0, so its combined score is its own normalized similarity. A neighbor's relevance is a weighted blend of its own similarity (0.6) and its seed's similarity (0.4); if the neighbor's own similarity is unavailable, the seed's score is used alone.
- **Minimum relevance threshold 0.55** — Applied to relevance *before* hop decay, not to the combined score. Normalization maps cosine 0 (orthogonal, unrelated) to 0.5, so the threshold drops clearly unrelated candidates instead of showing them as "50% related". Applying it after decay would eliminate every graph neighbor, since a hop-1 neighbor's theoretical maximum is `1.0 × 0.5 = 0.5`.
- **Embedding model change detection** — The index stores a `{provider}:{model}` signature and the vector dimension. When either changes, stale vectors are discarded, search falls back to keyword matching, and you are told to re-index.
- **Dimension mismatch** — Notes whose vectors have a different dimension are treated as "not comparable" instead of being scored, so they cannot tie with everything else.
- **Incremental indexing** — File create, modify, rename, and delete events update the index with a 2-second debounce, processed through a serial queue (concurrency 1) to avoid hammering the embedding API.

The embedding model is chosen from a dropdown under Settings → Bedrock Assistant → **Model Settings**. On the Bedrock backend it has no default, so pick one before indexing.

Settings → Bedrock Assistant → **Graph RAG Search**:

| Setting | Default | Range |
|---------|---------|-------|
| Graph Traversal Depth | 1 | 0–3 (`0` disables traversal) |
| Chunk Max Size | 2000 characters | minimum 1 |
| Chunk Overlap | 200 characters | must be smaller than chunk max size |

**Cost:** one embedding call per search query. Indexing costs one embedding call per chunk. No chat completion call is made by search itself.

### Second Brain Layer

The Second Brain Layer adds an active write layer on top of Graph RAG's read layer. It can create and update notes inside one folder that you designate.

**It is opt-in and off by default.** While **Enable Second Brain** is off, no note is created, modified, or deleted automatically, and every Second Brain command refuses to run.

Settings → Bedrock Assistant → **Second Brain**:

| Setting | Default | Notes |
|---------|---------|-------|
| Enable Second Brain | Off | Master switch for the whole write layer |
| Wiki Folder | `Second Brain` | Root folder where generated notes live |
| Enable Scheduler | Off | Runs the non-destructive cleanup pipeline on app startup once the interval has elapsed |
| Scheduler Interval (hours) | 24 | Minimum 1 |

#### Will the AI overwrite my notes?

No — and there are three separate reasons why.

**1. Read-only tools never touch a note.** The thinking tools return text into the chat and write nothing.

| Tool | Command palette (Korean) | What it does | Writes notes? | LLM calls |
|------|--------------------------|--------------|---------------|-----------|
| `challenge` | 주장 반박 (challenge) | Critiques a claim's gaps, counterexamples, and assumptions using your past notes as evidence | No | 1 |
| `connect` | 두 주제 연결 (connect) | Searches two topics separately and derives what links them | No | 1 |
| `emerge` | 최근 패턴 발견 (emerge) | Finds unnamed patterns across notes modified in the last N days | No | 1 |
| `reconcile_topic` | 모순 점검 (reconcile) | Reports contradictions between notes on a topic | No | 1 |

`emerge` reads the index directly instead of searching, and caps input at the 60 most recently modified notes; if more matched, the response says how many were analyzed.

**2. Generating tools write only inside the Wiki Folder.**

| Tool | Command palette (Korean) | What it writes | LLM calls |
|------|--------------------------|----------------|-----------|
| `synthesize_topic` | 주제 종합 (synthesize) | Creates or updates a wiki note summarizing notes on a topic. Writes nothing if the search returns no results. | 1 |
| `architect` | 코드베이스 아키텍트 (architect) | Creates or updates `Architecture.md` with `overview`, `modules`, and `decisions` sections. The scanned module skeleton is capped at 400 lines. | 3 (one per section) |
| `create_wiki_note` | 위키 노트 생성 | Creates a note from a title and body you supply | 0 |
| `update_index` | 위키 인덱스 갱신 | Rewrites the `index.md` catalog of the Wiki Folder | 0 |

Tools that search the vault also make one embedding call per query — `connect` searches twice, so it makes two. `emerge` and `architect` make none, because they enumerate the index and the vault file list instead of searching.

**3. Sentinel blocks preserve everything you wrote.** Generated regions are wrapped in markers:

```markdown
<!-- @generated:synthesis -->
Content the plugin owns. This region is replaced on every run.
<!-- @end:synthesis -->

Your own notes live outside the markers and are never rewritten.
```

On regeneration, only the marked block is replaced, so notes you added to the same file survive. Updates are idempotent: if the new content is identical, the file is not rewritten at all — which also keeps its modification time from polluting "recently modified" note selection. Markers that appear inside LLM output are neutralized so a response cannot forge or break a block.

Block keys currently in use: `synthesis` (synthesize), `overview` / `modules` / `decisions` (architect), `catalog` (`index.md`), `knowledge-gaps` (gap report).

#### Additional safeguards

- Writes outside the Wiki Folder are rejected, including `..` traversal, absolute paths, and drive letters.
- Destructive tool calls can require a confirmation modal (enable **Confirm Note Changes** in settings).
- If a result is produced while the index is stale (embedding model changed), a warning is appended telling you to re-index and re-run.

#### Scheduler

The cleanup pipeline runs four non-destructive steps in order: ensure the wiki folders exist → refresh the `index.md` catalog → write the knowledge gap report → append to the activity log.

Step failures are isolated, so the remaining steps still run. If every step fails, the last-run timestamp is not updated and the pipeline retries on the next trigger.

There is no background timer. When the scheduler is enabled, the only automatic entry point runs as Obsidian starts up: the plugin checks whether the configured interval (default 24 hours) has elapsed since the last run, and runs the pipeline if it has. Run it on demand with **Second Brain 정리 실행 (스케줄러)**.

### Knowledge Gap Report

Search answers "what do I know". This report answers "where are the holes", computed locally from index data.

Four metrics:

| Metric | Meaning |
|--------|---------|
| Referenced but missing | Several notes link to a note that does not exist yet |
| Referenced but thin | Has backlinks but under 200 characters of body text |
| Orphan | No outlinks and no backlinks — searchable, but unreachable by graph traversal |
| One-way link | A links to B with no reference back |

The top 20 entries are written to `{Wiki Folder}/Knowledge Gaps.md` inside a sentinel block. Ordering is deterministic so the block does not churn between runs. Nothing is auto-fixed — the report only tells you where to look. Notes inside the Wiki Folder are excluded so generated output does not pollute the statistics.

Run it with **지식 공백 리포트 갱신**, or let the scheduler pipeline do it.

**Cost:** 0 LLM calls, 0 embedding calls.

### Review Queue

Once a vault is large, knowledge you cannot recall a search term for is effectively gone. The queue resurfaces 5 notes at a time that you have not opened in a while but that are well connected.

- Score is elapsed days plus link count, each capped so age alone cannot dominate.
- Notes under 200 characters and notes already surfaced within the last 7 days are excluded.
- No grading field is written into your notes. Access history is stored only in plugin settings.
- Before any access history exists, the note's modification time is used instead, so the queue is not a tie.
- Entries for deleted or moved notes are pruned from the history.

Run it with **복습 큐 (다시 볼 노트)**. Click a row to open the note.

**Cost:** 0 LLM calls, 0 embedding calls.

### Conversation Harvest

Chat sessions are capped at 50, so older ones are dropped silently and their conclusions are lost. Harvesting moves what is worth keeping into the vault.

Open the chat history (session list) and click the sprout icon on a session. The result is saved to `{Wiki Folder}/Conversations/YYYY-MM-DD Title.md`.

- Only conclusions, decisions, rationale, and open questions are extracted. The raw transcript is not included — small talk and dead ends should not become search evidence.
- The saved note is indexed, so it becomes evidence for later searches.
- Manual trigger only; nothing is harvested automatically.
- Requires Second Brain to be enabled.

**Cost:** 1 LLM call per harvest.

### Retrospective Chain

Retrospectives are triggered from the chat input: type "회고", "retrospective", or "振り返り" and send it. There is no toolbar button for it.

When a daily retrospective is generated, the retrospective sections from the last 7 days are included as input, so recurring problems and whether they improved stay visible instead of resetting each day.

Only the retrospective section of each past day is used, truncated to 1,000 characters per day — not the whole daily note. If there are no past retrospectives, behavior is unchanged.

**Cost:** no additional LLM calls. It is still the single call the retrospective always made.
