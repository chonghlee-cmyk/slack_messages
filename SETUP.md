# 🛠 새 컴퓨터 셋팅 가이드

다른 컴퓨터(회사 등)에서 이 프로젝트를 이어가려면 아래 순서대로 진행하세요.

---

## ✅ 사전 준비 (한 번만)

### 1. Node.js 설치

[https://nodejs.org/](https://nodejs.org/) → **LTS 버전** 다운로드 후 설치

확인:
```bash
node --version    # v20.x 정도 나오면 OK
npm --version
```

### 2. Git 설치

[https://git-scm.com/](https://git-scm.com/) → 다운로드 후 설치

### 3. (선택) VS Code 또는 다른 에디터 설치

---

## 📥 프로젝트 가져오기

원하는 폴더에서 PowerShell 또는 터미널 열고:

```bash
git clone https://github.com/chonghlee-cmyk/slack_messages HUB
cd HUB
npm install
```

> ⚠️ 폴더 이름은 자유. 단 경로에 한글/공백 들어가면 가끔 문제 생기니까 `D:\HUB` 같은 단순 경로 추천.

---

## 🔑 비밀 정보 옮기기 (집 컴퓨터에서 가져옴)

**집 컴퓨터에서 옮길 파일 2개:**

1. **`.env` 파일** (집 컴퓨터의 `C:\Users\V CASA\Desktop\HUB\.env`)
2. **`light-field-459806-n8-23923d6276f1.json`** (Google 서비스 계정 키)

### 안전한 이동 방법

| 방법 | 추천도 |
|------|--------|
| **본인 이메일로 보내기** (제목: `secrets - 삭제할것`) | 👍 가장 쉬움 |
| **1Password / Bitwarden** (Secure Note에 .env 내용 저장) | 👍👍 가장 안전 |
| USB 메모리 | 👍 |
| ❌ Slack/카톡으로 보내기 | 절대 NO (이력 남음) |
| ❌ GitHub에 푸시 | 절대 NO |

옮긴 후 회사 컴퓨터의 **HUB 폴더 루트에** 두 파일 모두 위치시키기:
```
HUB/
├── .env                              ← 여기
├── light-field-459806-n8-...json     ← 여기
├── package.json
└── ...
```

---

## 📁 (선택) 진행 상태 파일 옮기기

집에서 분류 작업 등 진행 중이었으면 `data/` 폴더도 옮기면 이어서 진행 가능:

- `data/sync-state.json` — 마지막 Slack 동기화 시각
- `data/image-migration.json` — 이미지 업로드 매핑
- `data/enrich-progress.json` — AI 분류 진행 상태

**안 옮겨도 괜찮음** (시트 보고 자동으로 이미 처리된 건 스킵함). 옮기면 좀 더 빠를 뿐.

---

## ✅ 동작 확인

가장 간단한 검증 — Supabase Storage 상태 조회:

```bash
npx ts-node scripts/checkStorage.ts
```

성공하면 비슷한 출력이 나옴:
```
Supabase Storage [slack-images]
  파일 수: 2519/2519 (100.0%)
  총 용량: 103.39 MB
```

에러 나면 `.env` 또는 JSON 키 파일 위치 확인.

---

## 🤖 Claude Code 이어서 작업하기

Claude Code 새 세션 시작하고:

```
HUB 프로젝트를 이어서 작업할 거야.
구조는 https://github.com/chonghlee-cmyk/slack_messages/blob/main/ARCHITECTURE.md
참고하고, 지금 [원하는 작업] 시작할 거야.
```

이렇게 시작하면 컨텍스트 빨리 파악함.

---

## 🚀 자주 쓰는 명령어

| 명령 | 용도 |
|------|------|
| `npx ts-node scripts/checkStorage.ts` | Supabase Storage 상태 |
| `npx ts-node scripts/verifyData.ts` | Slack vs 시트 검증 |
| `npm run script:test-slack` | 슬랙 수집 수동 실행 |
| `npx ts-node scripts/syncToSupabase.ts` | 시트 → Supabase 수동 동기화 |
| `npx ts-node scripts/enrichMessages.ts` | AI 분류 이어서 진행 |

---

## ⚠️ 트러블슈팅

**Q. `.env` 옮겼는데 인증 에러**
→ `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` 가 JSON 파일 경로 맞게 설정됐는지 확인. 같은 폴더면 `./파일명.json`.

**Q. `npm install` 에서 sharp 에러**
→ Windows에서 가끔 발생. `npm install --include=optional sharp` 또는 `npm rebuild sharp` 시도.

**Q. `git clone` 인증 요구**
→ GitHub 계정 로그인 필요. [GitHub CLI (gh)](https://cli.github.com/) 설치 후 `gh auth login`.

**Q. 한국어 깨짐**
→ PowerShell에서 `chcp 65001` 한 번 실행하면 UTF-8 모드.

---

질문 있으면 슬랙으로! 🙌
