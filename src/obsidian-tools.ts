import { App, TFile, TFolder, MarkdownView, Notice, normalizePath } from "obsidian";
import type { VaultIndexer, GraphRagResult, GraphRagSearchItem } from "./vault-indexer";
import { normalizeSearchFilter, describeFilter } from "./graph-rag/entry-filter";
import type { ToolDefinition, SecondBrainSettings, IAiClient } from "./types";
// Second Brain Layer — 위키 노트 생성/카탈로그 갱신에 사용하는 순수 함수 + I/O 래퍼
import { buildAiFirstNote, type AiFirstMeta, type Recency, type Confidence } from "./second-brain/ai-first-format";
import { formatAnchorLink, pathWithoutExtension } from "./second-brain/wiki-link";
import {
  buildIndexCatalog,
  ensureWikiFolders,
  writeIndexCatalog,
  WIKI_CATEGORIES,
  type CatalogEntry,
} from "./second-brain/wiki-structure";
// Second Brain Layer — 종합(synthesize) 실행 래퍼 + 실행 컨텍스트 타입
import { runSynthesize } from "./second-brain/synthesize";
// Second Brain Layer — 모순해결(reconcile) 실행 래퍼 (비파괴)
import { runReconcile } from "./second-brain/reconcile";
// Second Brain Layer — 코드베이스 아키텍트(architect) 실행 래퍼
import { runArchitect } from "./second-brain/architect";
// Second Brain Layer — 사고 도구(challenge/connect/emerge) 실행 래퍼 (읽기 전용)
import { runChallenge, runConnect, runEmerge } from "./second-brain/thinking-tools";
// 볼트 경로 탈출 방지 가드 (normalizePath는 ".." 를 해석하지 않는다)
import { ensureWithinFolder, escapesVault } from "./second-brain/vault-path-guard";
import type { SecondBrainContext } from "./second-brain/scheduler";

