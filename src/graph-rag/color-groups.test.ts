import { describe, it, expect } from "vitest";
import {
  PARA_COLOR_GROUPS,
  MANAGED_QUERY_PREFIX,
  buildParaColorGroups,
  buildTagColorGroups,
  addedQueriesOf,
  hexToRgbInt,
  rgbIntToHex,
  mergeColorGroups,
  removeManagedGroups,
  managedQueriesOf,
  matchesQuery,
  collectTagUsage,
  type GraphColorGroup,
} from "./color-groups";

/** 사용자 수동 그룹 대역. 우리 소유 쿼리와 겹치지 않는 임의 쿼리를 쓴다. */
const userGroup = (query: string, rgb = 111111): GraphColorGroup => ({
  query,
  color: { a: 1, rgb },
});

describe("hexToRgbInt / rgbIntToHex: 24비트 정수 인코딩", () => {
  // graph.json 의 rgb 는 hex 문자열도 {r,g,b} 객체도 아니고 평평한 24비트 정수다.
  // 코어의 getValueInt(){parseInt(getValue().slice(1),16)} 와 정확히 같아야 한다.
  it("코어와 동일하게 #RRGGBB 를 24비트 정수로 변환해야 한다", () => {
    expect(hexToRgbInt("#4a9eff")).toBe(4890367);
    expect(hexToRgbInt("#000000")).toBe(0);
    expect(hexToRgbInt("#ffffff")).toBe(16777215);
  });

  it("대문자 hex 도 동일한 정수를 내야 한다", () => {
    expect(hexToRgbInt("#4A9EFF")).toBe(hexToRgbInt("#4a9eff"));
  });

  it("hex↔정수 왕복이 원본을 보존해야 한다", () => {
    for (const hex of ["#4a9eff", "#e8543f", "#e0a341", "#7d8590", "#000000", "#ffffff"]) {
      expect(rgbIntToHex(hexToRgbInt(hex))).toBe(hex);
    }
  });

  it("잘못된 hex 는 예외를 던져야 한다 — 조용히 0(검정)으로 폴백하면 안 된다", () => {
    // 0 으로 폴백하면 사용자는 "왜 다 검정인가"를 영구히 모른다.
    expect(() => hexToRgbInt("4a9eff")).toThrow();
    expect(() => hexToRgbInt("#xyzxyz")).toThrow();
    expect(() => hexToRgbInt("#fff")).toThrow();
    expect(() => hexToRgbInt("")).toThrow();
  });

  it("변환 결과는 항상 0..16777215 범위여야 한다", () => {
    for (const g of buildParaColorGroups()) {
      expect(g.color.rgb).toBeGreaterThanOrEqual(0);
      expect(g.color.rgb).toBeLessThanOrEqual(16777215);
      expect(Number.isInteger(g.color.rgb)).toBe(true);
    }
  });
});

