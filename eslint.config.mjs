// 옵시디언 커뮤니티 디렉터리 자동 심사가 돌리는 것과 같은 규칙 집합이다.
// 로컬에서 `npm run lint` 로 심사 결과를 재현할 수 있어야, 제출한 뒤에야
// 지적을 발견하는 일이 없다.
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    // 테스트·목은 tsconfig include 밖이라 타입 기반 규칙이 파싱조차 못 한다.
    // vitest 설정도 같은 이유로 Node 타입이 보이지 않는다. 심사 대상은 배포 번들뿐이다.
    ignores: [
      "main.js",
      "dist/**",
      "src/**/*.test.ts",
      "src/__mocks__/**",
      "vitest.config.ts",
      "vitest.setup.ts",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs", "esbuild.config.mjs"],
        },
      },
    },
  },
]);