// Obsidian 제어 도구 목록
export const TOOLS: ToolDefinition[] = [
  {
    name: "search_vault",
    description:
      "볼트에서 시맨틱 검색을 수행합니다. 사용자의 노트 중 질문과 관련된 내용을 찾습니다. " +
      "folder/tags/수정 기간으로 후보를 좁힐 수 있습니다 — \"지난달 회의록\", " +
      "\"Projects 폴더의 노트\", \"#urgent 태그가 붙은 것\" 같은 요청에 사용하세요. " +
      "날짜는 시스템 프롬프트의 현재 날짜를 기준으로 직접 계산해 YYYY-MM-DD로 넘기세요.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "검색 쿼리" },
        limit: { type: "number", description: "결과 수 (기본값: 10, 1~100)" },
        folder: {
          type: "string",
          description: "이 폴더와 그 하위만 검색 (예: \"Projects\"). 생략하면 볼트 전체.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "이 태그 중 하나라도 가진 노트만 (OR). 선행 # 유무와 대소문자는 무관.",
        },
        modifiedAfter: {
          type: "string",
          description: "이 날짜(포함) 이후에 수정된 노트만. \"YYYY-MM-DD\".",
        },
        modifiedBefore: {
          type: "string",
          description: "이 날짜(포함)까지 수정된 노트만. \"YYYY-MM-DD\".",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_note",
    description: "특정 노트의 전체 내용을 읽습니다.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "노트 파일 경로 (예: folder/note.md)" },
      },
      required: ["path"],
    },
  },
  {
    name: "create_note",
    description: "새 노트를 생성합니다.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "생성할 파일 경로" },
        content: { type: "string", description: "노트 내용 (마크다운)" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_note",
    description: "기존 노트의 내용을 수정합니다. find/replace를 사용하면 find에 해당하는 모든 텍스트를 replace로 교체하고, content만 사용하면 전체를 덮어씁니다.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "수정할 파일 경로" },
        content: { type: "string", description: "전체 교체 시 새 내용 (find/replace 미사용 시)" },
        find: { type: "string", description: "교체할 기존 텍스트 (부분 수정 시)" },
        replace: { type: "string", description: "새로 바꿀 텍스트 (부분 수정 시)" },
      },
      required: ["path"],
    },
  },
  {
    name: "append_to_note",
    description: "기존 노트 끝에 내용을 추가합니다.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "파일 경로" },
        content: { type: "string", description: "추가할 내용" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_files",
    description: "볼트의 파일/폴더 목록을 반환합니다.",
    input_schema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "폴더 경로 (비어있으면 루트)" },
      },
    },
  },
  {
    name: "get_active_note",
    description: "현재 열려있는 노트의 경로와 내용을 반환합니다.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "open_note",
    description: "특정 노트를 에디터에서 엽니다.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "열 파일 경로" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_templates",
    description: "설정된 템플릿 폴더에서 사용 가능한 템플릿 목록을 반환합니다.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "save_template",
    description: "새 템플릿을 생성하여 템플릿 폴더에 저장합니다. 사용자가 원하는 양식을 자연어로 설명하면 마크다운 템플릿을 만들어 저장합니다. 템플릿에는 {{placeholder}} 형식의 치환 변수를 사용하세요.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "템플릿 파일명 (.md 확장자 제외)" },
        content: { type: "string", description: "템플릿 내용 (마크다운). {{변수명}} 형식으로 치환할 부분을 표시" },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "apply_template",
    description: "기존 템플릿을 불러와서 내용을 채워 새 노트를 생성합니다. 템플릿의 {{placeholder}}를 실제 값으로 치환합니다.",
    input_schema: {
      type: "object",
      properties: {
        template_name: { type: "string", description: "사용할 템플릿 파일명 (.md 확장자 제외)" },
        output_path: { type: "string", description: "생성할 노트 경로 (예: folder/note.md)" },
        variables: {
          type: "object",
          description: "템플릿 변수 치환 맵 (예: {\"제목\": \"회의록\", \"날짜\": \"2025-01-01\"})",
        },
      },
      required: ["template_name", "output_path"],
    },
  },
  {
    name: "move_file",
    description: "파일 또는 폴더를 다른 위치로 이동하거나 이름을 변경합니다. 대상 폴더가 없으면 자동으로 생성합니다.",
    input_schema: {
      type: "object",
      properties: {
        source_path: { type: "string", description: "이동할 파일/폴더의 현재 경로 (예: inbox/note.md)" },
        destination_path: { type: "string", description: "이동할 목적지 경로 (예: Projects/note.md)" },
      },
      required: ["source_path", "destination_path"],
    },
  },
  {
    name: "delete_file",
    description: "파일 또는 폴더를 삭제합니다. 폴더의 경우 하위 내용도 함께 삭제됩니다. 삭제된 항목은 옵시디언 휴지통(.trash)으로 이동합니다.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "삭제할 파일/폴더 경로 (예: old-notes/draft.md)" },
      },
      required: ["path"],
    },
  },
  // === Second Brain Layer 도구 (옵트인) ===
  {
    name: "create_wiki_note",
    description:
      "Second Brain 위키 폴더에 AI-first 규격 노트를 생성합니다(프론트매터 + '## For future AI' 프리앰블). Second Brain 기능이 활성화되어 있어야 하며, 위키 폴더 밖 경로는 거부됩니다.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "노트 제목 (파일명으로 사용)" },
        body: { type: "string", description: "노트 본문 (마크다운). 다른 노트 참조는 [[노트명]] wikilink 형식 사용" },
        category: {
          type: "string",
          description: "카테고리 (entities | concepts | projects). 그 외 값은 위키 루트에 생성",
        },
        meta: {
          type: "object",
          description: "AI-first 메타데이터 (recency, confidence, valid_from, learned_at, source, tags)",
        },
      },
      required: ["title", "body"],
    },
  },
  {
    name: "update_index",
    description:
      "Second Brain 위키 폴더의 노트를 수집하여 index.md 카탈로그를 갱신합니다. 사용자가 직접 추가한 메모(User_Region)는 보존됩니다. Second Brain 기능이 활성화되어 있어야 합니다.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "synthesize_topic",
    description:
      "특정 주제로 볼트를 검색해 관련 노트들의 패턴을 하나의 종합 노트로 모읍니다. 검색 결과가 없으면 노트를 생성하지 않습니다. 재실행 시 사용자가 추가한 주석은 보존됩니다(synthesis 블록만 갱신). Second Brain 기능이 활성화되어 있어야 합니다.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "종합할 주제 또는 태그" },
      },
      required: ["topic"],
    },
  },
  {
    name: "reconcile_topic",
    description:
      "특정 주제로 볼트를 검색해 노트 간 서로 상충하는 진술(모순)을 점검하고 리포트로 제시합니다. 어떤 노트도 수정하지 않으며(비파괴), 정정안은 사용자 승인 전까지 반영되지 않습니다. 검색 결과나 모순이 없으면 안내만 반환합니다. Second Brain 기능이 활성화되어 있어야 합니다.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "모순을 점검할 주제 또는 태그" },
      },
      required: ["topic"],
    },
  },
  {
    name: "architect",
    description:
      "코드베이스 구조(폴더/모듈/진입점)를 스캔하여 아키텍처 노트(Architecture.md)를 생성/갱신합니다. overview/modules/decisions 섹션을 각각 sentinel 블록으로 기록하므로, 재실행 시 사용자가 추가한 메모는 보존됩니다. 볼트 밖 경로는 거부됩니다. Second Brain 기능이 활성화되어 있어야 합니다.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "스캔할 볼트 상대 경로(예: src). 미입력 시 볼트 전체를 스캔",
        },
      },
    },
  },
  {
    name: "challenge",
    description:
      "주장(claim)을 받아 볼트의 과거 노트를 검색하고, 그 노트들을 근거로 주장의 허점·반례·전제를 비판적으로 검토한 반론을 반환합니다. 기본적으로 노트를 생성·수정하지 않습니다(읽기 전용). Second Brain 기능이 활성화되어 있어야 합니다.",
    input_schema: {
      type: "object",
      properties: {
        claim: { type: "string", description: "비판적으로 검토할 현재 주장" },
      },
      required: ["claim"],
    },
  },
  {
    name: "connect",
    description:
      "두 주제(topicA, topicB)를 각각 검색해 노트 집합을 교차 컨텍스트로 묶고, 두 주제를 잇는 공통점·긴장·연결 아이디어를 도출하여 반환합니다. 기본적으로 노트를 생성·수정하지 않습니다(읽기 전용). Second Brain 기능이 활성화되어 있어야 합니다.",
    input_schema: {
      type: "object",
      properties: {
        topicA: { type: "string", description: "연결할 첫 번째 주제" },
        topicB: { type: "string", description: "연결할 두 번째 주제" },
      },
      required: ["topicA", "topicB"],
    },
  },
  {
    name: "emerge",
    description:
      "최근 N일(days) 이내에 수정된 노트들을 인덱스에서 모아, 아직 이름 붙지 않은(미명명) 떠오르는 패턴·주제·연결을 발견하여 제시합니다. 검색이 아니라 인덱스 전체 항목을 사용합니다. 기본적으로 노트를 생성·수정하지 않습니다(읽기 전용). Second Brain 기능이 활성화되어 있어야 합니다.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "최근 일수(0 이하/비정수는 1 이상 정수로 보정)" },
      },
      required: ["days"],
    },
  },
];

// 도구 실행기
export class ToolExecutor {
  private app: App;
  private indexer: VaultIndexer;
  private getTemplateFolder: () => string;
  // Second Brain Layer 의존성 (옵트인). 기존 호출자 하위호환을 위해 선택적으로 주입한다.
  private getSecondBrain?: () => SecondBrainSettings;
  private getAiClient?: () => IAiClient;

