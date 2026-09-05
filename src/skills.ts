// Obsidian Skills (kepano/obsidian-skills 기반)
// 시스템 프롬프트에 주입되는 Obsidian 전문 지식
import type { CustomSkill } from "./types";

export interface Skill {
  id: string;
  name: string;
  /** 영어 표시 이름. 이름 자체가 언어 중립이면(예: "Obsidian Markdown") 생략한다. */
  nameEn?: string;
  description: string;
  descriptionEn: string;
  content: string;
  /** 내장 스킬 여부. true면 항상 활성화되며 설정 목록에 노출하지 않는다. */
  builtin?: boolean;
}

// ============================================
// Obsidian Markdown 스킬 (축약)
// ============================================
const OBSIDIAN_MARKDOWN_SKILL = `# Obsidian Flavored Markdown

## Internal Links (Wikilinks)
- \`[[Note Name]]\` — link to note
- \`[[Note Name|Display Text]]\` — custom display text
- \`[[Note Name#Heading]]\` — heading link
- \`[[Note Name#^block-id]]\` — block link
- \`[[#Heading in same note]]\` — same-note heading

## Embeds
- \`![[Note Name]]\` — embed note
- \`![[image.png]]\` / \`![[image.png|300]]\` — image (with width)
- \`![[document.pdf#page=3]]\` — PDF embed

## Callouts
\`\`\`markdown
> [!note] Title
> Content

> [!tip]- Foldable (collapsed by default)
> Hidden content
\`\`\`
Types: note, abstract/summary/tldr, info, todo, tip/hint/important, success/check/done, question/help/faq, warning/caution, failure/fail, danger/error, bug, example, quote/cite

## Properties (Frontmatter)
\`\`\`yaml
---
title: My Note
date: 2024-01-15
tags: [project, important]
aliases: [Alt Name]
cssclasses: [custom-class]
---
\`\`\`
Types: Text, Number, Checkbox (true/false), Date, Date & Time, List, Links (\`"[[Note]]"\`)

## Tags
- \`#tag\`, \`#nested/tag\`, \`#tag-with-dashes\`
- In frontmatter: \`tags: [tag1, nested/tag2]\`

## Task Lists
\`\`\`markdown
- [ ] Incomplete
- [x] Completed
\`\`\`

## Math (LaTeX)
- Inline: \`$e^{i\\pi} + 1 = 0$\`
- Block: \`$$...$$\`

## Diagrams (Mermaid)
\`\`\`\`markdown
\`\`\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Do this]
    B -->|No| D[Do that]
\`\`\`
\`\`\`\`

## Comments
- Inline: \`%%hidden%%\`
- Block: \`%% ... %%\`

## Formatting
| Style | Syntax |
|-------|--------|
| Bold | \`**text**\` |
| Italic | \`*text*\` |
| Highlight | \`==text==\` |
| Strikethrough | \`~~text~~\` |
| Inline code | \`\\\`code\\\`\` |

## Footnotes
\`\`\`markdown
Text[^1] or inline^[footnote text].
[^1]: Footnote content.
\`\`\`
`;

