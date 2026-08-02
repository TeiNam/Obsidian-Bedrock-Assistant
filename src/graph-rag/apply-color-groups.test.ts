import { describe, it, expect, vi } from "vitest";
import {
  applyColorGroups,
  removeColorGroups,
  readExistingGroups,
  isColorGroupArray,
  type GraphAppLike,
} from "./apply-color-groups";
import { buildParaColorGroups, managedQueriesOf } from "./color-groups";

/** 사용자가 손으로 조율한 물리 파라미터. 어떤 경로에서도 보존돼야 한다. */
const USER_PHYSICS = {
  "collapse-filter": false,
  search: "",
  showTags: true,
  hideUnresolved: true,
  centerStrength: 0.380859375,
  repelStrength: 9.09830729166667,
  linkStrength: 0.655029296875,
  linkDistance: 181,
  scale: 0.1775463371071342,
  close: false,
};

/** 비공개 API(instance) 가 살아있는 앱 목. */
function makeInstanceApp(
  options: Record<string, unknown> = { ...USER_PHYSICS, colorGroups: [] },
  leaves: unknown[] = [],
) {
  const saveOptions = vi.fn();
  const instance = { options, saveOptions };
  const write = vi.fn(async () => undefined);
  const read = vi.fn(async () => JSON.stringify({ ...USER_PHYSICS, colorGroups: [] }));
  const app: GraphAppLike = {
    internalPlugins: { getPluginById: () => ({ instance }) },
    workspace: { getLeavesOfType: () => leaves as never[] },
    vault: { configDir: ".obsidian", adapter: { exists: async () => true, read, write } },
  } as unknown as GraphAppLike;
  return { app, instance, saveOptions, read, write };
}

/** 비공개 API 가 없는 앱 목(파일 폴백 경로 검증용). */
function makeFileOnlyApp(
  fileBody: string = JSON.stringify({ ...USER_PHYSICS, colorGroups: [] }, undefined, 2),
  leaves: unknown[] = [],
  opts: { exists?: boolean; readThrows?: boolean } = {},
) {
  const write = vi.fn(async () => undefined);
  const read = vi.fn(async () => {
    if (opts.readThrows) throw new Error("EIO");
    return fileBody;
  });
  const app: GraphAppLike = {
    internalPlugins: { getPluginById: () => undefined },
    workspace: { getLeavesOfType: () => leaves as never[] },
    vault: {
      configDir: ".obsidian",
      adapter: { exists: async () => opts.exists !== false, read, write },
    },
  } as unknown as GraphAppLike;
  return { app, read, write };
}

/** dataEngine 을 가진 열린 그래프 leaf 목. */
function makeLeaf() {
  const setOptions = vi.fn();
  return { leaf: { view: { dataEngine: { setOptions } } }, setOptions };
}

describe("isColorGroupArray: 스키마 검증", () => {
  it("올바른 colorGroups 배열을 통과시켜야 한다", () => {
    expect(isColorGroupArray(buildParaColorGroups())).toBe(true);
    expect(isColorGroupArray([])).toBe(true);
  });

  it("배열이 아니면 거부해야 한다", () => {
    expect(isColorGroupArray(undefined)).toBe(false);
    expect(isColorGroupArray(null)).toBe(false);
    expect(isColorGroupArray({})).toBe(false);
    expect(isColorGroupArray("path:x")).toBe(false);
  });

  it("query 나 color 가 없는 요소를 거부해야 한다", () => {
    expect(isColorGroupArray([{ query: "a" }])).toBe(false);
    expect(isColorGroupArray([{ color: { a: 1, rgb: 0 } }])).toBe(false);
    expect(isColorGroupArray([{ query: "a", color: null }])).toBe(false);
    expect(isColorGroupArray([{ query: 1, color: { a: 1, rgb: 0 } }])).toBe(false);
    expect(isColorGroupArray([{ query: "a", color: { a: 1, rgb: "x" } }])).toBe(false);
  });
});

describe("readExistingGroups: 기존 그룹 읽기", () => {
  it("instance.options.colorGroups 를 읽어야 한다", () => {
    const existing = [{ query: "tag:#중요", color: { a: 1, rgb: 5 } }];
    const { app } = makeInstanceApp({ ...USER_PHYSICS, colorGroups: existing });
    expect(readExistingGroups(app)).toEqual(existing);
  });

  it("colorGroups 가 없으면 빈 배열을 돌려줘야 한다", () => {
    const { app } = makeInstanceApp({ ...USER_PHYSICS });
    expect(readExistingGroups(app)).toEqual([]);
  });

  it("스키마가 깨져 있으면 빈 배열을 돌려줘야 한다 — 예외를 던지지 않는다", () => {
    const { app } = makeInstanceApp({ colorGroups: "not-an-array" });
    expect(readExistingGroups(app)).toEqual([]);
  });

  it("instance 가 없어도 예외를 던지지 않아야 한다", () => {
    const { app } = makeFileOnlyApp();
    expect(readExistingGroups(app)).toEqual([]);
  });
});