  constructor(
    app: App,
    indexer: VaultIndexer,
    getTemplateFolder: () => string,
    // 신규 인자는 기존 인자 뒤에 선택적으로 추가하여 하위호환을 보장한다.
    getSecondBrain?: () => SecondBrainSettings,
    getAiClient?: () => IAiClient,
  ) {
    this.app = app;
    this.indexer = indexer;
    this.getTemplateFolder = getTemplateFolder;
    this.getSecondBrain = getSecondBrain;
    this.getAiClient = getAiClient;
  }

  async execute(toolName: string, input: Record<string, unknown>): Promise<string> {
    try {
      // 모든 LLM 제공 경로를 공통 진입점에서 검증한다. normalizePath는 `..`를
      // 해석하지 않으므로 정규화 전에 탈출 입력을 거부해야 한다.
      const pathKeys = [
        "path",
        "folder",
        "source_path",
        "destination_path",
        "output_path",
        "name",
        "template_name",
      ] as const;
      for (const key of pathKeys) {
        const value = input[key];
        if (typeof value !== "string") continue;
        if (escapesVault(value)) {
          return `도구 실행 오류: ${toolName}: 볼트를 벗어나는 경로는 허용되지 않습니다: ${value}`;
        }
        input[key] = normalizePath(value);
      }
      switch (toolName) {
        case "search_vault":
          return await this.searchVault(input.query as string, (input.limit as number) || 10, input);
        case "read_note":
          return await this.readNote(input.path as string);
        case "create_note":
          return await this.createNote(input.path as string, input.content as string);
        case "edit_note":
          return await this.editNote(input.path as string, input.content as string | undefined, input.find as string | undefined, input.replace as string | undefined);
        case "append_to_note":
          return await this.appendToNote(input.path as string, input.content as string);
        case "list_files":
          return this.listFiles((input.folder as string) || "");
        case "get_active_note":
          return await this.getActiveNote();
        case "open_note":
          return await this.openNote(input.path as string);
        case "list_templates":
          return this.listTemplates();
        case "save_template":
          return await this.saveTemplate(input.name as string, input.content as string);
        case "apply_template":
          return await this.applyTemplate(
            input.template_name as string,
            input.output_path as string,
            (input.variables as Record<string, string>) || {}
          );
        case "move_file":
          return await this.moveFile(
            input.source_path as string,
            input.destination_path as string
          );
        case "delete_file":
          return await this.deleteFile(input.path as string);
        case "create_wiki_note":
          return await this.createWikiNote(input);
        case "update_index":
          return await this.updateIndex();
        case "synthesize_topic":
          return await this.synthesizeTopic(input);
        case "reconcile_topic":
          return await this.reconcileTopic(input);
        case "architect":
          return await this.architect(input);
        case "challenge":
          return await this.challenge(input);
        case "connect":
          return await this.connect(input);
        case "emerge":
          return await this.emerge(input);
        default:
          return `알 수 없는 도구: ${toolName}`;
      }
    } catch (error) {
      return `도구 실행 오류: ${toolName}: ${(error as Error).message}`;
    }
  }

  private async searchVault(
    query: string,
    limit: number,
    rawInput: Record<string, unknown> = {}
  ): Promise<string> {
    // 필터 값 검증을 먼저 한다. 잘못된 값을 조용히 버리면 모델은 조건이 적용됐다고
    // 믿은 채 전체 검색 결과를 근거로 답한다.
    const { filter, problems } = normalizeSearchFilter(rawInput);
    if (problems.length > 0) {
      return `검색 필터가 올바르지 않습니다:\n- ${problems.join("\n- ")}`;
    }
    const filterDesc = describeFilter(filter);

    // 검색 실패(throw)와 정상 빈 결과를 구분한다 (Req 7.6).
    // indexer.search 호출만 별도 try/catch로 감싸, 검색 자체가 실패하면
    // 부분/빈 결과를 정상으로 반환하지 않고 명확한 "검색 실패" 오류 메시지를 반환한다.
    let result: GraphRagResult;
    try {
      result = await this.indexer.search(query, limit, filter);
    } catch (error) {
      return `검색 실패: ${(error as Error).message}`;
    }

    // 빈/공백 쿼리로 검색을 수행하지 않은 경우 (Req 4.7)
    if (result.invalidQuery) {
      return "검색 쿼리가 비어 있습니다. 검색어를 입력해 주세요.";
    }

    // 임베딩 모델 변경으로 기존 벡터를 신뢰할 수 없는 상태를 명시한다. 이 안내가 없으면
    // 사용자와 LLM 모두 검색 품질이 떨어진 사실을 알 수 없다.
    const staleWarning = result.staleEmbeddings
      ? "\n\n⚠️ 임베딩 모델이 변경되어 기존 인덱스를 벡터 검색에 사용할 수 없습니다. 볼트를 다시 인덱싱해 주세요."
      : "";

    // 결과가 비어 있으면 안내 메시지 반환 (Req 7.5)
    if (result.items.length === 0) {
      // 필터가 후보를 다 걷어낸 경우와 인덱스가 없는 경우는 처방이 다르다.
      // 여기서 구분하지 않으면 모델이 불필요한 재인덱싱을 안내한다.
      if (result.filteredOutCount) {
        return (
          `검색 결과가 없습니다. 필터(${filterDesc})가 노트 ${result.filteredOutCount}개를 제외했습니다. ` +
          `조건을 넓혀 다시 시도하세요.${staleWarning}`
        );
      }
      return `검색 결과가 없습니다. 볼트 인덱싱이 필요할 수 있습니다.${staleWarning}`;
    }

    // 결과 헤더 — 키워드 폴백이 사용된 경우 대체 검색 사실을 표시 (Req 4.6)
    const scope = filterDesc ? ` — 필터: ${filterDesc}` : "";
    // 어떤 신호로 찾았는지 밝힌다. 하이브리드 표시가 있으면 정확한 문자열 일치가
    // 순위에 반영됐다는 뜻이므로, 모델이 결과를 다르게 해석할 근거가 된다.
    const mode = result.usedKeywordFallback
      ? "키워드 검색 — 임베딩 인덱스가 없어 키워드 검색으로 대체됨"
      : result.usedHybrid
        ? "Graph RAG + 키워드 융합"
        : "Graph RAG";
    const header = `검색 결과 (${mode})${scope}:`;

    const body = result.items
      .map((item, i) => this.formatSearchItem(item, i + 1))
      .join("\n\n");

    return `${header}\n\n${body}${staleWarning}`;
  }