// ============================================
// Obsidian Bases 스킬 (축약)
// ============================================
const OBSIDIAN_BASES_SKILL = `# Obsidian Bases (.base files)

YAML-based files defining dynamic views of vault notes.

## File Structure
\`\`\`yaml
filters:
  and: []
formulas:
  formula_name: 'expression'
properties:
  prop_name:
    displayName: "Display Name"
summaries:
  custom_name: 'values.mean().round(3)'
views:
  - type: table | cards | list | map
    name: "View Name"
    limit: 10
    groupBy:
      property: prop_name
      direction: ASC | DESC
    filters:
      and: []
    order:
      - file.name
      - property_name
      - formula.formula_name
    summaries:
      property_name: Average
\`\`\`

## Filter Syntax
- Single: \`'status == "done"'\`
- AND: \`and: ['status == "done"', 'priority > 3']\`
- OR: \`or: [file.hasTag("book"), file.hasTag("article")]\`
- NOT: \`not: [file.hasTag("archived")]\`
- Operators: ==, !=, >, <, >=, <=, &&, ||, !

## File Properties
file.name, file.basename, file.path, file.folder, file.ext, file.size, file.ctime, file.mtime, file.tags, file.links, file.backlinks

## File Functions
- file.hasTag(...tags), file.hasLink(otherFile), file.hasProperty(name), file.inFolder(folder)

## Key Functions
- date(string), now(), today(), duration(string)
- if(condition, trueResult, falseResult?)
- min(), max(), number(), link(), list(), image(), icon(), html()

## Duration: (date1 - date2).days, .hours, .minutes
## Date arithmetic: date + "1M", date - "2h", now() + "7d"

## Default Summaries
Average, Min, Max, Sum, Range, Median, Stddev, Earliest, Latest, Checked, Unchecked, Empty, Filled, Unique
`;

// ============================================
// JSON Canvas 스킬 (축약)
// ============================================
const JSON_CANVAS_SKILL = `# JSON Canvas (.canvas files)

JSON format for infinite canvas. Extension: .canvas

## Structure
\`\`\`json
{ "nodes": [], "edges": [] }
\`\`\`

## Node Types
All nodes: id (string, 16-char hex), type, x, y, width, height, color? (hex or preset "1"-"6")

### text node
\`\`\`json
{ "id": "6f0ad84f44ce9c17", "type": "text", "x": 0, "y": 0, "width": 400, "height": 200, "text": "# Hello\\nMarkdown content" }
\`\`\`

### file node
\`\`\`json
{ "id": "...", "type": "file", "x": 0, "y": 0, "width": 400, "height": 300, "file": "path/to/file.md", "subpath": "#Heading" }
\`\`\`

### link node
\`\`\`json
{ "id": "...", "type": "link", "x": 0, "y": 0, "width": 400, "height": 200, "url": "https://example.com" }
\`\`\`

### group node
\`\`\`json
{ "id": "...", "type": "group", "x": 0, "y": 0, "width": 1000, "height": 600, "label": "Group Name", "background": "path/to/bg.png", "backgroundStyle": "cover|ratio|repeat" }
\`\`\`

## Edges
\`\`\`json
{ "id": "...", "fromNode": "nodeId1", "fromSide": "right", "fromEnd": "none", "toNode": "nodeId2", "toSide": "left", "toEnd": "arrow", "color": "1", "label": "connects to" }
\`\`\`
- Sides: top, right, bottom, left
- Ends: none, arrow (default: fromEnd=none, toEnd=arrow)

## Color Presets
"1"=Red, "2"=Orange, "3"=Yellow, "4"=Green, "5"=Cyan, "6"=Purple. Or hex: "#FF0000"

## Layout Tips
- x increases right, y increases down
- Position = top-left corner
- Spacing: 50-100px between nodes, 20-50px padding in groups
- IDs: 16-char lowercase hex (e.g. "6f0ad84f44ce9c17")
`;

