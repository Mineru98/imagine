---
name: image-to-code
description: Convert an image (screenshot, mockup, Figma export) into an HTML page styled with Tailwind CSS. Use this skill whenever the user says "image-to-code …", asks to turn a design image into code, recreate a UI from a screenshot, generate HTML/Tailwind from a mockup, or says things like "이 이미지를 웹페이지로 만들어줘" / "HTML로 바꿔줘" / "Tailwind로 바꿔줘". Result is saved inside ./pages/<slug>/.
argument-hint: "<image> [--out <dir>] [--strict] [--explore] [--tokens <path>]"
---

# image-to-code

디자인 이미지(스크린샷·목업·Figma export)를 **단일 HTML + Tailwind CSS** 페이지로 복원한다. 결과는 프로젝트의 `./pages/<slug>/` 폴더에 저장된다.

## 트리거 예시

아래 중 하나라도 감지되면 이 스킬이 담당한다.

- `image-to-code <path>` (명시 호출)
- "이 이미지를 웹페이지로 만들어줘"
- "HTML로 바꿔줘" / "Tailwind로 바꿔줘"
- "이 스크린샷을 코드로"
- "목업을 마크업으로"

## `imagine` 스킬과의 트리거 충돌 방침

설계 문서 §7.2를 그대로 따른다.

- **`imagine`이 담당**: "이미지 만들어줘", "그려줘", "~스타일로 바꿔줘" 등 시각 **생성·변환** 의도.
- **`image-to-code`가 담당**: "웹페이지로", "HTML로", "Tailwind로", "코드로 바꿔줘" 등 **마크업 변환** 의도.
- **애매한 요청 (예: "이 이미지 변환해줘")**: 자동 추론을 하지 않고 사용자에게 **정확히 1턴만** 질문한 뒤 선택지 응답을 받아 분기한다. 질문 포맷 고정:

  ```
  (A) 다른 이미지로 변환 (imagine)
  (B) HTML / Tailwind 코드로 변환 (image-to-code)
  ```

  사용자 응답 전에는 어느 스킬도 실행하지 않는다.

## 사용법

```bash
# 가장 기본
node <skill-root>/scripts/run.js ./mockups/landing.png

# 지정 출력
node <skill-root>/scripts/run.js ./ui.jpg --out ./pages/dashboard

# 엄격 모드 (diff < 0.90 이면 실패 exit)
node <skill-root>/scripts/run.js ./ui.jpg --strict

# 탐색 모드 (대안 3개)
node <skill-root>/scripts/run.js ./hero.png --explore

# 디자인 토큰 강제
node <skill-root>/scripts/run.js ./hero.png --tokens ./design/tokens.json
```

`--help` 로 옵션 목록을 그대로 출력한다.

## 출력 규약 (설계 §5.2)

```
./pages/<slug>/
├── index.html             ← 단일 파일 (Tailwind CDN 기본)
├── tailwind.config.js     ← --tokens 모드에서만 생성
├── assets/
└── image-to-code-run.json ← Run Manifest (디버그용)
```

- `<slug>` 기본값: 입력 파일 basename + 타임스탬프. `--out` 지정 시 그 경로 그대로 사용.
- **사용자 프로젝트 루트의 `index.html`은 절대 덮어쓰지 않는다.** 반드시 `./pages/<slug>/` 하위에만 쓴다.

## 파이프라인 요약 (설계 §4.1)

오케스트레이터만 에이전트를 호출한다. 에이전트끼리 서로 호출하지 않는다.

1. Input Normalizer → Request Planner
2. Vision Analyst (시퀀스)
3. `Promise.all` — Layout Architect / Design Token Extractor / Asset Extractor / A11y Advisor (병렬)
4. Code Generator → Visual Verifier
5. 실패 시 hotspot으로 Code Generator 1회 재호출 (correction_passes 상한 1)

## 설정

`config.json`의 기본값을 따르며, CLI 플래그로 개별 덮어쓴다. 상세는 `config.json` 주석과 설계 §6 참조.

## 실패 모드

- 입력 이미지 미존재 / 포맷 미지원 → 즉시 에러.
- Visual Verifier가 두 번 연속 임계값 미달 → 경고 배너와 함께 1차 결과 저장(`--strict` 아닐 때).
- OAuth 세션 이슈 → `imagine` 스킬과 동일하게 `reference/installation.md` 안내로 위임.