  // 단일 검색 결과 항목을 Seed/Neighbor 구분 및 관계 정보와 함께 렌더링한다 (Req 7.2~7.4).
  private formatSearchItem(item: GraphRagSearchItem, rank: number): string {
    // 통합 점수를 0.0~1.0 → 백분율로 표현 (Req 7.2)
    const scorePercent = (item.combinedScore * 100).toFixed(1);
    // 적중 청크 본문을 우선 보여준다. item.excerpt는 노트 앞 500자로 고정이라,
    // 아래 인용 앵커가 뒤쪽 절을 가리키는데 본문은 도입부인 모순이 생긴다 — 모델이
    // 앵커의 근거를 받지 못한다.
    const excerpt = (item.matchedText || item.excerpt).slice(0, 500);

    // Seed/Neighbor 구분 라벨 생성 (Req 7.3)
    let label: string;
    if (item.isSeed) {
      label = "[Seed]";
    } else {
      // 이웃 결과는 연결된 시드 식별 정보(제목 우선, 없으면 경로)와 hop 수를 포함 (Req 7.4)
      const seedRef = item.seedTitle || item.seedPath || "(알 수 없는 시드)";
      label = `[Neighbor ← "${seedRef}" / ${item.hop} hop]`;
    }

    // 맞은 청크의 헤딩이 있으면 인용 앵커로 쓰도록 알려준다. 노트 단위 인용은 긴
    // 노트에서 "어딘가에 있다"까지만 말해줘서 사용자가 근거를 다시 찾아야 한다.
    //
    // 앵커 대상은 **경로**다. item.title은 인덱서가 뽑은 첫 H1이지 파일명이 아니므로
    // `[[제목#헤딩]]`은 그 노트를 가리키지 않거나 같은 제목의 다른 노트로 간다.
    // 앵커 표기는 formatAnchorLink가 정한다. 헤딩이나 경로에 `#`·`|`가 있으면 위키링크로
    // 절을 가리킬 방법이 없어 null을 주고, 그때는 노트 단위 인용으로 물러난다 —
    // 존재하지 않는 절을 가리키는 링크보다 정확하다.
    const anchorLink = item.heading
      ? formatAnchorLink(pathWithoutExtension(item.path), item.heading)
      : null;
    const anchor =
      anchorLink === null ? "" : `\n   인용: ${anchorLink} (맞은 구간: "${item.heading}")`;

    return (
      `${label} ${rank}. **${item.title}** (${item.path})\n` +
      `   통합 점수: ${scorePercent}%${anchor}\n` +
      `   발췌: ${excerpt}`
    );
  }

