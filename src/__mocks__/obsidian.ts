// obsidian 패키지 테스트용 모킹
// Obsidian API는 앱 내에서만 사용 가능하므로 테스트 환경에서는 최소한의 스텁 제공

export class Notice {
  constructor(_message: string) {
    // 테스트에서는 알림 무시
  }
}

export class TFile {
  path = "";
  basename = "";
  stat = { mtime: 0 };
}

export class App {
  vault = {
    getMarkdownFiles: () => [],
    cachedRead: async () => "",
    getAbstractFileByPath: () => null,
  };
}
