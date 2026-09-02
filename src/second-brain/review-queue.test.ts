import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  scoreForReview,
  selectReviewQueue,
  normalizeAccessLog,
  recordAccess,
  forgetPath,
  hasPath,
  REVIEW_QUEUE_SIZE,
  REVIEW_COOLDOWN_DAYS,
  MIN_BODY_CHARS,
  type AccessLog,
} from "./review-queue";
import type { VaultIndexEntry } from "../types";

// ============================================
// 복습 큐 (Review Queue) 테스트
// ============================================
// 배경: 볼트가 커지면 검색어를 떠올리지 못한 지식은 영구히 묻힌다. 오래 열지
// 않았지만 연결 가치가 높은 노트를 매일 소수만 재노출한다.
//
// 설계 제약:
//  - LLM·임베딩 호출 0회. 점수는 인덱스 데이터 + 접근 이력만으로 계산한다.
//  - 노트에 SRS 등급 필드를 심지 않는다(볼트 오염 금지). 상태는 플러그인 저장소에만 둔다.
//  - 접근 이력이 없는 도입 초기에는 lastModified로 폴백한다.

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function entry(over: Partial<VaultIndexEntry> & { path: string }): VaultIndexEntry {
  return {
    embedding: [],
    lastModified: NOW - 30 * DAY,
    title: over.path.replace(/\.md$/, ""),
    excerpt: "",
    chunks: [{ index: 0, text: "가".repeat(500), embedding: [] }],
    outlinks: [],
    backlinks: [],
    tags: [],
    frontmatter: {},
    ...over,
  };
}

