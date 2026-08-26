# Imagine 강화 분석

이 문서는 `gpt-image-skill`의 강점과 `imagine`의 강점을 결합하기 위한
네 개의 독립 분석을 한 표로 통합한 기록이다. 분석은 다음 고정 커밋을
기준으로 했다.

- [`GENEXIS-AI/gpt-image-skill`](https://github.com/GENEXIS-AI/gpt-image-skill/tree/9da68649d1e0eb8d618a6960cbdee88af11313ec)
  — `9da68649d1e0eb8d618a6960cbdee88af11313ec`
- [`Mineru98/imagine`](https://github.com/Mineru98/imagine/tree/f7d9fba783ee89340a4015b668924c31e5c0f89d)
  — `f7d9fba783ee89340a4015b668924c31e5c0f89d`

## 통합 장단점 표

| 영역 | `gpt-image-skill` 장점 | `gpt-image-skill` 단점 | `imagine` 장점 | `imagine` 단점 | 반영한 결정 |
|---|---|---|---|---|---|
| 사용자 경험 | 네이티브 이미지 도구 우선, 직접 프롬프트 보존, 설치 후 짧은 안내 | 단일 범용 스킬이라 도메인별 선택지가 적음 | 히어로·포스터·썸네일·캐릭터 등 도메인 UX가 풍부함 | 18개 스킬의 일부는 문서 계약만 있고 실행 경로가 없음 | `/imagine` 라우터는 유지하고 도메인 프리셋은 실제 결정을 바꿀 때만 사용 |
| 프롬프트 | 반복 렌더와 위임된 콘셉트를 구분하고 ordinal 메타데이터를 금지 | 짧고 모호한 요청을 자동 보완하지 않음 | `prompt-director`의 1회 투명 보정과 한국어 입력 지원 | 핵심 SKILL과 스크립트의 보정 규칙이 서로 다름 | `faithful` 기본, 사용자 동의가 있는 `assist`, 명시적 `concepts` 세 모드 |
| 참조·리비전 | 실제 파일 첨부, 역할/순서 지정, 최신 결과를 다음 edit target으로 사용 | CLI가 호스트 버전에 결합되고 큰 단일 런너임 | 캐릭터 카드와 시리즈 일관성 개념이 좋음 | 다중 참조·역할·최신 결과 revision이 일급 개념이 아님 | 실제 경로·역할·최신 결과 ancestry를 workflows 참조에 고정 |
| 안전한 실행 | ChatGPT 인증 확인, API 환경 변수 제거, Images API fallback 금지 | 약 1,950줄 monolith, 일부 검증은 문자열 토큰 검사 | 프로젝트 로컬 출력, manifest sanitizer와 post-processor 아이디어 | 고정 포트의 unpinned OAuth proxy, auth 파일 존재만 검사, 임의 PID 종료 위험 | 네이티브 도구 우선, 키/인증 파일 비노출, 레거시 CLI는 명시적 troubleshooting에서만 다룸 |
| 출력·QA | workspace containment, non-overwrite, PNG magic/IHDR/IEND/alpha 검증 | 시각적 의미·정확한 텍스트는 자동 검증하지 않음 | 결정론적 text composition, pixel/sprite/seamless 후처리 아이디어 | JPEG/WebP는 확장자만 변경하고 검증 실패도 성공 코드가 될 수 있음 | 바이트·확장자 일치, atomic staging, 구조 QA와 최종 시각 QA를 분리 |
| 배치 | shared anchor, 의존성 단계, 기본 2/최대 4 동시성, 중복 출력 방지 | 기본 진행 피드백과 실패 재개 manifest가 약함 | bounded batch helper와 retry policy가 이미 존재 | 실제 generate.js가 helper를 우회하고 최대 8개를 무제한 실행 | 모든 독립 작업은 2/최대 4, 의존 revision은 순차, hidden anchor 금지 |
| 이식성·검증 | macOS/Linux/Windows/WSL2 CI와 fixture 기반 validator | live generation과 일부 adversarial filesystem 경로가 부족함 | Claude plugin 구조와 풍부한 에이전트 책임 문서 | package/module 설정·CI·테스트가 없고 Node 18 계약도 깨짐 | 모듈 경계를 명시하고 정적 계약/CLI 경계 검증을 추가 |

## 분석자별 합의

1. **아키텍처 분석:** `gpt-image-skill`을 신뢰 경계와 런타임의 기준으로
   삼고, `imagine`의 도메인 설정·데이터 카탈로그·결정론적 후처리를
   차별화 계층으로 남긴다.
2. **워크플로우 분석:** 직접 프롬프트는 그대로 전달하되 “다른 콘셉트”를
   명시한 경우에만 완전한 독립 프롬프트를 만든다. 참조는 설명문이 아니라
   실제 파일이어야 하며 revision은 항상 최신 결과를 대상으로 한다.
3. **통합·안전 분석:** 고정된 unauthenticated proxy와 `kill -9`를 정상
   경로에서 제거한다. 경로·MIME·출력 덮어쓰기·동시성·실패 코드를 경계에서
   검증한다.
4. **스킬 설계 분석:** `faithful`/`assist`/`concepts` 모드, 역할이 있는
   참조 입력, bounded batch, 결정론적 QA, opt-in critic을 SKILL 계약으로
   승격한다.

## 범위

이번 강화는 공통 `skills/imagine` 계약과 참조 문서를 먼저 정리한다. 각
도메인 스킬의 실제 실행 어댑터와 legacy OAuth bridge 교체는 별도의 작은
변경으로 검증해야 하며, 문서만으로 구현된 기능을 실행된 것처럼 광고하지
않는다.

