// Obsidian Skills (kepano/obsidian-skills 기반)
// 시스템 프롬프트에 주입되는 Obsidian 전문 지식

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
}

// ============================================
// Obsidian Markdown 스킬 (축약)
// ============================================
const OBSIDIAN_MARKDOWN_SKILL = `# Obsidian Flavored Markdown

## Internal Links (Wikilinks)
- \`[[Note Name]]\` — 노트 링크
- \`[[Note Name|Display Text]]\` — 표시 텍스트 지정
- \`[[Note Name#Heading]]\` — 헤딩 링크
- \`[[Note Name#^block-id]]\` — 블록 링크
- \`[[#Heading in same note]]\` — 같은 노트 내 헤딩

## Embeds
- \`![[Note Name]]\` — 노트 임베드
- \`![[image.png]]\` / \`![[image.png|300]]\` — 이미지 (너비 지정)
- \`![[document.pdf#page=3]]\` — PDF 임베드

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
// 스킬 목록 및 유틸리티
// ============================================
export const SKILLS: Skill[] = [
  {
    id: "obsidian-markdown",
    name: "Obsidian Markdown",
    description: "Obsidian Flavored Markdown 문법 (위키링크, 콜아웃, 임베드, 프로퍼티 등)",
    content: OBSIDIAN_MARKDOWN_SKILL,
  },
  {
    id: "obsidian-bases",
    name: "Obsidian Bases",
    description: "Obsidian Bases (.base 파일) 뷰, 필터, 수식 작성",
    content: OBSIDIAN_BASES_SKILL,
  },
  {
    id: "json-canvas",
    name: "JSON Canvas",
    description: "JSON Canvas (.canvas 파일) 노드, 엣지, 그룹 작성",
    content: JSON_CANVAS_SKILL,
  },
];

// 활성화된 스킬들을 시스템 프롬프트 텍스트로 변환
export function buildSkillsPrompt(enabledSkillIds: string[]): string {
  if (enabledSkillIds.length === 0) return "";

  const parts: string[] = [];
  for (const skill of SKILLS) {
    if (enabledSkillIds.includes(skill.id)) {
      parts.push(`<skill name="${skill.id}">\n${skill.content}\n</skill>`);
    }
  }

  if (parts.length === 0) return "";
  return "\n\n## Obsidian Skills\n\n" + parts.join("\n\n");
}
