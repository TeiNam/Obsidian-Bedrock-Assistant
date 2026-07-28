# Graph RAG & Second Brain

[← Back to README.md](../README.md)

[English](second-brain-en.md) | [한국어](second-brain-kr.md) | [日本語](second-brain-ja.md)

This document covers the vault search (Graph RAG) and knowledge-writing (Second Brain) layers in detail. For installation and basic usage, see the README.

> Command palette labels are currently Korean only; the Korean strings below are what you will see in Obsidian.
### Graph RAG Vault Search

Vault search combines vector similarity with the link graph, so a note linked to a strong match can surface even when its own text is a weaker match.

1. Click the search icon in the sidebar header (or run the command palette entry `볼트 인덱싱`)
2. Each note is split into chunks (default 2000 characters, 200 characters of overlap) and one embedding is generated per chunk
3. A search embeds the query, picks seed notes by vector similarity, then walks outlinks and backlinks to expand neighbours
4. Seeds and neighbours are ranked by a combined score — relevance **multiplied** by a graph-distance decay, `relevance × 0.5^hop` — normalized to 0.0–1.0. A neighbour's relevance is a weighted blend of its own similarity (0.6) and its seed's similarity (0.4)
5. Candidates whose relevance falls below **0.55** are dropped **before** the hop decay is applied, so unrelated notes are not reported as loosely relevant. The threshold has to be checked pre-decay: a hop-1 neighbour tops out at `1.0 × 0.5 = 0.5`, so testing the decayed score would discard every graph neighbour and reduce Graph RAG to plain vector search

Indexing behaviour:

- **Incremental** — create, modify, rename, and delete events update the index with a 2-second debounce, processed through a serial queue (concurrency 1) so the embedding API is not throttled
- **Embedding model change detection** — the index stores a `{provider}:{model}` signature and the vector dimension. When either changes, stale vectors are discarded, search falls back to keyword matching, and you are told to re-index
- **Dimension mismatch** — vectors of a different dimension are treated as not comparable, rather than scored as zero similarity

| Setting | Description |
|---------|-------------|
| Graph Traversal Depth | Link hops to expand from search results (0–3, default 1; `0` disables traversal) |
| Chunk Max Size | Maximum characters in one chunk (default 2000) |
| Chunk Overlap | Overlap between adjacent chunks in characters, must be smaller than chunk max size (default 200) |

### Second Brain Layer

The Second Brain Layer adds a write layer on top of the Graph RAG read layer. It is **opt-in and off by default**. While it is off, nothing is created, modified, or deleted automatically, and every tool and command below returns a "disabled" message without touching your vault.

Enable it in Settings → Assistant Kiro Settings → Second Brain.

| Setting | Default | Description |
|---------|---------|-------------|
| Enable Second Brain | Off | Master switch for the whole layer |
| Wiki Folder | `Second Brain` | Root folder where Second Brain notes are created and managed |
| Enable Scheduler | Off | Run the non-destructive cleanup pipeline when Obsidian starts, once the interval has elapsed |
| Scheduler Interval (hours) | 24 | Minimum hours between automatic scheduler runs (minimum 1) |

#### Does it overwrite my notes?

Three mechanisms keep generated content separate from what you wrote:

- **Sentinel blocks.** Generated regions are wrapped in `<!-- @generated:KEY -->` … `<!-- @end:KEY -->` markers. Re-running a tool replaces only that block, so notes you added to the same file are preserved and repeated runs are idempotent. Markers that appear inside LLM output are neutralized so they cannot break out of the block.
- **Folder scoping.** Writes outside the configured wiki folder are rejected, including paths containing `..`, absolute paths, and drive letters.
- **No silent overwrites.** `create_wiki_note` and Conversation Harvest refuse to write when a note already exists at the target path, and report the collision instead.

In addition, the "Confirm Note Changes" setting shows a confirmation dialog before tools that create, edit, delete, or move notes. When a result is produced from a stale index (embedding model changed), a warning is appended to the output.

#### Read-only tools

These analyze your notes and return text. They do not create or modify notes.

| Tool | What it does | LLM calls |
|------|--------------|-----------|
| `challenge` | Critiques a claim — gaps, counterexamples, assumptions — grounded in your past notes | 1 |
| `connect` | Cross-searches two topics and derives connections between them | 1 |
| `emerge` | Finds still-unnamed patterns across notes modified in the last N days. Capped at the 60 most recent notes; you are told when notes were left out | 1 |
| `reconcile_topic` | Reports contradictions between notes on a topic. No note is changed | 1 |