describe("applyColorGroups: 비공개 API 주 채널", () => {
  it("instance.options.colorGroups 를 갱신하고 saveOptions 를 불러야 한다", async () => {
    const { app, instance, saveOptions } = makeInstanceApp();
    const result = await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    expect(result.ok).toBe(true);
    expect(result.channel).toBe("instance");
    expect(instance.options.colorGroups).toHaveLength(4);
    expect(saveOptions).toHaveBeenCalledTimes(1);
  });

  it("사용자 물리 파라미터를 하나도 건드리지 않아야 한다", async () => {
    // 되돌릴 수 없는 손실 1순위. colorGroups 키만 바뀌어야 한다.
    const { app, instance } = makeInstanceApp();
    await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    expect(instance.options.repelStrength).toBe(9.09830729166667);
    expect(instance.options.linkDistance).toBe(181);
    expect(instance.options.scale).toBe(0.1775463371071342);
    expect(instance.options.centerStrength).toBe(0.380859375);
    expect(instance.options.linkStrength).toBe(0.655029296875);
  });

  it("사용자 수동 색상 그룹을 보존하고 앞쪽에 둬야 한다", async () => {
    const existing = [{ query: "tag:#중요", color: { a: 1, rgb: 5 } }];
    const { app, instance } = makeInstanceApp({ ...USER_PHYSICS, colorGroups: existing });
    await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    const groups = instance.options.colorGroups as { query: string }[];
    expect(groups).toHaveLength(5);
    expect(groups[0].query).toBe("tag:#중요");
  });

  it("파일 폴백을 쓰지 않아야 한다 — instance 가 있으면 adapter.write 0회", async () => {
    // saveOptions() 가 코어의 정식 저장 경로다. 우리가 파일을 덧쓰면 경쟁만 만든다.
    const { app, write } = makeInstanceApp();
    await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    expect(write).not.toHaveBeenCalled();
  });

  it("열린 그래프 뷰마다 dataEngine.setOptions 를 불러야 한다", async () => {
    // 이걸 빼면 2초 줌 폴러(renderer.targetScale 감시)가 뷰의 구 메모리를 flush 해
    // 우리 색을 통째로 날린다. getOptions() 는 `var e={}` 로 시작하는 전체 교체다.
    const a = makeLeaf();
    const b = makeLeaf();
    const { app } = makeInstanceApp({ ...USER_PHYSICS, colorGroups: [] }, [a.leaf, b.leaf]);
    const result = await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    expect(a.setOptions).toHaveBeenCalledTimes(1);
    expect(b.setOptions).toHaveBeenCalledTimes(1);
    expect(result.viewsUpdated).toBe(2);
  });

  it("setOptions 에 colorGroups 만 넘겨야 한다 — 다른 키를 넣으면 뷰 상태를 덮어쓴다", async () => {
    // 코어 setOptions 는 `for (var n in e)` 로 존재하는 키의 리스너만 호출하므로
    // 부분 객체가 안전하다. 반대로 전체 options 를 넘기면 사용자의 현재 줌·필터가 밀린다.
    const a = makeLeaf();
    const { app } = makeInstanceApp({ ...USER_PHYSICS, colorGroups: [] }, [a.leaf]);
    await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    const arg = a.setOptions.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(arg)).toEqual(["colorGroups"]);
    expect(arg.colorGroups).toHaveLength(4);
  });

  it("한 leaf 의 setOptions 가 던져도 나머지 leaf 와 저장은 진행돼야 한다", async () => {
    const bad = { view: { dataEngine: { setOptions: () => { throw new Error("boom"); } } } };
    const good = makeLeaf();
    const { app, saveOptions } = makeInstanceApp({ ...USER_PHYSICS, colorGroups: [] }, [
      bad,
      good.leaf,
    ]);
    const result = await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    expect(result.ok).toBe(true);
    expect(good.setOptions).toHaveBeenCalledTimes(1);
    expect(saveOptions).toHaveBeenCalledTimes(1);
    expect(result.viewsUpdated).toBe(1);
  });

  it("dataEngine 이 없는 leaf 를 건너뛰어야 한다", async () => {
    const { app } = makeInstanceApp({ ...USER_PHYSICS, colorGroups: [] }, [{ view: {} }, {}]);
    const result = await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    expect(result.ok).toBe(true);
    expect(result.viewsUpdated).toBe(0);
  });

  it("멱등: 두 번 적용해도 그룹이 늘어나지 않아야 한다", async () => {
    const { app, instance } = makeInstanceApp();
    await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    expect(instance.options.colorGroups).toHaveLength(4);
  });
});

