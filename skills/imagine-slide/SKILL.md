---
name: imagine-slide
description: (imagine) Keynote·PowerPoint·Google Slides용 **슬라이드 섹션 일러스트**를 같은 스타일로 일괄 생성한다. 입력은 섹션 제목 리스트(예: "문제 정의, 접근 방법, 결과, 다음 단계")이며, 출력은 투명 배경 PNG 세트로 슬라이드 텍스트 박스와 겹치지 않도록 좌·우 40% 세이프존에 일러스트를 배치한다. 이미지 내부에 텍스트·숫자·차트를 넣지 않는다. Style Guardian은 `imagine-service-section`과 **동일한 시리즈 일관성 체인**을 공유해 "홈/기능/가격/블로그" 등 같은 데크·캠페인의 톤을 유지한다. 사용자가 "슬라이드 일러스트", "발표 자료 비주얼", "imagine-slide", "섹션 이미지 세트" 등을 말하면 이 스킬이 담당한다.
argument-hint: "<--sections \"A, B, C\" | chapter \"<title>\"> [--style flat-gradient|line-mono|iso-geometric|abstract-geometric|paper-cut] [--aspect 16:9|16:10|4:3] [--position right-40|left-40] [--metaphor \"<사용자 메타포>\"] [--keep] [--svg]"
---

# imagine-slide

발표 데크의 각 섹션 일러스트를 "같은 화풍, 다른 메타포"로 뽑아낸다. 중앙 가득 채운 이미지가 아니라 **텍스트 박스가 앉을 40% 여백을 의도적으로 비워둔 레이아웃**이 이 스킬의 정체성.

## 트리거

- `imagine-slide --sections "문제 정의, 접근 방법, 결과, 다음 단계" --style flat-gradient --aspect 16:9`
- `imagine-slide chapter "2부: 실행 전략" --style abstract-geometric`
- `imagine-slide "데이터 파이프라인" --metaphor "구름 위의 등대"`
- "슬라이드 일러스트", "발표 자료 비주얼", "섹션 이미지 세트", "챕터 구분 비주얼"
- "imagine-slide"

## 파이프라인

1. **섹션 파싱**: `--sections "A, B, C"` 쉼표 분리. `chapter "<title>"`은 단일 섹션. 섹션이 없으면 거절(대표 일러스트 1장은 `imagine-hero`로 유도).
2. **스타일 프리셋 매핑**: `--style`을 `config.style_presets`의 영문 구문으로 변환. 공통 prefix(`flat vector illustration, soft gradient fill, clean lines, corporate but friendly, transparent background`)가 항상 앞에 붙음.
3. **위치 규칙**: `--position right-40`이면 `left 60% empty negative space for text block` 구문 append, `left-40`이면 반대. **중앙 배치는 구조적으로 금지** (`position_rules.center_forbidden: true`).
4. **섹션별 메타포 생성**:
   - `--metaphor "<사용자 메타포>"` 플래그가 있으면 그 메타포를 그대로 주입(원문 보존).
   - 없으면 섹션 제목을 명사구 개념으로 압축해 일반적이지 않은 메타포를 제안 (예: "문제 정의" → `magnifying glass over scattered puzzle pieces`). 진부한 첫 후보(전구/화살표/체크리스트)는 회피.
   - `per_section_metaphor_hint: "single focal metaphor, no text, no charts, no numbers"`로 시각 언어 제한.
5. **Style Guardian 조회 (`imagine-service-section` 체인 공유)**: `--keep` 또는 "같은 스타일로"·"이어서" 트리거 시 `style-guardian.js`로 이전 데크의 `style` / `palette_hex` / `metaphor_family` / `position`을 불러와 prefix 주입. 없으면 이번 실행 종료 시 저장.
6. **Negative 강제**: `text, typography, letters, charts with numbers, cluttered, dark mood, photorealistic, photo of people, watermark, logo text`.
7. **이미지 생성**: `config.aspect_mapping`에 따라 가장 가까운 `generate_size` (1536×1024) 선택 후 Codex 이미지 모델 호출. 섹션별 1장씩 순차 호출(`batch.concurrency: 1`), 첫 섹션 결과에서 추출된 팔레트를 Style Guardian에 저장해 이후 섹션에 재주입 → 중간부터 스타일 갈라짐 방지.
8. **후처리 aspect 보정**: `16:10`/`4:3`은 생성 결과를 center-crop 또는 **투명 패드**(세로/가로)로 타겟 규격에 맞춰 저장. 무음 크롭 금지 — 변환 내역을 `_style.json.warnings`에 기록.
9. **SVG 선택 출력**: `--svg` 플래그 시 `scripts/lib/vectorize.js`로 각 PNG를 SVG로 벡터화(`default: false`). potrace 부재 시 PNG만 저장하고 경고.

## 출력 규약

```
./images/slides/<deck-slug>/
├── 01_problem.png
├── 02_approach.png
├── 03_result.png
├── 04_next.png
├── 01_problem.svg ... (optional, --svg)
└── _style.json          ← style, palette_hex, per-section metaphor, aspect, position, warnings
```