// ============================================
// 한국어 윤문 / 자연스러운 글쓰기 스킬
// (toss/technical-writing 가이드의 원칙을 규칙으로 재구성 — 라이선스 준수를 위해 의역/요약)
// ============================================
const KOREAN_WRITING_SKILL = `# 사람처럼 글쓰기 (한국어)

당신은 한국어 글을 사람이 쓴 것처럼 자연스럽고 명확하게 쓰고 다듬는 전문가다. 사용자의 글(기존 노트 포함)을 읽고 의미는 보존하되 표현을 개선한다.

## 적용 시점 (기본 적용)
한국어로 글을 쓰거나 다듬는 모든 작업에 이 규칙을 기본으로 적용한다 — 특히 한국어로 문서를 **작성·교정(윤문)·번역**하거나 한국어 노트를 새로 만들 때 항상 반영한다. (영어 등 다른 언어 작업에는 적용하지 않는다.)

## 작업 원칙
- 원문의 의도·사실·정보를 절대 바꾸지 않는다. 표현만 다듬는다.
- 글쓴이의 어조(존댓말/반말, 격식 수준)를 유지한다.
- 과도하게 바꾸지 않는다. 자연스러우면 그대로 둔다.
- 기존 글을 고칠 때 요청이 없으면 바로 덮어쓰지 말고, 수정안과 핵심 변경 이유를 먼저 제시한다.

## 문장 다듬기 규칙
1. 능동형·주체 명확화: 사람이 주체가 되게 쓴다. "시스템에 의해 처리된다" → "시스템이 처리한다". 도구·기술을 행위 주체로 의인화하지 않는다.
2. 간결성: 한 문장은 한 가지만 말한다. 불필요한 수식어, 군더더기 메타표현("~라고 할 수 있다", "~인 것 같다")을 줄인다.
3. 구체성: 추상 명사보다 동사로 쓴다. "검토를 진행한다" → "검토한다". "개선이 필요하다" → "무엇을 어떻게 개선할지" 명시.
4. 자연스러운 한국어:
   - 번역체 제거: "~에 대해", "~를 통해", "~를 가진다", "~되어진다", 이중 피동("불려진다")을 자연스러운 표현으로 바꾼다.
   - 불필요한 한자어·외래어를 쉬운 말로. 단, 정착된 기술 용어는 유지한다.
   - 조사를 정확히 쓰고, 주술 호응을 맞춘다.
5. 일관성: 같은 개념은 같은 용어로. 약어는 처음 나올 때 풀어 쓴다. 종결어미(합니다/해요/한다)를 글 전체에서 일관되게.

## 구조(긴 글일 때)
- 핵심·결론을 앞에 둔다(가치 먼저, 배경은 뒤로).
- 제목은 핵심 키워드를 담아 간결한 평서문으로.
- 한 문단은 한 주제. 길면 나눈다.
- 목록·표가 더 명확하면 산문을 구조화한다.

## 작업 절차
1. read_note / get_active_note로 원문을 읽는다.
2. 위 규칙으로 다듬은 버전을 만든다.
3. (요청에 따라) 수정안을 보여주거나, edit_note로 반영한다. 원본 보존이 필요하면 create_note로 새 노트에 저장한다.

## before → after 예시
- "사용자에 의해 입력된 데이터가 시스템을 통해 저장되어진다." → "사용자가 입력한 데이터를 시스템이 저장한다."
- "이 기능은 성능 향상에 대한 기여를 할 수 있습니다." → "이 기능은 성능을 높입니다."
- "해당 설정의 변경이 필요한 상황입니다." → "이 설정을 바꿔야 합니다."
`;