  private async readNote(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) {
      return `파일을 찾을 수 없습니다: ${path}`;
    }
    const content = await this.app.vault.cachedRead(file);
    return `# ${file.basename}\n\n${content}`;
  }

  private async createNote(path: string, content: string): Promise<string> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      return `파일이 이미 존재합니다: ${path}`;
    }

    // 부모 폴더가 없으면 자동 생성 (applyTemplate, moveFile과 동일 패턴)
    const parentDir = path.substring(0, path.lastIndexOf("/"));
    if (parentDir) {
      const dirExists = this.app.vault.getAbstractFileByPath(parentDir);
      if (!dirExists) {
        await this.app.vault.createFolder(parentDir);
      }
    }

    await this.app.vault.create(path, content);
    new Notice(`노트 생성됨: ${path}`);
    return `노트가 생성되었습니다: ${path}`;
  }

  private async editNote(path: string, content?: string, find?: string, replace?: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) {
      return `파일을 찾을 수 없습니다: ${path}`;
    }

    // 부분 수정 모드 (find/replace)
    if (find !== undefined && replace !== undefined) {
      // 빈 find는 거부한다. `"abc".includes("")`가 항상 true라 아래 가드를 통과하고,
      // `split("").join(replace)`가 모든 문자 사이에 replace를 삽입해 노트를 파괴한다.
      if (find === "") {
        return "교체할 텍스트(find)가 비어 있습니다. 찾을 문자열을 지정해 주세요.";
      }
      const current = await this.app.vault.read(file);
      if (!current.includes(find)) {
        return `교체 대상 텍스트를 찾을 수 없습니다: "${find.substring(0, 50)}..."`;
      }
      // find에 해당하는 모든 텍스트를 교체 (사용자가 명시적으로 요청한 편집이므로 vault.modify 사용)
      const updated = current.split(find).join(replace);
      await this.app.vault.modify(file, updated);
      new Notice(`노트 부분 수정됨: ${path}`);
      return `노트가 부분 수정되었습니다: ${path}`;
    }

    // 전체 교체 모드
    if (content !== undefined) {
      await this.app.vault.modify(file, content);
      new Notice(`노트 수정됨: ${path}`);
      return `노트가 수정되었습니다: ${path}`;
    }

    return `content 또는 find/replace 파라미터가 필요합니다.`;
  }

  private async appendToNote(path: string, content: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) {
      return `파일을 찾을 수 없습니다: ${path}`;
    }
    await this.app.vault.append(file, "\n" + content);
    new Notice(`내용 추가됨: ${path}`);
    return `내용이 추가되었습니다: ${path}`;
  }

  private listFiles(folder: string): string {
    const root = folder
      ? this.app.vault.getAbstractFileByPath(folder)
      : this.app.vault.getRoot();

    if (!root || !(root instanceof TFolder)) {
      return `폴더를 찾을 수 없습니다: ${folder}`;
    }

    const items: string[] = [];
    for (const child of root.children) {
      const icon = child instanceof TFolder ? "📁" : "📄";
      items.push(`${icon} ${child.name}`);
    }
    return items.length > 0 ? items.join("\n") : "빈 폴더입니다.";
  }

  private async getActiveNote(): Promise<string> {
    // 활성 마크다운 뷰가 있으면 에디터 값(미저장 편집 포함)을 우선 사용.
    // 채팅 사이드바에 포커스가 있으면 활성 뷰가 ChatView라 null이 되므로,
    // getActiveFile()로 "가장 최근 활성 파일"을 fallback 조회한다.
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file) {
      return `경로: ${view.file.path}\n\n${view.editor.getValue()}`;
    }
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      return "현재 열려있는 노트가 없습니다.";
    }
    const content = await this.app.vault.cachedRead(file);
    return `경로: ${file.path}\n\n${content}`;
  }

  private async openNote(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) {
      return `파일을 찾을 수 없습니다: ${path}`;
    }
    await this.app.workspace.getLeaf(false).openFile(file);
    return `노트를 열었습니다: ${path}`;
  }

  // 템플릿 폴더가 존재하는지 확인하고, 없으면 생성
  private async ensureTemplateFolder(): Promise<string> {
    const folder = this.getTemplateFolder();
    const existing = this.app.vault.getAbstractFileByPath(folder);
    if (!existing) {
      await this.app.vault.createFolder(folder);
    }
    return folder;
  }

  private listTemplates(): string {
    const folder = this.getTemplateFolder();
    const root = this.app.vault.getAbstractFileByPath(folder);
    if (!root || !(root instanceof TFolder)) {
      return `템플릿 폴더가 없습니다: ${folder}\n템플릿을 저장하면 자동으로 생성됩니다.`;
    }

    const templates = root.children
      .filter((f): f is TFile => f instanceof TFile && f.extension === "md")
      .sort((a, b) => a.basename.localeCompare(b.basename));

    if (templates.length === 0) {
      return "저장된 템플릿이 없습니다.";
    }

    return templates
      .map((f, i) => `${i + 1}. 📋 ${f.basename}`)
      .join("\n");
  }

  private async saveTemplate(name: string, content: string): Promise<string> {
    const folder = await this.ensureTemplateFolder();
    const path = `${folder}/${name}.md`;

    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && existing instanceof TFile) {
      // 기존 템플릿 덮어쓰기
      await this.app.vault.modify(existing, content);
      new Notice(`템플릿 수정됨: ${name}`);
      return `템플릿이 수정되었습니다: ${path}`;
    }

    await this.app.vault.create(path, content);
    new Notice(`템플릿 생성됨: ${name}`);
    return `템플릿이 저장되었습니다: ${path}`;
  }

  private async applyTemplate(
    templateName: string,
    outputPath: string,
    variables: Record<string, string>
  ): Promise<string> {
    const folder = this.getTemplateFolder();
    const templatePath = `${folder}/${templateName}.md`;

    const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
    if (!templateFile || !(templateFile instanceof TFile)) {
      return `템플릿을 찾을 수 없습니다: ${templateName}\n사용 가능한 템플릿을 확인하려면 list_templates를 사용하세요.`;
    }

    let content = await this.app.vault.cachedRead(templateFile);

    // {{변수명}} 치환
    for (const [key, value] of Object.entries(variables)) {
      content = content.split(`{{${key}}}`).join(value);
    }

    // 출력 파일 생성
    const existing = this.app.vault.getAbstractFileByPath(outputPath);
    if (existing) {
      return `파일이 이미 존재합니다: ${outputPath}`;
    }

    // 출력 경로의 상위 폴더 확인/생성
    const outputDir = outputPath.substring(0, outputPath.lastIndexOf("/"));
    if (outputDir) {
      const dirExists = this.app.vault.getAbstractFileByPath(outputDir);
      if (!dirExists) {
        await this.app.vault.createFolder(outputDir);
      }
    }

    await this.app.vault.create(outputPath, content);

    // 생성된 노트 열기
    const newFile = this.app.vault.getAbstractFileByPath(outputPath);
    if (newFile && newFile instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(newFile);
    }

    new Notice(`템플릿 적용됨: ${outputPath}`);

    // 남은 미치환 변수 확인
    const remaining = content.match(/\{\{[^}]+\}\}/g);
    if (remaining) {
      return `노트가 생성되었습니다: ${outputPath}\n⚠️ 미치환 변수가 남아있습니다: ${remaining.join(", ")}`;
    }
    return `노트가 생성되었습니다: ${outputPath}`;
  }

  private async moveFile(sourcePath: string, destPath: string): Promise<string> {
    const source = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!source) {
      return `파일/폴더를 찾을 수 없습니다: ${sourcePath}`;
    }

    // 대상 경로에 이미 파일이 존재하는지 확인
    const existing = this.app.vault.getAbstractFileByPath(destPath);
    if (existing) {
      return `대상 경로에 이미 파일이 존재합니다: ${destPath}`;
    }

    // 대상 폴더가 없으면 자동 생성
    const destDir = destPath.substring(0, destPath.lastIndexOf("/"));
    if (destDir) {
      const dirExists = this.app.vault.getAbstractFileByPath(destDir);
      if (!dirExists) {
        await this.app.vault.createFolder(destDir);
      }
    }

    await this.app.fileManager.renameFile(source, destPath);
    const type = source instanceof TFolder ? "폴더" : "파일";
    new Notice(`${type} 이동됨: ${destPath}`);
    return `${type}을(를) 이동했습니다: ${sourcePath} → ${destPath}`;
  }

  private async deleteFile(path: string): Promise<string> {
    const target = this.app.vault.getAbstractFileByPath(path);
    if (!target) {
      return `파일/폴더를 찾을 수 없습니다: ${path}`;
    }
    const type = target instanceof TFolder ? "폴더" : "파일";
    // 옵시디언 휴지통(.trash)으로 이동
    await this.app.vault.trash(target, false);
    new Notice(`${type} 삭제됨: ${path}`);
    return `${type}을(를) 삭제했습니다: ${path}`;
  }

  // ============================================
  // Second Brain Layer 핸들러 (옵트인)
  // ============================================
  // 모든 핸들러는 진입 시 secondBrain.enabled를 확인하고(false면 안내 메시지 반환, Req 6.4),
  // 경로는 normalizePath로 정규화한 뒤 Wiki_Folder 밖 쓰기를 거부한다(Req 6.3).
  // 비활성/미주입 상태에서는 어떤 노트도 생성·수정하지 않는다(옵트인 격리).

  /**
   * Second Brain 설정을 반환한다. 기능이 비활성이거나 의존성이 주입되지 않았으면 null.
   * null인 경우 호출 측은 안내 메시지를 반환하고 쓰기를 수행하지 않는다(Req 6.4).
   */
  private getEnabledSecondBrain(): SecondBrainSettings | null {
    const sb = this.getSecondBrain?.();
    if (!sb || !sb.enabled) {
      return null;
    }
    return sb;
  }

  /**
   * create_wiki_note — AI_First_Note를 Wiki_Folder 하위에 생성한다 (Req 6.2, 6.3, 6.4, 6.6).
   * - enabled=false면 쓰기 없이 안내 메시지 반환 (Req 6.4)
   * - 경로는 normalizePath + Wiki_Folder 범위 검증, 밖이면 거부 (Req 6.3)
   * - 경로 충돌 시 덮어쓰지 않고 충돌 메시지 반환 (Req 6.6)
   * - 정상 생성 시 생성 경로 반환 (Req 6.2)
   */
  private async createWikiNote(input: Record<string, unknown>): Promise<string> {
    const sb = this.getEnabledSecondBrain();
    if (!sb) {
      return "Second Brain 기능이 비활성화되어 있습니다. 설정에서 활성화한 뒤 다시 시도해 주세요.";
    }

    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (title === "") {
      return "노트 제목(title)이 필요합니다.";
    }
    const body = typeof input.body === "string" ? input.body : "";
    const category = typeof input.category === "string" ? input.category : "";
    const metaInput = (input.meta && typeof input.meta === "object"
      ? (input.meta as Record<string, unknown>)
      : {}) as Partial<AiFirstMeta>;

    // 카테고리가 표준 카테고리면 하위 폴더, 아니면 위키 루트에 생성
    const wikiFolder = normalizePath(sb.wikiFolder);
    const resolvedCategory = (WIKI_CATEGORIES as readonly string[]).includes(category)
      ? category
      : "";
    const fileName = `${title}.md`;
    const rawPath = resolvedCategory
      ? `${wikiFolder}/${resolvedCategory}/${fileName}`
      : `${wikiFolder}/${fileName}`;
    const notePath = normalizePath(rawPath);

    // Wiki_Folder 범위 검증 (Req 6.3).
    // normalizePath는 ".." 를 해석하지 않으므로 문자열 prefix 검사만으로는 탈출을 막을 수
    // 없다. ensureWithinFolder가 세그먼트 단위로 ".."·절대경로를 먼저 거부한다.
    const guard = ensureWithinFolder(notePath, wikiFolder);
    if (!guard.ok) {
      return guard.reason;
    }

    // 경로 충돌 확인 — 기존 노트를 덮어쓰지 않는다 (Req 6.6)
    const existing = this.app.vault.getAbstractFileByPath(notePath);
    if (existing) {
      return `노트가 이미 존재하여 덮어쓰지 않았습니다: ${notePath}`;
    }

    // AI_First_Note 문자열 생성 (Req 6.2). 누락 메타는 안전한 기본값으로 보정한다.
    const recency: Recency = metaInput.recency === "dated" ? "dated" : "evergreen";
    const confidence: Confidence =
      metaInput.confidence !== undefined && metaInput.confidence !== null
        ? metaInput.confidence
        : "medium";
    const meta: AiFirstMeta = {
      title,
      recency,
      confidence,
      validFrom: metaInput.validFrom,
      learnedAt: metaInput.learnedAt,
      source: metaInput.source,
      tags: Array.isArray(metaInput.tags) ? metaInput.tags : undefined,
    };
    const noteContent = buildAiFirstNote({ meta, body });

    // 위키 폴더 구조를 보장한 뒤 노트를 생성한다 (Req 4.1 폴더 보장 재사용).
    await ensureWikiFolders(this.app, sb.wikiFolder);
    await this.app.vault.create(notePath, noteContent);
    new Notice(`위키 노트 생성됨: ${notePath}`);
    return `위키 노트가 생성되었습니다: ${notePath}`;
  }

  /**
   * update_index — Wiki_Folder 노트를 수집해 Index_Catalog를 갱신한다 (Req 6.5).
   * buildIndexCatalog로 카탈로그를 만들고 writeIndexCatalog(Block_Key 'catalog')로
   * index.md를 갱신하므로, 사용자가 직접 추가한 메모(User_Region)는 보존된다.
   */
  private async updateIndex(): Promise<string> {
    const sb = this.getEnabledSecondBrain();
    if (!sb) {
      return "Second Brain 기능이 비활성화되어 있습니다. 설정에서 활성화한 뒤 다시 시도해 주세요.";
    }

    const wikiFolder = normalizePath(sb.wikiFolder);
    const entries = this.collectWikiEntries(wikiFolder);
    const catalog = buildIndexCatalog(entries);
    // 폴더가 없을 수도 있으므로 보장 후 카탈로그를 기록한다(User_Region 보존).
    await ensureWikiFolders(this.app, sb.wikiFolder);
    await writeIndexCatalog(this.app, sb.wikiFolder, catalog);
    new Notice(`인덱스 카탈로그 갱신됨 (${entries.length}개 노트)`);
    return `인덱스 카탈로그를 갱신했습니다: ${entries.length}개 노트`;
  }

  /**
   * synthesize_topic — 주제로 검색한 관련 노트를 종합하여 AI_First_Note를 생성/갱신한다 (Req 7.1~7.6).
   * - enabled=false면 쓰기 없이 안내 메시지 반환 (Req 6.4 패턴)
   * - AI 클라이언트가 주입되지 않았으면 안내 메시지 반환(옵트인 격리)
   * - SecondBrainContext를 구성하여 runSynthesize 실행 래퍼에 위임한다(채팅·명령 팔레트 공용 로직).
   *   synthesize는 설정을 영속화하지 않으므로 persist는 no-op이다.
   */
  private async synthesizeTopic(input: Record<string, unknown>): Promise<string> {
    const sb = this.getEnabledSecondBrain();
    if (!sb) {
      return "Second Brain 기능이 비활성화되어 있습니다. 설정에서 활성화한 뒤 다시 시도해 주세요.";
    }

    const aiClient = this.getAiClient?.();
    if (!aiClient) {
      return "AI 클라이언트를 사용할 수 없어 종합을 수행할 수 없습니다.";
    }

    const topic = typeof input.topic === "string" ? input.topic.trim() : "";
    if (topic === "") {
      return "종합할 주제(topic)가 필요합니다.";
    }

    // 실행 컨텍스트 구성 — 기존 접근자(getSecondBrain/getAiClient)와 동일 의존성을 재사용한다.
    // synthesize는 settings를 영속화하지 않으므로 persist는 no-op으로 둔다.
    const ctx: SecondBrainContext = {
      app: this.app,
      indexer: this.indexer,
      aiClient,
      settings: sb,
      wikiFolder: normalizePath(sb.wikiFolder),
      persist: async () => {},
    };

    return await runSynthesize(ctx, topic);
  }

  /**
   * reconcile_topic — 주제로 검색한 관련 노트 간 모순을 점검하여 리포트를 반환한다 (Req 8.1, 8.2, 8.3, 8.5).
   * - enabled=false면 점검 없이 안내 메시지 반환 (Req 6.4 패턴)
   * - AI 클라이언트가 주입되지 않았으면 안내 메시지 반환(옵트인 격리)
   * - SecondBrainContext를 구성하여 runReconcile 실행 래퍼에 위임한다(채팅·명령 팔레트 공용 로직).
   * - runReconcile은 비파괴이므로 어떤 노트도 수정하지 않으며, 설정도 영속화하지 않아 persist는 no-op이다.
   */
  private async reconcileTopic(input: Record<string, unknown>): Promise<string> {
    const sb = this.getEnabledSecondBrain();
    if (!sb) {
      return "Second Brain 기능이 비활성화되어 있습니다. 설정에서 활성화한 뒤 다시 시도해 주세요.";
    }

    const aiClient = this.getAiClient?.();
    if (!aiClient) {
      return "AI 클라이언트를 사용할 수 없어 모순 점검을 수행할 수 없습니다.";
    }

    const topic = typeof input.topic === "string" ? input.topic.trim() : "";
    if (topic === "") {
      return "모순을 점검할 주제(topic)가 필요합니다.";
    }

    // 실행 컨텍스트 구성 — synthesize와 동일 의존성을 재사용한다.
    // reconcile은 비파괴(노트 미변경)이고 settings를 영속화하지 않으므로 persist는 no-op으로 둔다.
    const ctx: SecondBrainContext = {
      app: this.app,
      indexer: this.indexer,
      aiClient,
      settings: sb,
      wikiFolder: normalizePath(sb.wikiFolder),
      persist: async () => {},
    };

    return await runReconcile(ctx, topic);
  }

  /**
   * architect — 코드베이스 구조를 스캔하여 아키텍처 노트를 생성/갱신한다 (Req 10.1, 10.3, 10.4, 10.5).
   * - enabled=false면 분석 없이 안내 메시지 반환 (Req 6.4 패턴, 옵트인 격리)
   * - AI 클라이언트가 주입되지 않았으면 안내 메시지 반환(옵트인 격리)
   * - SecondBrainContext를 구성하여 runArchitect 실행 래퍼에 위임한다(채팅·명령 팔레트 공용 로직).
   * - 섹션별 sentinel 블록 갱신으로 재실행 시 사용자 메모(User_Region)를 보존하며, 볼트 밖 경로는
   *   runArchitect 내부 경로 검증으로 거부된다(Req 10.5). architect는 설정을 영속화하지 않으므로
   *   persist는 no-op이다.
   */
  private async architect(input: Record<string, unknown>): Promise<string> {
    const sb = this.getEnabledSecondBrain();
    if (!sb) {
      return "Second Brain 기능이 비활성화되어 있습니다. 설정에서 활성화한 뒤 다시 시도해 주세요.";
    }

    const aiClient = this.getAiClient?.();
    if (!aiClient) {
      return "AI 클라이언트를 사용할 수 없어 아키텍처 분석을 수행할 수 없습니다.";
    }

    // 스캔 경로는 선택 입력(미입력 시 볼트 전체). 경로 검증은 runArchitect 내부에서 수행한다.
    const scanPath = typeof input.path === "string" ? input.path : undefined;

    // 실행 컨텍스트 구성 — synthesize/reconcile와 동일 의존성을 재사용한다.
    // architect는 settings를 영속화하지 않으므로 persist는 no-op으로 둔다.
    const ctx: SecondBrainContext = {
      app: this.app,
      indexer: this.indexer,
      aiClient,
      settings: sb,
      wikiFolder: normalizePath(sb.wikiFolder),
      persist: async () => {},
    };

    return await runArchitect(ctx, scanPath);
  }

  /**
   * 사고 도구(challenge/connect/emerge) 공용 SecondBrainContext를 구성한다.
   * synthesize/reconcile/architect 핸들러와 동일한 의존성을 재사용하며, 사고 도구는
   * 설정을 영속화하지 않으므로 persist는 no-op이다(읽기 전용).
   */
  private buildThinkingContext(sb: SecondBrainSettings, aiClient: IAiClient): SecondBrainContext {
    return {
      app: this.app,
      indexer: this.indexer,
      aiClient,
      settings: sb,
      wikiFolder: normalizePath(sb.wikiFolder),
      persist: async () => {},
    };
  }

  /**
   * challenge — 과거 노트를 근거로 현재 주장을 반박한다 (Req 9.1, 9.2).
   * - enabled=false면 점검 없이 안내 메시지 반환 (Req 6.4 패턴, 옵트인 격리)
   * - AI 클라이언트가 주입되지 않았으면 안내 메시지 반환(옵트인 격리)
   * - runChallenge에 위임한다. 기본 읽기 전용으로 어떤 노트도 생성·수정하지 않는다.
   */
  private async challenge(input: Record<string, unknown>): Promise<string> {
    const sb = this.getEnabledSecondBrain();
    if (!sb) {
      return "Second Brain 기능이 비활성화되어 있습니다. 설정에서 활성화한 뒤 다시 시도해 주세요.";
    }
    const aiClient = this.getAiClient?.();
    if (!aiClient) {
      return "AI 클라이언트를 사용할 수 없어 비판적 검토를 수행할 수 없습니다.";
    }
    const claim = typeof input.claim === "string" ? input.claim.trim() : "";
    if (claim === "") {
      return "검토할 주장(claim)이 필요합니다.";
    }
    const ctx = this.buildThinkingContext(sb, aiClient);
    return await runChallenge(ctx, claim);
  }

  /**
   * connect — 두 주제를 교차하여 연결 아이디어를 도출한다 (Req 9.1, 9.3).
   * - enabled=false면 점검 없이 안내 메시지 반환 (Req 6.4 패턴, 옵트인 격리)
   * - AI 클라이언트가 주입되지 않았으면 안내 메시지 반환(옵트인 격리)
   * - runConnect에 위임한다. 기본 읽기 전용으로 어떤 노트도 생성·수정하지 않는다.
   */
  private async connect(input: Record<string, unknown>): Promise<string> {
    const sb = this.getEnabledSecondBrain();
    if (!sb) {
      return "Second Brain 기능이 비활성화되어 있습니다. 설정에서 활성화한 뒤 다시 시도해 주세요.";
    }
    const aiClient = this.getAiClient?.();
    if (!aiClient) {
      return "AI 클라이언트를 사용할 수 없어 주제 연결을 수행할 수 없습니다.";
    }
    const topicA = typeof input.topicA === "string" ? input.topicA.trim() : "";
    const topicB = typeof input.topicB === "string" ? input.topicB.trim() : "";
    if (topicA === "" || topicB === "") {
      return "연결할 두 주제(topicA, topicB)가 모두 필요합니다.";
    }
    const ctx = this.buildThinkingContext(sb, aiClient);
    return await runConnect(ctx, topicA, topicB);
  }

  /**
   * emerge — 최근 N일 노트에서 미명명 패턴을 발견한다 (Req 9.1, 9.4, 9.5, 9.6).
   * - enabled=false면 점검 없이 안내 메시지 반환 (Req 6.4 패턴, 옵트인 격리)
   * - AI 클라이언트가 주입되지 않았으면 안내 메시지 반환(옵트인 격리)
   * - runEmerge에 위임한다(검색 대신 getEntries 사용, Req 9.6). 기본 읽기 전용.
   */
  private async emerge(input: Record<string, unknown>): Promise<string> {
    const sb = this.getEnabledSecondBrain();
    if (!sb) {
      return "Second Brain 기능이 비활성화되어 있습니다. 설정에서 활성화한 뒤 다시 시도해 주세요.";
    }
    const aiClient = this.getAiClient?.();
    if (!aiClient) {
      return "AI 클라이언트를 사용할 수 없어 패턴 발견을 수행할 수 없습니다.";
    }
    // days는 숫자 입력. 비숫자는 기본값 7로 두고, 0 이하/비정수 보정은 selectRecentNotes가 수행한다(Req 9.5).
    const days = typeof input.days === "number" ? input.days : 7;
    const ctx = this.buildThinkingContext(sb, aiClient);
    return await runEmerge(ctx, days);
  }

  /**
   * Wiki_Folder 하위 마크다운 노트를 수집하여 CatalogEntry 목록으로 변환한다.
   * - index.md / log.md는 카탈로그 대상에서 제외한다.
   * - 카테고리는 위키 폴더 바로 아래 첫 경로 세그먼트가 표준 카테고리면 그 값, 아니면 빈 값
   *   (buildIndexCatalog가 빈/미상 카테고리를 "기타"로 분류한다, Req 4.6).
   */
  private collectWikiEntries(wikiFolder: string): CatalogEntry[] {
    const prefix = `${wikiFolder}/`;
    const entries: CatalogEntry[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const rel = file.path.slice(prefix.length);
      if (rel === "index.md" || rel === "log.md") continue;
      const slashIdx = rel.indexOf("/");
      const firstSeg = slashIdx >= 0 ? rel.slice(0, slashIdx) : "";
      const category = (WIKI_CATEGORIES as readonly string[]).includes(firstSeg)
        ? firstSeg
        : "";
      entries.push({ path: file.path, title: file.basename, category });
    }
    return entries;
  }
}