describe("scoreForReview: 재노출 점수", () => {
  it("오래 안 본 노트가 최근 본 노트보다 높은 점수를 받는다", () => {
    const old = entry({ path: "old.md", backlinks: ["a.md"] });
    const recent = entry({ path: "recent.md", backlinks: ["a.md"] });
    const log: AccessLog = { "old.md": NOW - 100 * DAY, "recent.md": NOW - 1 * DAY };

    expect(scoreForReview(old, log, NOW)).toBeGreaterThan(scoreForReview(recent, log, NOW));
  });

  it("링크가 많은 노트가 고립된 노트보다 높은 점수를 받는다", () => {
    // 연결이 많을수록 다시 볼 가치가 크다(다른 지식으로 이어진다).
    const connected = entry({
      path: "hub.md",
      backlinks: ["a.md", "b.md", "c.md"],
      outlinks: ["d.md"],
    });
    const isolated = entry({ path: "lonely.md" });
    const log: AccessLog = { "hub.md": NOW - 60 * DAY, "lonely.md": NOW - 60 * DAY };

    expect(scoreForReview(connected, log, NOW)).toBeGreaterThan(
      scoreForReview(isolated, log, NOW)
    );
  });

  it("접근 이력이 없으면 lastModified로 폴백한다", () => {
    // 도입 초기에는 이력이 비어 있다. 그때 전부 동점이면 큐가 무의미해진다.
    const older = entry({ path: "older.md", lastModified: NOW - 200 * DAY, backlinks: ["a.md"] });
    const newer = entry({ path: "newer.md", lastModified: NOW - 5 * DAY, backlinks: ["a.md"] });

    expect(scoreForReview(older, {}, NOW)).toBeGreaterThan(scoreForReview(newer, {}, NOW));
  });

  it("쿨다운 기간 내에 재노출된 노트는 0점이다", () => {
    // 같은 노트가 며칠 연속 나오면 큐를 신뢰하지 않게 된다.
    const note = entry({ path: "shown.md", backlinks: ["a.md"] });
    const log: AccessLog = { "shown.md": NOW - 100 * DAY };
    const surfaced = { "shown.md": NOW - (REVIEW_COOLDOWN_DAYS - 1) * DAY };

    expect(scoreForReview(note, log, NOW, surfaced)).toBe(0);
  });

  it("쿨다운이 지나면 다시 후보가 된다", () => {
    const note = entry({ path: "shown.md", backlinks: ["a.md"] });
    const log: AccessLog = { "shown.md": NOW - 100 * DAY };
    const surfaced = { "shown.md": NOW - (REVIEW_COOLDOWN_DAYS + 1) * DAY };

    expect(scoreForReview(note, log, NOW, surfaced)).toBeGreaterThan(0);
  });

  it("본문이 너무 짧은 노트는 0점이다", () => {
    // 빈 노트를 복습시키는 것은 의미가 없다(그건 지식 공백 리포트가 다룬다).
    const stub = entry({
      path: "stub.md",
      backlinks: ["a.md"],
      chunks: [{ index: 0, text: "가".repeat(MIN_BODY_CHARS - 1), embedding: [] }],
    });
    expect(scoreForReview(stub, {}, NOW)).toBe(0);
  });

  it("점수는 항상 유한한 0 이상 값이다", () => {
    const weird = entry({ path: "w.md", lastModified: NOW + 100 * DAY, backlinks: ["a.md"] });
    const score = scoreForReview(weird, {}, NOW);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe("selectReviewQueue: 큐 선정", () => {
  it("점수 상위 N건만 반환한다", () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      entry({
        path: `n${i}.md`,
        backlinks: ["a.md"],
        lastModified: NOW - (i + 10) * DAY,
      })
    );
    const queue = selectReviewQueue(entries, {}, NOW);
    expect(queue).toHaveLength(REVIEW_QUEUE_SIZE);
  });

  it("생성물(위키 폴더 하위)은 제외한다", () => {
    // 자기가 만든 노트를 복습 대상으로 내놓으면 안 된다.
    const entries = [
      entry({ path: "Second Brain/gen.md", backlinks: ["a.md"] }),
      entry({ path: "real.md", backlinks: ["a.md"] }),
    ];
    const queue = selectReviewQueue(entries, {}, NOW, {}, "Second Brain");
    expect(queue.map((q) => q.path)).toEqual(["real.md"]);
  });

  it("0점 노트는 큐에 넣지 않는다", () => {
    // 상한을 채우려고 무의미한 노트를 끼워넣으면 안 된다.
    const entries = [
      entry({
        path: "stub.md",
        chunks: [{ index: 0, text: "짧음", embedding: [] }],
        backlinks: ["a.md"],
      }),
    ];
    expect(selectReviewQueue(entries, {}, NOW)).toEqual([]);
  });

  it("동점이면 경로 오름차순으로 결정적 순서를 유지한다", () => {
    const entries = [
      entry({ path: "b.md", backlinks: ["x.md"] }),
      entry({ path: "a.md", backlinks: ["x.md"] }),
    ];
    const queue = selectReviewQueue(entries, {}, NOW);
    expect(queue.map((q) => q.path)).toEqual(["a.md", "b.md"]);
  });

  it("선정 이유의 원자료를 함께 반환한다", () => {
    // 이유 없이 노트만 던지면 사용자가 왜 봐야 하는지 모른다.
    // 문구가 아니라 원자료를 싣는다 — 표시는 로케일을 아는 뷰가 조립한다.
    const entries = [entry({ path: "n.md", backlinks: ["a.md", "b.md"] })];
    const queue = selectReviewQueue(entries, {}, NOW);
    expect(queue[0].links).toBe(2);
    expect(queue[0].elapsedDays).toBeGreaterThanOrEqual(0);
    // 접근 기록을 빈 객체로 넘겼으므로 파일 수정 시각이 기준이다.
    expect(queue[0].basis).toBe("modified");
  });

  it("접근 기록이 있으면 기준이 마지막 열람이 된다", () => {
    const entries = [entry({ path: "n.md", backlinks: ["a.md"] })];
    const queue = selectReviewQueue(entries, { "n.md": NOW - 40 * 24 * 60 * 60 * 1000 }, NOW);
    expect(queue[0].basis).toBe("opened");
    expect(queue[0].elapsedDays).toBe(40);
  });

  it("빈 인덱스는 빈 큐를 반환한다", () => {
    expect(selectReviewQueue([], {}, NOW)).toEqual([]);
  });
});

describe("normalizeAccessLog: 저장된 이력 복원", () => {
  it("유효하지 않은 값을 걸러낸다", () => {
    const raw = {
      "ok.md": NOW,
      "nan.md": Number.NaN,
      "str.md": "어제",
      "neg.md": -1,
      "inf.md": Number.POSITIVE_INFINITY,
    };
    expect(normalizeAccessLog(raw)).toEqual({ "ok.md": NOW });
  });

  it("객체가 아닌 입력은 빈 객체를 반환한다", () => {
    expect(normalizeAccessLog(null)).toEqual({});
    expect(normalizeAccessLog("x")).toEqual({});
    expect(normalizeAccessLog(undefined)).toEqual({});
  });

  it("항목이 상한을 넘으면 최근 것만 남긴다", () => {
    // 이력이 무한히 자라면 data.json이 비대해진다.
    const raw: Record<string, number> = {};
    for (let i = 0; i < 3000; i++) raw[`n${i}.md`] = NOW - i * 1000;

    const result = normalizeAccessLog(raw);
    const keys = Object.keys(result);
    expect(keys.length).toBeLessThan(3000);
    // 가장 최근 항목은 반드시 살아남아야 한다.
    expect(result["n0.md"]).toBe(NOW);
  });
});

describe("recordAccess: 접근 기록 (불변)", () => {
  it("원본을 변경하지 않고 새 객체를 반환한다", () => {
    const log: AccessLog = { "a.md": 1000 };
    const next = recordAccess(log, "b.md", 2000);

    expect(next).toEqual({ "a.md": 1000, "b.md": 2000 });
    // 불변성: 원본이 그대로여야 한다.
    expect(log).toEqual({ "a.md": 1000 });
  });

  it("같은 경로는 최신 시각으로 덮어쓴다", () => {
    expect(recordAccess({ "a.md": 1000 }, "a.md", 2000)["a.md"]).toBe(2000);
  });

  it("빈 경로는 무시한다", () => {
    const log: AccessLog = { "a.md": 1000 };
    expect(recordAccess(log, "", 2000)).toEqual(log);
  });
});

describe("속성: 점수 계산은 어떤 입력에도 안전하다", () => {
  it("임의의 엔트리·이력에 대해 유한한 0 이상 점수를 반환하고 큐는 상한 이하다", () => {
    const entryArb = fc.record({
      path: fc.string({ minLength: 1, maxLength: 8 }).map((s) => `${s}.md`),
      lastModified: fc.integer({ min: -DAY, max: NOW + 10 * DAY }),
      backlinks: fc.nat({ max: 5 }),
      outlinks: fc.nat({ max: 5 }),
      textLen: fc.nat({ max: 2000 }),
    });

    fc.assert(
      fc.property(
        fc.array(entryArb, { maxLength: 15 }),
        fc.dictionary(fc.string({ maxLength: 8 }), fc.integer({ min: 0, max: NOW })),
        (raw, log) => {
          const entries = raw.map((r) =>
            entry({
              path: r.path,
              lastModified: r.lastModified,
              backlinks: Array.from({ length: r.backlinks }, (_, i) => `b${i}.md`),
              outlinks: Array.from({ length: r.outlinks }, (_, i) => `o${i}.md`),
              chunks: [{ index: 0, text: "가".repeat(r.textLen), embedding: [] }],
            })
          );

          for (const e of entries) {
            const score = scoreForReview(e, log, NOW);
            expect(Number.isFinite(score)).toBe(true);
            expect(score).toBeGreaterThanOrEqual(0);
          }

          const queue = selectReviewQueue(entries, log, NOW);
          expect(queue.length).toBeLessThanOrEqual(REVIEW_QUEUE_SIZE);
          // 결정론: 같은 입력이면 같은 큐.
          expect(selectReviewQueue(entries, log, NOW)).toEqual(queue);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("forgetPath: 삭제된 노트를 이력에서 제거", () => {
  it("해당 경로만 제거하고 나머지는 보존한다(불변)", () => {
    const log: AccessLog = { "a.md": 1000, "b.md": 2000 };
    const next = forgetPath(log, "a.md");

    expect(next).toEqual({ "b.md": 2000 });
    // 원본은 그대로여야 한다.
    expect(log).toEqual({ "a.md": 1000, "b.md": 2000 });
  });

  it("없는 경로면 원본을 그대로 반환한다(불필요한 복사 방지)", () => {
    const log: AccessLog = { "a.md": 1000 };
    expect(forgetPath(log, "missing.md")).toBe(log);
  });

  it("빈 경로는 무시한다", () => {
    const log: AccessLog = { "a.md": 1000 };
    expect(forgetPath(log, "")).toBe(log);
  });
});

describe("hasPath: 정리 필요 여부 판정", () => {
  it("이력에 있는 경로면 true", () => {
    expect(hasPath({ "a.md": 1000 }, "a.md")).toBe(true);
  });

  it("없는 경로·빈 경로·비객체면 false", () => {
    // main.ts의 forgetNoteAccess가 이 값으로 "저장 예약을 건너뛸지"를 결정한다.
    // normalizeAccessLog는 항상 새 객체를 반환하므로 참조 비교로는 판정할 수 없다.
    expect(hasPath({ "a.md": 1000 }, "missing.md")).toBe(false);
    expect(hasPath({ "a.md": 1000 }, "")).toBe(false);
    expect(hasPath(null as unknown as AccessLog, "a.md")).toBe(false);
  });

  it("값이 유효하지 않은 항목은 정리 대상이 아니다", () => {
    // normalizeAccessLog가 이미 걸러낼 값이므로 별도 저장을 유발하지 않아야 한다.
    expect(hasPath({ "a.md": Number.NaN } as AccessLog, "a.md")).toBe(false);
  });
});
