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
    rules: {
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          enforceCamelCaseLower: true,
          ignoreRegex: [
            "^AWS Bedrock$",
            "^text-embedding-004$",
            "^Second Brain$",
            "^ToDo/Archive$",
            "^WebClips$",
          ],
        },
      ],
    },
  },
  {
    // 최소 지원 버전이 1.7.2라 기존 display() 경로를 유지한다.
    // 1.13+ 전용으로 올릴 때 설정 전체를 SettingDefinition으로 전환한다.
    files: ["src/settings-tab.ts"],
    rules: {
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
    },
  },
]);