describe("파일을 절대 쓰지 않는다 — 확정 정책", () => {
  // 볼트가 SynologyDrive 위에 있고 .obsidian/ 에 이미 "workspace.json 2.json",
  // "workspace.json 3.json" 동기화 충돌 사본이 존재한다. graph.json 에 우리가 쓰면
  // 같은 충돌 사본이 생겨 사용자 그래프 설정이 갈라진다.
  //
  // 주 채널(비공개 API)은 코어의 saveOptions 가 저장까지 해 주므로 우리가 파일을 쓸
  // 이유가 애초에 없다. API 가 없으면 아무것도 하지 않고 안내만 한다 — 되돌릴 수 없는
  // 손실 대신 "동작 안 함"을 택한다.

  it("instance 가 있으면 adapter.write 를 부르지 않는다", async () => {
    const { app, write } = makeInstanceApp();
    await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    expect(write).not.toHaveBeenCalled();
  });

  it("instance 가 없으면 파일을 쓰지 않고 실패로 보고한다", async () => {
    const { app, write } = makeFileOnlyApp();
    const result = await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    expect(result.ok).toBe(false);
    expect(result.channel).toBe("none");
    expect(write).not.toHaveBeenCalled();
  });

  it("되돌리기도 파일을 쓰지 않는다", async () => {
    const { app, write } = makeFileOnlyApp();
    const result = await removeColorGroups(app, managedQueriesOf());
    expect(result.ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("instance 가 없을 때 이유를 사용자에게 전달한다", async () => {
    // 조용히 실패하면 사용자는 명령이 동작했다고 착각한다.
    const { app } = makeFileOnlyApp();
    const result = await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    expect(result.reason).toBeTruthy();
  });
});

describe("instance 경로 스키마 게이트 — 파일 경로와 대칭", () => {
  // 과거에는 이 검증이 파일 경로에만 있었다. instance 경로에는 없어서, 코어가 빈 options
  // 를 들고 있거나(graph.json 손상 후 재로드) 스키마가 바뀌면 사용자 설정을 통째로
  // 덮어썼다. 두 경로의 안전성이 비대칭이면 안전한 쪽은 의미가 없다.

  it("options 가 빈 객체면 쓰지 않는다 — 손상 후 재로드와 구분할 수 없다", async () => {
    // 코어는 JSON.parse 실패 시 `this.options = await loadData() || {}` 로 빈 객체를 만든다.
    // 이 상태에서 saveOptions 를 부르면 사용자 설정이 colorGroups 하나만 남고 사라진다.
    const { app, saveOptions } = makeInstanceApp({});
    const result = await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    expect(result.ok).toBe(false);
    expect(saveOptions).not.toHaveBeenCalled();
  });

  it("colorGroups 스키마가 인식 불가면 쓰지 않는다", async () => {
    // Obsidian 업데이트로 color 가 hex 문자열이 되면 여기 걸린다. 사용자 그룹을
    // 0개로 코어싱해 병합하면 전부 삭제된다.
    for (const broken of ["broken", 42, { a: 1 }, [{ query: 1, color: {} }]]) {
      const { app, saveOptions } = makeInstanceApp({
        ...USER_PHYSICS,
        colorGroups: broken as never,
      });
      const result = await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
      expect(result.ok).toBe(false);
      expect(saveOptions).not.toHaveBeenCalled();
    }
  });

  it("colorGroups 가 undefined 면 정상 진행한다 — 아직 그룹이 없는 볼트", async () => {
    const opts: Record<string, unknown> = { ...USER_PHYSICS };
    const { app, saveOptions } = makeInstanceApp(opts);
    const result = await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    expect(result.ok).toBe(true);
    expect(saveOptions).toHaveBeenCalledTimes(1);
    expect(opts.colorGroups).toHaveLength(4);
  });

  it("게이트 실패 시 사용자 물리 파라미터가 그대로 남는다", async () => {
    const opts: Record<string, unknown> = { ...USER_PHYSICS, colorGroups: "broken" };
    const snapshot = JSON.stringify(opts);
    const { app } = makeInstanceApp(opts);
    await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    expect(JSON.stringify(opts)).toBe(snapshot);
  });

  it("되돌리기도 같은 게이트를 적용한다", async () => {
    const { app, saveOptions } = makeInstanceApp({});
    const result = await removeColorGroups(app, managedQueriesOf());
    expect(result.ok).toBe(false);
    expect(saveOptions).not.toHaveBeenCalled();
  });
});

describe("applyColorGroups: 예외 안전성", () => {
  it("saveOptions 가 던져도 예외를 밖으로 흘리지 않아야 한다", async () => {
    const { app, instance } = makeInstanceApp();
    instance.saveOptions = vi.fn(() => {
      throw new Error("boom");
    });
    const result = await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe("string");
  });

  it("getPluginById 가 던져도 예외를 흘리지 않고 안내만 한다", async () => {
    // 비공개 API 가 사라진 경우다. 파일 폴백은 정책상 없으므로 실패로 보고하고 끝낸다.
    const { app, write } = makeFileOnlyApp();
    (app.internalPlugins as { getPluginById: unknown }).getPluginById = () => {
      throw new Error("private API gone");
    };
    const result = await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    expect(result.ok).toBe(false);
    expect(result.channel).toBe("none");
    expect(result.reason).toBeTruthy();
    expect(write).not.toHaveBeenCalled();
  });

  it("app 표면이 전부 없어도 예외를 던지지 않아야 한다", async () => {
    const result = await applyColorGroups({} as GraphAppLike, buildParaColorGroups(), []);
    expect(result.ok).toBe(false);
  });
});

describe("removeColorGroups: 되돌리기", () => {
  it("우리 그룹만 제거하고 사용자 그룹을 남겨야 한다", async () => {
    const existing = [
      { query: "tag:#중요", color: { a: 1, rgb: 5 } },
      ...buildParaColorGroups(),
    ];
    const { app, instance, saveOptions } = makeInstanceApp({
      ...USER_PHYSICS,
      colorGroups: existing,
    });
    const result = await removeColorGroups(app, managedQueriesOf());
    expect(result.ok).toBe(true);
    expect(instance.options.colorGroups).toHaveLength(1);
    expect((instance.options.colorGroups as { query: string }[])[0].query).toBe("tag:#중요");
    expect(saveOptions).toHaveBeenCalledTimes(1);
  });

  it("되돌리기도 물리 파라미터를 보존해야 한다", async () => {
    const { app, instance } = makeInstanceApp({
      ...USER_PHYSICS,
      colorGroups: buildParaColorGroups(),
    });
    await removeColorGroups(app, managedQueriesOf());
    expect(instance.options.repelStrength).toBe(9.09830729166667);
    expect(instance.options.linkDistance).toBe(181);
  });

  it("열린 뷰에도 제거를 반영해야 한다", async () => {
    const a = makeLeaf();
    const { app } = makeInstanceApp(
      { ...USER_PHYSICS, colorGroups: buildParaColorGroups() },
      [a.leaf],
    );
    await removeColorGroups(app, managedQueriesOf());
    const arg = a.setOptions.mock.calls[0][0] as { colorGroups: unknown[] };
    expect(arg.colorGroups).toHaveLength(0);
  });

  it("사용자 그룹과 섞여 있어도 우리 것만 제거하고 물리 파라미터를 보존한다", async () => {
    const opts: Record<string, unknown> = {
      ...USER_PHYSICS,
      colorGroups: [{ query: "tag:#중요", color: { a: 1, rgb: 5 } }, ...buildParaColorGroups()],
    };
    const { app } = makeInstanceApp(opts);
    const result = await removeColorGroups(app, managedQueriesOf());
    expect(result.ok).toBe(true);
    const left = opts.colorGroups as { query: string }[];
    expect(left).toHaveLength(1);
    expect(left[0].query).toBe("tag:#중요");
    expect(opts.repelStrength).toBe(9.09830729166667);
  });

  it("적용 → 되돌리기 왕복이 원래 colorGroups 로 복귀해야 한다", async () => {
    const original = [{ query: "tag:#중요", color: { a: 1, rgb: 5 } }];
    const { app, instance } = makeInstanceApp({
      ...USER_PHYSICS,
      colorGroups: original.map((g) => ({ ...g, color: { ...g.color } })),
    });
    await applyColorGroups(app, buildParaColorGroups(), managedQueriesOf());
    await removeColorGroups(app, managedQueriesOf());
    expect(instance.options.colorGroups).toEqual(original);
  });
});