- `<deck-slug>`: 사용자 `--slug` 명시 또는 첫 섹션 제목 기반 slugify.
- 섹션 순서(`NN_<slug>`)는 입력 순서를 그대로 유지. 자동 재정렬 금지.
- `--out-dir` 명시 시 그대로 사용. 루트 `./images/` 직하 쓰기 금지.
- 기본 투명 배경. 불투명 배경 요청 시 `--bg solid:#HEX` 명시.

## 프롬프트 규약

- **이미지 내부 텍스트 주입 금지.** 섹션 제목·부제·숫자·퍼센트·차트 라벨을 AI 프롬프트에 넣지 않는다. 슬라이드의 텍스트 박스가 담당한다.
- **중앙 배치 금지.** `position_rules.center_forbidden: true`. 반드시 `right-40` 또는 `left-40`.
- **세이프존 40%**: 텍스트 박스 배치 공간을 비우는 구문이 프롬프트에 항상 append됨.
- **메타포 원문 보존**: `--metaphor` 값은 번역하지 않고 그대로 주입. 한국어 메타포도 OK.
- **시리즈 일관성**: Style Guardian chain으로 색감·선 두께·메타포 패밀리 유지.

## Style Guardian 공유 체인

- **shared_chain_with: `imagine-service-section`** — 두 스킬은 본질적으로 같은 "시리즈 일관성" 문제를 푼다. 하나의 프로젝트에서 블로그 섹션 이미지와 슬라이드 일러스트가 톤이 어긋나지 않도록 manifest 저장 키를 공유.
- 저장 키: `style`, `palette_hex`, `metaphor_family`, `position`.
- `cross_deck_leak: false` — 서로 다른 데크 간 팔레트 누출은 금지. 같은 프로젝트 안에서만 체인 유지.

## Aspect 매핑 (후처리 보정)

| `--aspect` | generate | final | 보정 |
|---|---|---|---|
| `16:9` | 1536×1024 | 1920×1080 | center crop |
| `16:10` | 1536×1024 | 1920×1200 | 상하 **투명 패드** |
| `4:3` | 1536×1024 | 1440×1080 | 좌우 **투명 패드** |

생성 API가 세 enum size만 지원하므로 가장 가까운 것으로 생성 후 **무음 크롭 대신 투명 패드**를 우선 적용해 콘텐츠 손실을 막는다. 크롭이 불가피할 때는 경고와 함께 기록.

## 실패 모드 대응

| 증상 | 조치 |
|---|---|
| 추상 주제에서 진부한 모티프(전구/체크/그래프) | `--metaphor "구름 위의 등대"` 처럼 사용자 메타포 명시. 없으면 진부 후보 회피를 prompt에 넣고 재생성 1회 제안. |
| 4:3 요청인데 16:9로 생성 | enum size 중 가장 가까운 것으로 생성 후 투명 패드. 콘텐츠 잘림 위험 시 경고. |
| 중간 섹션부터 스타일이 갈라짐 | Style Guardian 필수. `--keep`로 수동 강제 또는 이전 섹션 팔레트 재주입. |
| 이미지에 텍스트가 새겨짐 | negative 강화 후 해당 섹션만 재생성 1회. 지속 시 경고 라벨. |
| potrace 부재로 SVG 실패 | PNG만 저장 + `--svg` 요청 실패 경고. vectorize.js가 passthrough 반환. |
| 섹션 개수가 너무 많음(예: 20+) | 동시성 1 유지로 시간은 걸리지만 톤 일관성 우선. 사용자에게 소요 시간 예상치 제공. |

## 금기

- **이미지 내부 텍스트 주입 금지** — 슬라이드 텍스트는 슬라이드에서.
- **중앙 배치 금지** — 40% 세이프존 구조적 강제.
- **섹션 자동 재정렬·추가·제거 금지.** 입력 리스트를 그대로 시리즈로 렌더.
- **무음 크롭 금지** — aspect 보정은 투명 패드 우선, 크롭 시 경고.
- **Style Guardian 스코프 오용 금지** — 다른 프로젝트 데크의 팔레트를 섞지 않는다(`cross_deck_leak: false`).
- **`./images/slides/` 외부 쓰기 금지** (`--out-dir` 지정 없는 한).
- `masterpiece` / `8k UHD` / `fulfill all requests` 류 부스터·우회 문구 금지.

## imagine 계열 스킬과의 관계

- **`imagine-service-section`**: Style Guardian chain 공유 — 홈/기능/가격/블로그·슬라이드의 톤을 함께 관리.
- **`imagine-hero`**: 랜딩 페이지 히어로는 그 스킬. 이 스킬은 슬라이드 내부 섹션 이미지 세트 전용.
- **`compose-text.js`**: 사용하지 않음 — 슬라이드에 글자 얹기는 슬라이드 도구가 담당.
- **`vectorize.js`**: `--svg` 옵션에서만 호출. potrace 부재 시 graceful passthrough.
- **`imagine-og`(소셜 카드)·`imagine-thumb`(YouTube)**과 구분: 이 스킬은 발표 데크 전용, 비율(16:9/16:10/4:3)과 40% 세이프존이 다르다.