// ============================================
// 비즈니스 이메일/메신저 글쓰기 (영어) 스킬
// ============================================
const BUSINESS_ENGLISH_WRITING_SKILL = `# Business Email & Messaging (English)

You are an expert at writing clear, professional English for business email and team messaging (Slack/Teams). Apply this when the user writes, drafts, edits, or translates English business communication.

## Core principles
- Lead with the point. State the purpose or request in the first sentence.
- Be concise. Cut filler ("just", "actually", "I was wondering if maybe"). One idea per paragraph.
- Be specific and actionable. Name the ask, the owner, and the deadline.
- Match register to the audience: respectful and warm, never stiff or robotic. Avoid jargon unless the reader expects it.
- Keep a positive, solution-oriented tone. Soften requests with "could you", "would you mind", but don't over-hedge.

## Email structure
- Subject: short, specific, scannable (e.g. "Q3 budget review — need your input by Fri").
- Greeting: "Hi {Name}," (use "Dear {Name}," for formal/external).
- Opening: one line of context or purpose.
- Body: the ask + needed details, in short paragraphs or bullets.
- Action/close: clear next step and deadline. "Could you send X by Thursday?"
- Sign-off: "Best regards," / "Thanks," / "Best," + name.

## Messaging (Slack/Teams)
- Even shorter and more casual than email, but still clear.
- One message = one topic. Put the ask up front; thread details below.
- Use the recipient's time well: TL;DR first, context after.
- Use @mentions for owners, and state the deadline explicitly.

## Tone & politeness
- Prefer active voice ("I'll send the report" over "the report will be sent").
- Replace blame with neutral framing ("the build failed" not "you broke the build").
- Acknowledge before asking ("Thanks for the quick turnaround — one follow-up:").
- Close requests with appreciation, not pressure.

## Editing existing text
- Preserve the writer's intent and facts; improve clarity, tone, and structure.
- Don't overwrite without showing the revised version and key changes first, unless asked.

## Before → after
- "I just wanted to quickly check in and see if maybe you had a chance to look at the doc?" → "Have you had a chance to review the doc? I'd love your feedback by Wednesday."
- "The deadline was missed by the team." → "We missed the deadline. Here's the new plan to get back on track:"
`;