describe("buildParaColorGroups: PARA 폴더 → 색상 그룹", () => {
  it("PARA 4개 폴더에 대응하는 그룹 4개를 만들어야 한다", () => {
    const groups = buildParaColorGroups();
    expect(groups).toHaveLength(4);
  });

  it("실제 볼트의 PARA 폴더 경로를 path: 쿼리로 써야 한다", () => {
    const queries = buildParaColorGroups().map((g) => g.query);
    expect(queries).toEqual([
      'path:"01. Projects"',
      'path:"02. Areas"',
      'path:"03. Resources"',
      'path:"04. Archives"',
    ]);
  });

  it("모든 그룹이 color 를 반드시 채워야 한다 — 누락은 색칠이 아니라 필터가 된다", () => {
    // 코어 setQuery: `a.color || (this.hasFilter = !0)` — color 가 falsy 면 그 쿼리는
    // 필터로 취급되어 매칭 안 되는 노드를 그래프에서 '제거'한다. 색칠과 정반대다.
    for (const g of buildParaColorGroups()) {
      expect(g.color).toBeTruthy();
      expect(typeof g.color.rgb).toBe("number");
    }
  });

  it("alpha 는 항상 1 이어야 한다 — 0 이면 노드가 투명해져 안 보인다", () => {
    // 코어 렌더: `t.alpha = i.a, t.tint = i.rgb` — a 는 장식이 아니라 실제 알파다.
    for (const g of buildParaColorGroups()) {
      expect(g.color.a).toBe(1);
    }
  });

  it("4개 그룹의 색이 서로 달라야 한다 — 같으면 분류의 의미가 없다", () => {
    const rgbs = buildParaColorGroups().map((g) => g.color.rgb);
    expect(new Set(rgbs).size).toBe(4);
  });

  it("path: 만 사용해 볼트 전체 내용 읽기를 유발하지 않아야 한다", () => {
    // tag: 는 requiredInputs {content:true} 라 모든 md 에 cachedRead 를 돌린다.
    // path: 는 requiredInputs {} 로 파일을 열지 않는다.
    for (const g of buildParaColorGroups()) {
      expect(g.query.startsWith("path:")).toBe(true);
      expect(g.query).not.toContain("tag:");
      expect(g.query).not.toContain("content:");
    }
  });

  it("호출마다 새 배열·새 객체를 반환해 공유 상태 변형을 막아야 한다", () => {
    const a = buildParaColorGroups();
    const b = buildParaColorGroups();
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    expect(a[0].color).not.toBe(b[0].color);
    // 반환값을 변형해도 다음 호출이 오염되지 않아야 한다.
    a[0].color.rgb = 42;
    expect(buildParaColorGroups()[0].color.rgb).not.toBe(42);
  });

  it("PARA_COLOR_GROUPS 정의와 생성 결과의 쿼리가 일치해야 한다", () => {
    expect(buildParaColorGroups().map((g) => g.query)).toEqual(
      PARA_COLOR_GROUPS.map((d) => `path:"${d.folder}"`),
    );
  });
});

describe("managedQueriesOf: 우리 소유 쿼리 식별", () => {
  it("우리가 만든 그룹의 쿼리 전체를 돌려줘야 한다", () => {
    expect(managedQueriesOf()).toEqual(buildParaColorGroups().map((g) => g.query));
  });

  it("MANAGED_QUERY_PREFIX 로 우리 소유를 식별할 수 있어야 한다", () => {
    // 사용자 그룹과 우리 그룹을 구별할 방법이 없으면 재실행 시 사용자 것을 지운다.
    for (const q of managedQueriesOf()) {
      expect(q.startsWith(MANAGED_QUERY_PREFIX)).toBe(true);
    }
  });
});

