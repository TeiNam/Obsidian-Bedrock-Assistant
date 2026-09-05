import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // window.setTimeout 등 브라우저 전역을 node 환경에서도 쓸 수 있게 맞춘다.
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      // obsidian 패키지는 Obsidian 앱 내에서만 사용 가능하므로 테스트용 모킹 제공
      obsidian: path.resolve(__dirname, "src/__mocks__/obsidian.ts"),
    },
  },
});