// ============================================
// Second Brain (LLM Wiki) 스킬
// AI-first 노트 규칙 · 위키 구조 규약 · second-brain 도구 사용 가이드
// (Req 5.4) 본문은 백엔드별 표시 이름을 하드코딩/정적 보간하지 않는다.
//   - Skill.content 는 모듈 로드 시 확정되는 정적 string 이지만
//     BRANDING 은 백엔드 전환 시 재할당되는 가변 export let 이므로,
//     보간하면 로드 시점 값으로 고정되어 전환이 반영되지 않는다.
//   - 따라서 "이 플러그인의 Second Brain 기능"처럼 백엔드 무관 표현을 쓴다.
// ============================================
const SECOND_BRAIN_SKILL = `# Second Brain (LLM Wiki)

이 플러그인의 Second Brain 기능은 볼트를 능동적으로 정리·진화시키는 "쓰기" 레이어다.
검색(Graph RAG) 위에서 노트를 종합·정리·연결하고, AI가 다시 읽기 좋은 형태로 지식을 축적한다.
아래 규약은 second-brain 도구로 노트를 만들거나 갱신할 때 항상 따른다.

## 1. AI-first 노트 규칙
미래의 AI(그리고 사람)가 다시 읽을 것을 전제로 노트를 쓴다.

- **프론트매터(YAML)**: 노트 맨 앞에 메타데이터를 둔다. 권장 필드:
  - \`title\` — 노트 제목 (명사구, 모호하지 않게)
  - \`type\` — entity | concept | project 중 하나 (위키 카테고리와 일치)
  - \`tags\` — 검색·분류용 태그 목록
  - \`confidence\` — 0.0~1.0 수치 또는 low/medium/high (이 지식의 확신 정도)
  - \`valid_from\` — 이 지식이 사실로서 유효해진 날짜 (\`YYYY-MM-DD\`)
  - \`learned_at\` — 이 노트로 학습/기록한 날짜 (\`YYYY-MM-DD\`)
- **"## For future AI" 프리앰블**: 본문 앞에 짧은 안내 블록을 둔다. 이 노트가 무엇이고,
  왜 중요하며, 어떤 맥락에서 작성됐는지 한두 문장으로 적어 다음 AI가 빠르게 맥락을 잡게 한다.
- **본문**: 결론·핵심을 앞에 두고, 근거와 세부는 뒤에 둔다. 한 노트는 한 주제만 다룬다.
- **확신도 명시**: 불확실한 내용은 \`confidence\`를 낮추고 본문에서도 "추정", "미확인"처럼 표시한다.
- **이중 시간(bi-temporal)**: 사실이 유효한 시점(\`valid_from\`)과 기록한 시점(\`learned_at\`)을 구분한다.

## 2. wikilink 규약 (중요)
노트 본문에서 다른 개념·엔티티·프로젝트를 언급할 때는 반드시 Obsidian wikilink로 연결한다.

- 다른 노트를 가리킬 때 \`[[노트명]]\` 형식을 사용한다 (필요하면 \`[[노트명|표시 텍스트]]\`).
- 새 지식을 쓸 때 기존 노트와 연결될 수 있는 개념은 적극적으로 wikilink로 건다.
  연결이 많을수록 그래프가 풍부해지고 이후 검색·종합·발상이 좋아진다.
- 링크 자동 변환에 의존하지 말고, 본문을 생성할 때 직접 wikilink를 작성한다.

## 3. 위키 구조 규약
Second Brain 노트는 사용자가 설정한 위키 폴더(Wiki_Folder) 안에 모은다.

- **카테고리**: 노트는 세 가지로 분류한다.
  - \`entities\` — 사람·조직·도구·장소 등 구체적 대상
  - \`concepts\` — 아이디어·이론·패턴·정의 등 추상 개념
  - \`projects\` — 진행 중이거나 완료된 작업·목표
  분류가 모호하면 가장 가까운 것을 고르고, 정말 애매하면 "기타"로 둔다.
- **index 노트**: 위키 폴더의 \`index.md\` 는 카테고리별 카탈로그(목차)다.
  카탈로그는 자동 생성 영역으로 관리되며 \`update_index\` 도구가 갱신한다.
- **활동 로그**: \`log.md\` 에 능동 작업 내역이 한 줄씩 누적된다.
- **비파괴 원칙**: 노트의 자동 생성 영역(Generated_Region)만 교체하고
  사용자가 직접 쓴 영역(User_Region)은 절대 건드리지 않는다.
  자동 생성 영역은 \`<!-- @generated:KEY -->\` ~ \`<!-- @end:KEY -->\` 마커로 감싼다.

## 4. second-brain 도구 사용 가이드
아래 도구는 Second Brain 기능이 활성화된 경우에만 동작한다. 기능이 꺼져 있으면 호출하지 말고,
사용자가 설정에서 활성화하도록 안내한다. 모든 쓰기는 위키 폴더 범위 안에서만 수행한다.

- **create_wiki_note** — 위키 폴더에 AI-first 규격(프론트매터 + "For future AI" 프리앰블)으로
  새 노트를 만든다. 같은 경로가 이미 있으면 덮어쓰지 않는다. 본문에는 wikilink를 적극 사용한다.
- **update_index** — 위키 폴더의 노트를 수집해 \`index.md\` 카탈로그를 갱신한다 (User_Region 보존).
- **synthesize_topic** — 한 주제에 대해 흩어진 노트를 검색·종합해 하나의 정리 노트를 만든다.
  검색 결과가 없으면 노트를 만들지 않고 그 사실을 안내한다.
- **reconcile_topic** — 한 주제의 노트 간 모순·중복을 찾아 **리포트만** 제시한다.
  스스로 노트를 수정하지 않는다. 실제 반영은 사용자가 명시적으로 승인한 항목에 한해 이뤄진다.
- **challenge** — 어떤 주장에 대해 볼트의 근거를 찾아 반론·약점·반례를 제시한다 (기본은 읽기 전용).
- **connect** — 두 주제를 교차로 검색해 둘 사이의 숨은 연결·공통점·시사점을 찾는다.
- **emerge** — 최근 노트들을 훑어 새롭게 떠오르는 주제·패턴·다음 행동을 제안한다.
- **architect** — 코드베이스/볼트 구조를 스캔해 아키텍처 개요 노트를 만든다.
  재실행 시 자동 생성 영역만 갱신하고 사용자 메모는 보존한다. 볼트 밖 경로는 읽기 전용이다.

## 5. 작업 태도
- 사용자의 명시적 요청이나 활성화된 자동화 없이는 기존 노트를 바꾸지 않는다 (옵트인 격리).
- 파괴적 변경 대신 비파괴적 누적을 기본으로 한다. 모순은 지우지 말고 드러내고 정정안을 제시한다.
- 불확실하면 확신도를 낮추고 그 이유를 본문에 남긴다.
`;