describe("mergeColorGroups: 사용자 설정 보존", () => {
  it("빈 기존 배열에 우리 그룹 4개를 그대로 넣어야 한다", () => {
    const merged = mergeColorGroups([], buildParaColorGroups(), managedQueriesOf());
    expect(merged).toHaveLength(4);
    expect(merged.map((g) => g.query)).toEqual(managedQueriesOf());
  });

  it("사용자 수동 그룹을 절대 지우지 않아야 한다", () => {
    const existing = [userGroup("tag:#중요"), userGroup('path:"Templates"')];
    const merged = mergeColorGroups(existing, buildParaColorGroups(), managedQueriesOf());
    expect(merged).toHaveLength(6);
    expect(merged.map((g) => g.query)).toContain("tag:#중요");
    expect(merged.map((g) => g.query)).toContain('path:"Templates"');
  });

  it("사용자 그룹을 배열 앞쪽에 둬 우선순위를 지켜야 한다", () => {
    // 코어 setQuery 는 '첫 매칭이 승리하고 break' 이므로 순서 = 우선순위다.
    // 우리 그룹을 앞에 끼우면 사용자가 손으로 만든 색이 우리 색에 가려진다.
    const existing = [userGroup("tag:#중요")];
    const merged = mergeColorGroups(existing, buildParaColorGroups(), managedQueriesOf());
    expect(merged[0].query).toBe("tag:#중요");
    expect(merged.slice(1).map((g) => g.query)).toEqual(managedQueriesOf());
  });

  it("사용자 그룹끼리의 상대 순서도 보존해야 한다", () => {
    const existing = [userGroup("a"), userGroup("b"), userGroup("c")];
    const merged = mergeColorGroups(existing, buildParaColorGroups(), managedQueriesOf());
    expect(merged.slice(0, 3).map((g) => g.query)).toEqual(["a", "b", "c"]);
  });

  it("사용자가 우리 그룹의 색을 바꿔 뒀으면 우리 값으로 되돌아간다(우리 소유 갱신)", () => {
    // 우리 소유 쿼리는 우리가 관리한다 — 재실행이 곧 '정본으로 되돌리기'다.
    const existing = [{ query: 'path:"01. Projects"', color: { a: 1, rgb: 1 } }];
    const merged = mergeColorGroups(existing, buildParaColorGroups(), managedQueriesOf());
    expect(merged).toHaveLength(4);
    const projects = merged.find((g) => g.query === 'path:"01. Projects"');
    expect(projects?.color.rgb).toBe(buildParaColorGroups()[0].color.rgb);
  });

  it("멱등: 두 번 실행해도 결과가 같아야 한다", () => {
    const once = mergeColorGroups([], buildParaColorGroups(), managedQueriesOf());
    const twice = mergeColorGroups(once, buildParaColorGroups(), managedQueriesOf());
    expect(twice).toEqual(once);
  });

  it("멱등: 사용자 그룹이 섞여 있어도 재실행이 중복을 만들지 않아야 한다", () => {
    const existing = [userGroup("tag:#중요")];
    const once = mergeColorGroups(existing, buildParaColorGroups(), managedQueriesOf());
    const twice = mergeColorGroups(once, buildParaColorGroups(), managedQueriesOf());
    const thrice = mergeColorGroups(twice, buildParaColorGroups(), managedQueriesOf());
    expect(thrice).toEqual(once);
    expect(thrice).toHaveLength(5);
    // 쿼리 중복이 0 이어야 한다.
    const queries = thrice.map((g) => g.query);
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("인자 배열을 변형하지 않아야 한다", () => {
    const existing = [userGroup("tag:#중요")];
    const snapshot = JSON.parse(JSON.stringify(existing));
    const ours = buildParaColorGroups();
    const oursSnapshot = JSON.parse(JSON.stringify(ours));
    mergeColorGroups(existing, ours, managedQueriesOf());
    expect(existing).toEqual(snapshot);
    expect(ours).toEqual(oursSnapshot);
  });

  it("기존 배열에 우리 것이 아닌 path: 쿼리가 있으면 사용자 것으로 보존해야 한다", () => {
    // 접두사만 같고 폴더가 다른 쿼리는 우리 소유가 아니다.
    const existing = [userGroup('path:"05. Inbox"')];
    const merged = mergeColorGroups(existing, buildParaColorGroups(), managedQueriesOf());
    expect(merged.map((g) => g.query)).toContain('path:"05. Inbox"');
    expect(merged).toHaveLength(5);
  });

  it("managedQueries 가 비면 기존 그룹을 하나도 건드리지 않는다", () => {
    // 소유 목록이 유실된 상황(과거 버전 데이터)에서 사용자 그룹을 지우거나 덮으면 안 된다.
    const existing = [userGroup('path:"01. Projects"', 9)];
    const merged = mergeColorGroups(existing, buildParaColorGroups(), []);
    // 사용자 색 그대로.
    expect(merged[0].color.rgb).toBe(9);
    // 같은 쿼리를 중복 추가하지 않으므로 사용자 1 + 신규 3 = 4개다.
    // 5개가 되면 색상 그룹 목록에 같은 쿼리가 두 줄 생겨 사용자가 편집할 때 혼란스럽고,
    // 코어는 첫 매칭만 쓰므로 뒤 항목은 죽은 설정이 된다.
    expect(merged).toHaveLength(4);
    expect(new Set(merged.map((g) => g.query)).size).toBe(4);
  });
});

describe("removeManagedGroups: 되돌리기 경로", () => {
  it("우리 그룹만 제거하고 사용자 그룹은 남겨야 한다", () => {
    const existing = [userGroup("tag:#중요"), ...buildParaColorGroups(), userGroup("b")];
    const removed = removeManagedGroups(existing, managedQueriesOf());
    expect(removed.map((g) => g.query)).toEqual(["tag:#중요", "b"]);
  });

  it("우리 그룹이 없으면 원본과 같은 내용을 돌려줘야 한다", () => {
    const existing = [userGroup("tag:#중요")];
    expect(removeManagedGroups(existing, managedQueriesOf())).toEqual(existing);
  });

  it("적용 → 제거 왕복이 원래 상태로 정확히 돌아가야 한다", () => {
    const original = [userGroup("tag:#중요"), userGroup('path:"Templates"')];
    const applied = mergeColorGroups(original, buildParaColorGroups(), managedQueriesOf());
    const reverted = removeManagedGroups(applied, managedQueriesOf());
    expect(reverted).toEqual(original);
  });

  it("인자 배열을 변형하지 않아야 한다", () => {
    const existing = [userGroup("tag:#중요"), ...buildParaColorGroups()];
    const snapshot = JSON.parse(JSON.stringify(existing));
    removeManagedGroups(existing, managedQueriesOf());
    expect(existing).toEqual(snapshot);
  });

  it("전부 우리 것이면 빈 배열이 되어야 한다", () => {
    expect(removeManagedGroups(buildParaColorGroups(), managedQueriesOf())).toEqual([]);
  });
});

describe("matchesQuery: path: 부분문자열 매칭 (코어 동작 재현)", () => {
  // 코어는 path: 를 완전일치가 아니라 정규식 부분문자열로 테스트한다. 우리가 만든
  // 쿼리가 의도한 집합만 잡는지 검증하려면 그 동작을 그대로 재현해야 한다.
  it("폴더 접두 경로를 매칭해야 한다", () => {
    expect(matchesQuery('path:"01. Projects"', "01. Projects/foo.md")).toBe(true);
    expect(matchesQuery('path:"01. Projects"', "01. Projects/sub/bar.md")).toBe(true);
  });

  it("다른 PARA 폴더를 매칭하지 않아야 한다", () => {
    expect(matchesQuery('path:"01. Projects"', "02. Areas/foo.md")).toBe(false);
    expect(matchesQuery('path:"03. Resources"', "04. Archives/foo.md")).toBe(false);
  });

  it("대소문자를 무시해야 한다 (코어는 gmi 플래그를 쓴다)", () => {
    expect(matchesQuery('path:"01. Projects"', "01. projects/foo.md")).toBe(true);
  });

  it("경로 중간에 있어도 매칭된다 — 부분문자열 매칭의 실제 함정", () => {
    // 이것이 코어의 실제 동작이다. 우리 쿼리가 안전한 이유는 아래 회귀 테스트가
    // 실제 볼트 경로 전수로 증명한다.
    expect(matchesQuery('path:"01. Projects"', "Other/01. Projects/x.md")).toBe(true);
  });
});

describe("실제 볼트 회귀: PARA 4개 쿼리가 417 노트를 정확히 분류한다", () => {
  // 실제 볼트(417 md) 실측 카운트를 고정 기대값으로 박는다. 쿼리 문법을 바꿨을 때
  // 분류가 조용히 어긋나는 것을 이 숫자가 잡는다.
  const EXPECTED: Record<string, number> = {
    'path:"01. Projects"': 28,
    'path:"02. Areas"': 112,
    'path:"03. Resources"': 163,
    'path:"04. Archives"': 97,
  };

  /** 실제 볼트 구조를 재현한 가짜 경로 집합(실측 카운트와 동일한 분포). */
  const vaultPaths: string[] = [
    ...Array.from({ length: 28 }, (_, i) => `01. Projects/p${i}.md`),
    ...Array.from({ length: 112 }, (_, i) => `02. Areas/a${i}.md`),
    ...Array.from({ length: 163 }, (_, i) => `03. Resources/r${i}.md`),
    ...Array.from({ length: 97 }, (_, i) => `04. Archives/ar${i}.md`),
    // PARA 밖 노트 17개 (417 - 400) — 어느 그룹에도 잡히면 안 된다.
    ...Array.from({ length: 9 }, (_, i) => `Second Brain/sb${i}.md`),
    ...Array.from({ length: 4 }, (_, i) => `Templates/t${i}.md`),
    ...Array.from({ length: 4 }, (_, i) => `YouTube Summaries/y${i}.md`),
  ];

  it("가짜 볼트가 실제 볼트와 같은 노트 수여야 한다", () => {
    expect(vaultPaths).toHaveLength(417);
  });

  it("각 쿼리가 실측 카운트와 정확히 일치하는 노트 수를 잡아야 한다", () => {
    for (const g of buildParaColorGroups()) {
      const hits = vaultPaths.filter((p) => matchesQuery(g.query, p));
      expect(hits).toHaveLength(EXPECTED[g.query]);
    }
  });

  it("쿼리 간 충돌이 0건이어야 한다 — 한 노트가 두 그룹에 잡히면 안 된다", () => {
    // 숫자 접두사("01. ")가 path: 부분문자열 매칭의 footgun 을 막아준다.
    const groups = buildParaColorGroups();
    for (const p of vaultPaths) {
      const hitCount = groups.filter((g) => matchesQuery(g.query, p)).length;
      expect(hitCount).toBeLessThanOrEqual(1);
    }
  });

  it("PARA 4줄로 400/417 노트가 분류되고 나머지 17개는 무색이어야 한다", () => {
    const groups = buildParaColorGroups();
    const classified = vaultPaths.filter((p) => groups.some((g) => matchesQuery(g.query, p)));
    expect(classified).toHaveLength(400);
    expect(vaultPaths.length - classified.length).toBe(17);
  });

  it("첫 매칭 승리 규칙에서도 각 노트가 의도한 그룹에 배정돼야 한다", () => {
    const groups = buildParaColorGroups();
    const winner = (p: string) => groups.find((g) => matchesQuery(g.query, p))?.query;
    expect(winner("01. Projects/p0.md")).toBe('path:"01. Projects"');
    expect(winner("04. Archives/ar0.md")).toBe('path:"04. Archives"');
    expect(winner("Templates/t0.md")).toBeUndefined();
  });
});

// ============================================
// 사용자 그룹 불간섭 (정책 확정)
// ============================================
// 이 볼트 최상단에는 "01. Projects/"~"04. Archives/" 폴더가 실제로 존재한다. PARA 를
// 쓰는 사용자가 기본 그래프의 색상 그룹으로 이 폴더들을 손수 색칠해 뒀다면, 그 query
// 문자열은 우리가 생성하는 것과 **완전히 동일**하다.
//
// 그래서 "우리 소유"를 query 문자열 일치로 판정하면 두 가지가 깨진다:
//  1. 우리 명령을 한 번도 쓴 적 없는 사용자가 되돌리기를 누르면 자기가 만든 그룹이 지워진다.
//  2. 적용이 사용자가 고른 색을 우리 색으로 덮어쓴다.
//
// 확정 정책: **이미 같은 query 가 있으면 건드리지 않는다.** 소유는 문자열 추측이 아니라
// "우리가 실제로 추가한 것"의 기록(plugin data.json)으로만 판정한다.

describe("이미 존재하는 쿼리는 사용자 것으로 보고 건드리지 않는다", () => {
  const userGroup = (query: string, rgb: number): GraphColorGroup => ({
    query,
    color: { a: 1, rgb },
  });

  it("사용자가 고른 색을 우리 색으로 덮어쓰지 않는다", () => {
    // 사용자가 01. Projects 를 보라(0x9b59b6)로 칠해 둔 상태.
    const existing = [userGroup('path:"01. Projects"', 0x9b59b6)];
    const merged = mergeColorGroups(existing, buildParaColorGroups(), []);
    const projects = merged.filter((g) => g.query === 'path:"01. Projects"');
    expect(projects).toHaveLength(1);
    expect(projects[0].color.rgb).toBe(0x9b59b6);
  });

  it("사용자에게 없는 폴더만 추가한다", () => {
    const existing = [userGroup('path:"01. Projects"', 0x9b59b6)];
    const merged = mergeColorGroups(existing, buildParaColorGroups(), []);
    // 사용자 1개 + 우리가 새로 넣은 3개 = 4개. 중복 없음.
    expect(merged).toHaveLength(4);
    expect(merged.filter((g) => g.query === 'path:"01. Projects"')).toHaveLength(1);
  });

  it("addedQueriesOf 는 실제로 새로 추가한 쿼리만 돌려준다", () => {
    // 이 목록이 곧 되돌리기 대상이다. 사용자 것이 섞이면 그 그룹이 삭제된다.
    const existing = [userGroup('path:"01. Projects"', 0x9b59b6)];
    const added = addedQueriesOf(existing, buildParaColorGroups());
    expect(added).not.toContain('path:"01. Projects"');
    expect(added).toEqual([
      'path:"02. Areas"',
      'path:"03. Resources"',
      'path:"04. Archives"',
    ]);
  });

  it("전부 사용자 것이면 추가할 것이 없다", () => {
    const existing = buildParaColorGroups().map((g) => userGroup(g.query, 0x111111));
    expect(addedQueriesOf(existing, buildParaColorGroups())).toEqual([]);
    const merged = mergeColorGroups(existing, buildParaColorGroups(), []);
    expect(merged).toHaveLength(4);
    // 사용자 색이 전부 그대로여야 한다.
    for (const g of merged) expect(g.color.rgb).toBe(0x111111);
  });
});

describe("되돌리기는 기록된 것만 지운다", () => {
  it("명령을 쓴 적 없는 사용자의 되돌리기는 아무것도 지우지 않는다", () => {
    // 사용자가 손수 만든 PARA 그룹 4개. managedQueries 기록은 비어 있다(적용 이력 없음).
    const existing = buildParaColorGroups().map((g) => ({
      query: g.query,
      color: { a: 1, rgb: 0x9b59b6 },
    }));
    expect(removeManagedGroups(existing, [])).toHaveLength(4);
  });

  it("우리가 추가한 것만 지우고 사용자 것은 남긴다", () => {
    const existing: GraphColorGroup[] = [
      { query: 'path:"01. Projects"', color: { a: 1, rgb: 0x9b59b6 } }, // 사용자 것
      { query: 'path:"02. Areas"', color: { a: 1, rgb: 0xe0a341 } }, // 우리가 추가
    ];
    const left = removeManagedGroups(existing, ['path:"02. Areas"']);
    expect(left).toHaveLength(1);
    expect(left[0].query).toBe('path:"01. Projects"');
    expect(left[0].color.rgb).toBe(0x9b59b6);
  });

  it("적용 → 되돌리기 왕복이 원래 상태로 정확히 복귀한다", () => {
    const before: GraphColorGroup[] = [
      { query: "tag:#중요", color: { a: 1, rgb: 0xff0000 } },
      { query: 'path:"01. Projects"', color: { a: 1, rgb: 0x9b59b6 } },
    ];
    const ours = buildParaColorGroups();
    const added = addedQueriesOf(before, ours);
    const applied = mergeColorGroups(before, ours, []);
    expect(removeManagedGroups(applied, added)).toEqual(before);
  });
});

// ============================================
// 태그 색상 그룹
// ============================================
// PARA 는 폴더 축, 태그는 주제 축이다. 둘을 함께 쓰면 "어느 PARA 에 있는 무슨 주제"가
// 한 그래프에서 보인다.
//
// 주의: tag: 쿼리는 requiredInputs 가 {content:true} 라 코어가 **모든 md 에
// cachedRead** 를 돌린다(path: 는 파일을 열지 않는다). 그래서 태그 그룹은 개수를
// 적게 유지해야 한다 — 51개 고유 태그를 전부 넣으면 그래프가 눈에 보이게 느려진다.

describe("buildTagColorGroups", () => {
  it("빈도순 상위 태그만 그룹으로 만든다", () => {
    const tags = [
      { tag: "english", count: 34 },
      { tag: "DB", count: 18 },
      { tag: "AWS", count: 10 },
      { tag: "rare", count: 1 },
    ];
    const groups = buildTagColorGroups(tags, 3);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.query)).toEqual(["tag:#english", "tag:#DB", "tag:#AWS"]);
  });

  it("최소 사용 횟수 미달 태그는 제외한다", () => {
    // 1~2회짜리 태그를 색칠하면 그래프에 점 하나가 뜨고 cachedRead 비용만 든다.
    const groups = buildTagColorGroups([{ tag: "once", count: 1 }], 10);
    expect(groups).toEqual([]);
  });

  it("한글 태그를 그대로 보존한다", () => {
    const groups = buildTagColorGroups([{ tag: "랭스영", count: 34 }], 5);
    expect(groups[0].query).toBe("tag:#랭스영");
  });

  it("모든 그룹이 a=1 과 유효한 rgb 를 갖는다", () => {
    const groups = buildTagColorGroups(
      [
        { tag: "a", count: 30 },
        { tag: "b", count: 20 },
        { tag: "c", count: 10 },
      ],
      5,
    );
    for (const g of groups) {
      expect(g.color.a).toBe(1);
      expect(Number.isInteger(g.color.rgb)).toBe(true);
      expect(g.color.rgb).toBeGreaterThanOrEqual(0);
      expect(g.color.rgb).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("색이 서로 겹치지 않는다 — 구분이 안 되면 분류의 의미가 없다", () => {
    const tags = Array.from({ length: 6 }, (_, i) => ({ tag: `t${i}`, count: 30 - i }));
    const groups = buildTagColorGroups(tags, 6);
    expect(new Set(groups.map((g) => g.color.rgb)).size).toBe(groups.length);
  });

  it("PARA 쿼리와 충돌하지 않는다", () => {
    // 접두사가 tag: 와 path: 로 달라 소유 판정이 섞이지 않는다.
    const tagQueries = buildTagColorGroups([{ tag: "x", count: 30 }], 5).map((g) => g.query);
    const paraQueries = managedQueriesOf();
    expect(tagQueries.some((q) => paraQueries.includes(q))).toBe(false);
  });

  it("빈 입력에 빈 배열을 돌려준다", () => {
    expect(buildTagColorGroups([], 5)).toEqual([]);
  });

  it("입력 배열을 변형하지 않는다", () => {
    const tags = [
      { tag: "b", count: 10 },
      { tag: "a", count: 30 },
    ];
    const snapshot = JSON.stringify(tags);
    buildTagColorGroups(tags, 5);
    expect(JSON.stringify(tags)).toBe(snapshot);
  });
});

describe("collectTagUsage", () => {
  it("노트 수 기준으로 태그를 집계한다", () => {
    const entries = [
      { tags: ["DB", "AWS"] },
      { tags: ["DB"] },
      { tags: [] },
      {},
    ];
    expect(collectTagUsage(entries)).toEqual([
      { tag: "DB", count: 2 },
      { tag: "AWS", count: 1 },
    ]);
  });

  it("선행 # 를 제거해 같은 태그가 갈라지지 않게 한다", () => {
    // metadataCache 는 버전·경로에 따라 "#tag" 와 "tag" 를 섞어 준다.
    const entries = [{ tags: ["#DB"] }, { tags: ["DB"] }];
    expect(collectTagUsage(entries)).toEqual([{ tag: "DB", count: 2 }]);
  });

  it("한 노트 안의 중복 태그를 1회로 센다", () => {
    // 노트 수가 곧 그래프의 노드 수다. 등장 횟수로 세면 빈도가 부풀려진다.
    expect(collectTagUsage([{ tags: ["DB", "DB", "#DB"] }])).toEqual([{ tag: "DB", count: 1 }]);
  });

  it("빈도 내림차순, 동점은 이름 오름차순으로 정렬한다", () => {
    const entries = [{ tags: ["b", "a", "c"] }, { tags: ["c"] }];
    expect(collectTagUsage(entries).map((u) => u.tag)).toEqual(["c", "a", "b"]);
  });

  it("빈 태그·비문자열을 걸러낸다", () => {
    const entries = [{ tags: ["", "  ", "#", 42 as never, "ok"] }];
    expect(collectTagUsage(entries)).toEqual([{ tag: "ok", count: 1 }]);
  });

  it("빈 인덱스에 빈 배열을 돌려준다", () => {
    expect(collectTagUsage([])).toEqual([]);
  });
});
