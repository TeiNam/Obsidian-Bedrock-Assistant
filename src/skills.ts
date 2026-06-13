// Obsidian Skills (kepano/obsidian-skills 기반)
// 시스템 프롬프트에 주입되는 Obsidian 전문 지식
import type { CustomSkill } from "./types";

export interface Skill {
  id: string;
  name: string;
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
    description: "한국어 문서 작성·교정·번역 시 자연스럽고 사람처럼 쓰도록 항상 적용되는 규칙",
    descriptionEn: "Always-on rules for writing natural, human-like Korean (writing, proofreading, translation)",
    content: KOREAN_WRITING_SKILL,
    builtin: false,
  },
  {
    id: "business-english-writing",
    name: "비지니스 이메일/메신저 글쓰기 (영어)",
    description: "영어 비즈니스 이메일·메신저(Slack/Teams)를 명확하고 프로페셔널하게 작성",
    descriptionEn: "Write clear, professional English business email and messaging (Slack/Teams)",
    content: BUSINESS_ENGLISH_WRITING_SKILL,
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