// ============================================
// 스킬 목록 및 유틸리티
// ============================================
export const SKILLS: Skill[] = [  {
    id: "obsidian-markdown",
    name: "Obsidian Markdown",
    description: "Obsidian Flavored Markdown 문법 (위키링크, 콜아웃, 임베드, 프로퍼티 등)",
    descriptionEn: "Obsidian Flavored Markdown syntax (wikilinks, callouts, embeds, properties, etc.)",
    content: OBSIDIAN_MARKDOWN_SKILL,
    builtin: true,
  },
  {
    id: "obsidian-bases",
    name: "Obsidian Bases",
    description: "Obsidian Bases (.base 파일) 뷰, 필터, 수식 작성",
    descriptionEn: "Obsidian Bases (.base files) views, filters, and formula authoring",
    content: OBSIDIAN_BASES_SKILL,
    builtin: true,
  },
  {
    id: "json-canvas",
    name: "JSON Canvas",
    description: "JSON Canvas (.canvas 파일) 노드, 엣지, 그룹 작성",
    descriptionEn: "JSON Canvas (.canvas files) nodes, edges, and group authoring",
    content: JSON_CANVAS_SKILL,
    builtin: true,
  },
  {
    id: "korean-writing",
    name: "사람처럼 글쓰기 (한국어)",
    nameEn: "Human-like writing (Korean)",
    description: "한국어 문서 작성·교정·번역 시 자연스럽고 사람처럼 쓰도록 항상 적용되는 규칙",
    descriptionEn: "Always-on rules for writing natural, human-like Korean (writing, proofreading, translation)",
    content: KOREAN_WRITING_SKILL,
    builtin: false,
  },
  {
    id: "business-english-writing",
    name: "비지니스 이메일/메신저 글쓰기 (영어)",
    nameEn: "Business email & messaging (English)",
    description: "영어 비즈니스 이메일·메신저(Slack/Teams)를 명확하고 프로페셔널하게 작성",
    descriptionEn: "Write clear, professional English business email and messaging (Slack/Teams)",
    content: BUSINESS_ENGLISH_WRITING_SKILL,
    builtin: false,
  },
  {
    id: "second-brain",
    name: "Second Brain (LLM Wiki)",
    description: "AI-first 노트 규칙·위키 구조 규약·second-brain 도구 사용 가이드",
    descriptionEn: "AI-first note rules, wiki structure conventions, and second-brain tool usage guide",
    content: SECOND_BRAIN_SKILL,
    builtin: false,
  },
];

// 활성화된 스킬들을 시스템 프롬프트 텍스트로 변환
// - 내장(builtin) 스킬: enabledSkillIds와 무관하게 항상 포함
// - 번들 비-내장 스킬(예: 한국어 윤문): enabledSkillIds에 포함된 경우만
// - 커스텀 스킬: enabled === true인 경우만
export function buildSkillsPrompt(
  enabledSkillIds: string[],
  customSkills: CustomSkill[] = []
): string {
  const parts: string[] = [];
  for (const skill of SKILLS) {
    if (skill.builtin || enabledSkillIds.includes(skill.id)) {
      parts.push(`<skill name="${skill.id}">\n${skill.content}\n</skill>`);
    }
  }
  for (const skill of customSkills) {
    if (skill.enabled && skill.content.trim() !== "") {
      parts.push(`<skill name="${skill.id}">\n${skill.content}\n</skill>`);
    }
  }

  if (parts.length === 0) return "";
  return "\n\n## Obsidian Skills\n\n" + parts.join("\n\n");
}