#### Generation tools

These write into the wiki folder.

| Tool | What it does | LLM calls |
|------|--------------|-----------|
| `synthesize_topic` | Synthesizes notes on a topic into a wiki note, creating or updating it | 1 |
| `architect` | Scans folder and module structure into an `Architecture.md` note. The module skeleton is capped at 400 lines | 3 (one per section: overview, modules, decisions) |
| `create_wiki_note` | Creates one wiki note from a title and body | 0 |
| `update_index` | Rebuilds the `index.md` catalog of the wiki folder, preserving your own notes in that file | 0 |

`architect` and `update_index` read the vault file list directly, so they do not depend on the Graph RAG index. The search-backed tools do.

#### Commands

Every tool is also available from the command palette, so it can be used without going through chat. Command palette labels are currently hardcoded in Korean regardless of the UI language, and are listed below exactly as they appear:

| Command | Runs |
|---------|------|
| `위키 노트 생성` | `create_wiki_note` (prefills the active note title and editor selection) |
| `위키 인덱스 갱신` | `update_index` |
| `주제 종합 (synthesize)` | `synthesize_topic` |
| `모순 점검 (reconcile)` | `reconcile_topic` |
| `주장 반박 (challenge)` | `challenge` (prefills the editor selection) |
| `두 주제 연결 (connect)` | `connect` |
| `최근 패턴 발견 (emerge)` | `emerge` |
| `코드베이스 아키텍트 (architect)` | `architect` |
| `지식 공백 리포트 갱신` | Knowledge Gaps report |
| `복습 큐 (다시 볼 노트)` | Review Queue |
| `Second Brain 정리 실행 (스케줄러)` | Cleanup pipeline, immediately |

#### Scheduler

The cleanup pipeline runs four steps in order: ensure the wiki folders exist → refresh the `index.md` catalog → refresh the knowledge gaps report → append one line to the activity log. It makes **0 LLM calls**.

There is no background timer. The only automatic entry point runs when Obsidian starts: the plugin checks whether the configured interval (default 24 hours) has passed since the last run, and runs the pipeline if it has. Step failures are isolated, so the remaining steps still run. If every step fails, the last-run timestamp is not updated, so the next startup retries.

### Knowledge Gaps Report

Search tells you what you have. It cannot tell you what is missing. This report computes structural gaps from index data on your machine — **0 LLM calls**, no embedding requests.

Four indicators:

| Indicator | Meaning |
|-----------|---------|
| Missing | Linked from several notes but never created |
| Stub | Has backlinks but under 200 characters of body text |
| Orphan | No outlinks and no backlinks — unreachable by graph traversal |
| One-way | Linked in only one direction |

The top 20 candidates are written to `{Wiki folder}/Knowledge Gaps.md` inside a sentinel block. Nothing is fixed automatically — a one-way link can be deliberate and a short note is not always unfinished — so the report only points at places worth looking. Run it from the command palette (`지식 공백 리포트 갱신`) or let the scheduler pipeline refresh it.

### Review Queue

Surfaces 5 notes you have not opened in a while but that are well connected — **0 LLM calls**. Run `복습 큐 (다시 볼 노트)` and click a note to open it.

- The score combines days since last access and link count
- Notes under 200 characters, and notes already surfaced within the last 7 days, are excluded
- No grade field is written into your notes. Access history lives only in plugin settings, and entries for deleted or moved notes are cleaned up
- Before any access history exists, note modification time is used instead

### Conversation Harvest

Chat sessions are capped at 50, so the oldest one disappears silently once you pass that — along with whatever you concluded in it.

1. Open the session list and click the harvest button (sprout icon) on a session
2. One LLM call extracts only conclusions, decisions, rationale, and open questions — **1 call per harvest**
3. The result is saved to `{Wiki folder}/Conversations/YYYY-MM-DD Title.md` and indexed automatically, so it becomes evidence for later searches

The original transcript is not included, which keeps small talk and dead ends out of your search evidence. Use Chat Export when you want the full transcript. Harvest is manual only and requires the Second Brain Layer to be enabled.
