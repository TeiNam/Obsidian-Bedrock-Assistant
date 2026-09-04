import { describe, it, expect } from "vitest";
import {
  parseLocalDayStart,
  parseLocalDayEnd,
  normalizeSearchFilter,
  isFilterEmpty,
  matchesFilter,
  filterIndex,
  parsePropertyFilter,
  type SearchFilter,
} from "./entry-filter";
import type { VaultIndexEntry } from "../types";

/** 필터 판정에 쓰이는 필드만 채운 최소 엔트리. */
function entry(overrides: Partial<VaultIndexEntry> = {}): VaultIndexEntry {
  return {
    path: "note.md",
    embedding: [],
    lastModified: new Date(2026, 5, 15, 12, 0).getTime(),
    title: "note",
    excerpt: "",
    ...overrides,
  };
}

describe("parseLocalDayStart / parseLocalDayEnd", () => {
  it("로컬 자정으로 해석한다(UTC가 아니다)", () => {
    const ms = parseLocalDayStart("2026-09-01");

    // UTC로 해석하면 KST에서 09:00이 되어 그날 새벽 노트가 범위에서 빠진다.
    const d = new Date(ms as number);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it("하루의 끝은 23:59:59.999다", () => {
    const d = new Date(parseLocalDayEnd("2026-09-30") as number);

    expect(d.getDate()).toBe(30);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
  });

  it("형식이 틀리면 null이다", () => {
    for (const bad of ["2026-9-1", "26-09-01", "2026/09/01", "지난달", "", "2026-09-01T00:00"]) {
      expect(parseLocalDayStart(bad)).toBeNull();
    }
  });

  it("존재하지 않는 날짜는 null이다(다음 달로 넘기지 않는다)", () => {
    // new Date(2026, 1, 30)은 3월 2일이 된다 — 조용히 통과하면 범위가 엉킨다.
    expect(parseLocalDayStart("2026-02-30")).toBeNull();
    expect(parseLocalDayStart("2026-13-01")).toBeNull();
    expect(parseLocalDayStart("2026-04-31")).toBeNull();
  });

  it("윤년 2월 29일은 유효하다", () => {
    expect(parseLocalDayStart("2028-02-29")).not.toBeNull();
    expect(parseLocalDayStart("2026-02-29")).toBeNull();
  });
});

describe("normalizeSearchFilter", () => {
  it("태그의 선행 #과 대소문자를 정규화하고 중복을 없앤다", () => {
    const { filter } = normalizeSearchFilter({ tags: ["#Work", "work", "  #PROJECT  "] });

    expect(filter.tags).toEqual(["work", "project"]);
  });

  it("태그를 배열 대신 문자열로 줘도 받는다", () => {
    // 모델이 배열 대신 문자열을 넘기는 일이 잦다.
    const { filter } = normalizeSearchFilter({ tags: "#daily" });

    expect(filter.tags).toEqual(["daily"]);
  });

  it("폴더의 앞뒤 슬래시를 제거한다", () => {
    expect(normalizeSearchFilter({ folder: "/Projects/" }).filter.folder).toBe("Projects");
  });

  it("잘못된 날짜는 조용히 버리지 않고 문제로 보고한다", () => {
    const { filter, problems } = normalizeSearchFilter({ modifiedAfter: "지난달" });

    // 필터가 무시된 채 전체 결과를 받으면 조건이 적용되지 않은 걸 아무도 모른다.
    expect(filter.modifiedAfter).toBeUndefined();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("modifiedAfter");
  });

  it("범위가 뒤집히면 문제로 보고한다", () => {
    const { problems } = normalizeSearchFilter({
      modifiedAfter: "2026-09-30",
      modifiedBefore: "2026-09-01",
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("뒤입니다");
  });

  it("같은 날짜를 after/before로 주는 것은 문제가 아니다(그 하루)", () => {
    const { problems } = normalizeSearchFilter({
      modifiedAfter: "2026-09-01",
      modifiedBefore: "2026-09-01",
    });

    expect(problems).toEqual([]);
  });

  it("아무 조건도 없으면 빈 필터다", () => {
    const { filter } = normalizeSearchFilter({ query: "x", limit: 10 });

    expect(isFilterEmpty(filter)).toBe(true);
  });

  it("프론트매터 속성 조건과 값 타입을 파싱한다", () => {
    const { filter, problems } = normalizeSearchFilter({
      properties: ["status=active", "confidence>=0.8", "published=true"],
    });

    expect(problems).toEqual([]);
    expect(filter.properties).toEqual([
      { key: "status", operator: "=", value: "active" },
      { key: "confidence", operator: ">=", value: 0.8 },
      { key: "published", operator: "=", value: true },
    ]);
  });

  it("잘못된 속성 조건을 조용히 버리지 않는다", () => {
    const out = normalizeSearchFilter({ properties: ["status active"] });

    expect(out.filter.properties).toBeUndefined();
    expect(out.problems[0]).toContain("키=값");
  });
});

describe("parsePropertyFilter", () => {
  it("점 표기 키·부분 포함 연산자를 보존한다", () => {
    expect(parsePropertyFilter("project.status ~ 진행")).toEqual({
      key: "project.status",
      operator: "~",
      value: "진행",
    });
  });
});

describe("matchesFilter", () => {
  it("폴더는 경로 경계로 비교한다", () => {
    const f: SearchFilter = { folder: "Note" };

    expect(matchesFilter(entry({ path: "Note/a.md" }), f)).toBe(true);
    expect(matchesFilter(entry({ path: "Note" }), f)).toBe(true);
    // "Notes"는 "Note"의 하위가 아니다 — 접두어 비교만 하면 잘못 걸린다.
    expect(matchesFilter(entry({ path: "Notes/a.md" }), f)).toBe(false);
  });

  it("태그는 하나라도 맞으면 통과한다(OR)", () => {
    const f: SearchFilter = { tags: ["work", "urgent"] };

    expect(matchesFilter(entry({ tags: ["work"] }), f)).toBe(true);
    expect(matchesFilter(entry({ tags: ["personal", "urgent"] }), f)).toBe(true);
    expect(matchesFilter(entry({ tags: ["personal"] }), f)).toBe(false);
    expect(matchesFilter(entry({ tags: [] }), f)).toBe(false);
    expect(matchesFilter(entry({}), f)).toBe(false);
  });

  it("인덱스 태그의 대소문자와 # 유무에 관계없이 맞춘다", () => {
    const f: SearchFilter = { tags: ["work"] };

    expect(matchesFilter(entry({ tags: ["#Work"] }), f)).toBe(true);
    expect(matchesFilter(entry({ tags: ["WORK"] }), f)).toBe(true);
  });

  it("modifiedBefore는 그 날짜를 포함한다", () => {
    const f: SearchFilter = { modifiedBefore: "2026-09-30" };

    // 9월 30일 오후에 수정한 노트가 "9월까지" 조건에서 빠지면 안 된다.
    expect(matchesFilter(entry({ lastModified: new Date(2026, 8, 30, 18, 0).getTime() }), f)).toBe(
      true
    );
    expect(matchesFilter(entry({ lastModified: new Date(2026, 9, 1, 0, 1).getTime() }), f)).toBe(
      false
    );
  });

  it("modifiedAfter는 그 날짜 자정부터 포함한다", () => {
    const f: SearchFilter = { modifiedAfter: "2026-09-01" };

    expect(matchesFilter(entry({ lastModified: new Date(2026, 8, 1, 0, 0).getTime() }), f)).toBe(
      true
    );
    expect(matchesFilter(entry({ lastModified: new Date(2026, 7, 31, 23, 59).getTime() }), f)).toBe(
      false
    );
  });

  it("조건은 AND로 결합된다", () => {
    const f: SearchFilter = { folder: "Work", tags: ["urgent"] };

    expect(matchesFilter(entry({ path: "Work/a.md", tags: ["urgent"] }), f)).toBe(true);
    expect(matchesFilter(entry({ path: "Work/a.md", tags: ["later"] }), f)).toBe(false);
    expect(matchesFilter(entry({ path: "Home/a.md", tags: ["urgent"] }), f)).toBe(false);
  });

  it("프론트매터 문자열·숫자·배열·중첩 속성을 필터링한다", () => {
    const target = entry({
      frontmatter: {
        status: "Active",
        confidence: "0.85",
        aliases: ["Alpha", "Beta"],
        project: { owner: "TeiNam" },
      },
    });

    expect(
      matchesFilter(target, {
        properties: [
          { key: "STATUS", operator: "=", value: "active" },
          { key: "confidence", operator: ">=", value: 0.8 },
          { key: "aliases", operator: "~", value: "bet" },
          { key: "project.owner", operator: "=", value: "teinam" },
        ],
      })
    ).toBe(true);
    expect(
      matchesFilter(target, {
        properties: [{ key: "confidence", operator: ">", value: 0.9 }],
      })
    ).toBe(false);
    expect(
      matchesFilter(target, {
        properties: [{ key: "missing", operator: "!=", value: "x" }],
      })
    ).toBe(false);
  });
});

describe("filterIndex", () => {
  const index = new Map<string, VaultIndexEntry>([
    ["Work/a.md", entry({ path: "Work/a.md", tags: ["urgent"] })],
    ["Work/b.md", entry({ path: "Work/b.md", tags: ["later"] })],
    ["Home/c.md", entry({ path: "Home/c.md", tags: ["urgent"] })],
  ]);

  it("빈 필터는 원본 Map을 그대로 돌려준다", () => {
    expect(filterIndex(index, {})).toBe(index);
  });

  it("통과한 엔트리만 담은 새 Map을 만들고 원본은 건드리지 않는다", () => {
    const out = filterIndex(index, { folder: "Work" });

    expect([...out.keys()].sort()).toEqual(["Work/a.md", "Work/b.md"]);
    expect(index.size).toBe(3);
    expect(out).not.toBe(index);
  });

  it("아무것도 통과하지 못하면 빈 Map이다", () => {
    expect(filterIndex(index, { folder: "Nope" }).size).toBe(0);
  });
});

// ============================================
// 스키마 위반은 조용히 버리지 않는다
// ============================================
/**
 * 값을 버리면 필터가 비어 **볼트 전체**를 검색한다. 모델은 범위를 좁혀 물었는데 범위 밖
 * 노트로 답하게 되므로, 날짜 필터와 같은 규약으로 오류를 낸다.
 */
describe("normalizeSearchFilter — 타입 위반", () => {
  it("folder가 문자열이 아니면 문제로 보고한다", () => {
    const out = normalizeSearchFilter({ folder: 42 });

    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]).toContain("folder");
    expect(out.filter.folder).toBeUndefined();
  });

  it("tags 원소가 문자열이 아니면 문제로 보고한다", () => {
    const out = normalizeSearchFilter({ tags: [123] });

    expect(out.problems).toHaveLength(1);
    expect(out.filter.tags).toBeUndefined();
  });

  it("tags가 배열도 문자열도 아니면 문제로 보고한다", () => {
    expect(normalizeSearchFilter({ tags: { a: 1 } }).problems).toHaveLength(1);
  });

  it("문자열 원소가 섞여 있으면 그것만 살리고 나머지를 보고한다", () => {
    const out = normalizeSearchFilter({ tags: ["work", 5] });

    expect(out.filter.tags).toEqual(["work"]);
    expect(out.problems).toHaveLength(1);
  });

  it("정규화 후 비는 값도 보고한다", () => {
    // "#" 하나만 준 경우처럼 정규화하면 아무것도 남지 않는 입력이다.
    const out = normalizeSearchFilter({ tags: ["#"] });
    expect(out.problems).toHaveLength(1);
  });

  it("빈 문자열은 '지정하지 않음'으로 본다", () => {
    const out = normalizeSearchFilter({ folder: "", tags: "" });

    expect(out.problems).toEqual([]);
    expect(out.filter).toEqual({});
  });

  it("정상 입력에는 문제가 없다", () => {
    const out = normalizeSearchFilter({
      folder: "Projects",
      tags: ["#Work", "idea"],
      properties: "status=active",
    });

    expect(out.problems).toEqual([]);
    expect(out.filter.folder).toBe("Projects");
    expect(out.filter.tags).toEqual(["work", "idea"]);
    expect(out.filter.properties).toHaveLength(1);
  });
});
