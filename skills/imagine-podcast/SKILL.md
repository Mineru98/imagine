---
name: imagine-podcast
description: (imagine) Apple Podcasts·Spotify·오디오북·"Audio Only" 유튜브용 **3000×3000 팟캐스트 커버 아트**와 에피소드별 variant를 생성한다. AI는 1024×1024 배경·모티프만 그리고 `scripts/lib/upscale.js`로 3000×3000까지 확대(sharp Lanczos3 기본, Real-ESRGAN opt-in)한 뒤 `scripts/lib/compose-text.js`로 쇼 이름·에피소드 제목을 시스템 폰트로 합성한다. 출력은 Apple Podcasts 규격(JPEG, RGB, 3000×3000, 500KB~500MB)을 **자동 검증**하고 55×55 축소 프리뷰에서 엔트로피·대비를 측정해 가독성 경고를 발행한다. 사용자가 "팟캐스트 커버", "imagine-podcast", "오디오북 커버", "플레이리스트 커버", "에피소드 커버" 등을 말하면 이 스킬이 담당한다.
argument-hint: "<show-name-or-concept> [--style vintage-radio|modern-minimal|neon-night|paper-grain] [--primary #HEX] [--secondary #HEX] [--esrgan] | episode --master <cover.jpg> --ep <n> --title <text>"
---

# imagine-podcast

팟캐스트 커버는 **3000×3000 정방형 JPEG**인데, 동시에 **55×55 썸네일**에서도 모티프와 쇼 이름이 읽혀야 한다. 이 두 제약을 한꺼번에 만족시키려면:

1. AI는 **큰 실루엣·단순 모티프**만 그리고 (글자 금지),
2. **고해상도 업스케일**로 인쇄·Retina 품질 확보하고,
3. **쇼 이름 조판은 시스템 폰트**로 합성한다.

## 트리거

- `imagine-podcast "딥러닝을 씹어먹는 밤" --style vintage-radio --primary "#F59E0B"`
- `imagine-podcast episode --master ./images/podcast/cover.jpg --ep 12 --title "트랜스포머의 기원"`
- "팟캐스트 커버 만들어줘", "Apple Podcasts 커버", "오디오북 커버", "플레이리스트 커버", "에피소드 커버 variant"
- "imagine-podcast"

## 파이프라인 (마스터 생성)

1. **프롬프트 구성**:
   - `config.style_presets`에서 `--style` 키 선택 → 영문 구문.
   - `--primary`/`--secondary` HEX는 **이름 구문**으로 변환 후 주입. 원본 HEX는 `_brand.json`에만 저장.
   - `positive_suffix`: `bold silhouette, recognizable at small size, centered motif, solid or simple gradient background`.
2. **Negative 강제**: `text, letters, logo text, watermark, cluttered small details, tiny icons, thin outlines, photo of faces, photorealistic skin`. **쇼 이름·에피소드 제목을 프롬프트에 절대 주입하지 않는다.**
3. **AI 배경 생성**: Codex 이미지 모델로 `ai_generate_size: 1024x1024` PNG 1장. 이 파일은 `cover_master_bg.png`로 **글자 없는 원본** 보존 — 후속 에피소드 variant가 재합성할 때 사용.
4. **업스케일** (`scripts/lib/upscale.js`):
   - 기본: sharp **Lanczos3**로 3000×3000 확대.
   - `--esrgan` 플래그 시 Real-ESRGAN CLI 사용 시도. 실패 시 Lanczos3로 폴백하고 사용자에게 경고 (`"upscale: Real-ESRGAN failed (<reason>); falling back to Lanczos3."`).
   - 업스케일 결과는 일단 PNG로 내부 처리.
5. **쇼 이름 합성** (`scripts/lib/compose-text.js`): 기본 폰트 `Pretendard Bold`, `safe_zone_ratio: 0.80`, 자동 명도 측정으로 흰색/검정 자동 선택. 세이프존은 상/하단 20%를 비워 Apple Podcasts가 요구하는 가독성 유지.
6. **JPEG 인코딩** (RGB, 4:4:4): sharp `.jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true }).flatten({ background: '#ffffff' })`. **CMYK·그레이스케일 저장 금지.**
7. **Apple Podcasts 규격 자동 검증** (`apple_podcasts_spec.verify_default: true`): 크기 3000×3000 일치 + JPEG + RGB + 바이트 수 500KB~500MB 범위. 어긋나면 재인코딩 품질 조정 또는 사용자 경고.
8. **55×55 썸네일 프리뷰**: sharp Lanczos3로 55×55 JPEG 저장(`<master>_thumb55.jpg`). **엔트로피/대비 측정**:
   - 엔트로피 < `entropy_warn_below: 3.0` → "모티프가 너무 단조로워 썸네일에서 식별 어려움" 경고.
   - 대비 점수 < `contrast_warn_below: 0.25` → "썸네일 대비 부족" 경고.
   - 경고는 `_brand.json.warnings[]`에 기록 후 사용자에게 노출, 자동 재생성은 하지 않음.

## 파이프라인 (에피소드 variant)

`imagine-podcast episode --master <cover.jpg> --ep <n> --title "<text>"`

- `cover_master_bg.png`(글자 없는 원본)를 그대로 재사용. **AI 재호출 없음** — 쿼터·일관성 보호(`episode_variant.never_regenerate_bg: true`).
- `compose-text.js`로 쇼 이름 + 에피소드 번호 + 제목을 상/하단에 조판.
- 저장: `./images/podcast/<show-slug>/ep/ep<nn>_<slug>.jpg` (`filename_pattern: "ep<nn>_<slug>.jpg"`).
- `episode_list.jsonl`에 한 줄 추가: `{ ep, title, slug, ts, master_hash }` — 이력만, 이미지 바이트·raw prompt 저장 금지.

## 출력 규약

```
./images/podcast/<show-slug>/
├── cover_master.jpg            ← 3000×3000 JPEG, 쇼 이름 합성 완료 (Apple 규격)
├── cover_master_bg.png         ← 글자 없는 AI 원본 (에피소드 재합성용)
├── cover_master_thumb55.jpg    ← 55×55 프리뷰 (가독성 자동 평가용)
├── ep/
│   ├── ep12_트랜스포머의-기원.jpg
│   ├── ep13_어텐션-메커니즘.jpg
│   └── ...
├── episode_list.jsonl          ← 에피소드 이력 (이미지 데이터 없음)
└── _brand.json                 ← style/palette/font/warnings/apple_spec_verification
```

- `<show-slug>`: 사용자 `--slug` 또는 쇼 이름 slugify.
- `--out-dir` 지정 없으면 `./images/podcast/<show-slug>/` 고정. 루트 `./images/` 직하 쓰기 금지.

## 프롬프트 규약

- **쇼 이름·에피소드 제목 프롬프트 주입 금지.** 모든 글자는 `compose-text.js` 후처리로만 들어간다.
- **Apple Podcasts·Spotify 로고 직접 렌더링 금지.** 플랫폼 브랜드 마크를 커버에 올리지 않는다 (negative에 `logo text` 포함 + 자체 브랜드 로고는 사용자가 별도 레이어로 원할 때만 수동 합성).
- **모티프는 크고 단순하게**: `bold silhouette, recognizable at small size`가 `positive_suffix`에 고정. 복잡한 장식 차단.
- **컬러**: HEX 직기재 금지, 이름 구문 주입, 원본 HEX는 manifest에만.

## 업스케일 모드

- **기본 (`--esrgan` 없음)**: `upscale.js`가 sharp Lanczos3로 3000×3000 리사이즈. 결정적, 외부 의존 0.
- **opt-in (`--esrgan`)**: Real-ESRGAN CLI(예: `realesrgan-ncnn-vulkan`) 호출 시도. 성공하면 SR 결과 사용, 실패하면 **즉시 Lanczos3 폴백** + 사유 경고. 가짜 성공 금지.
- 업스케일 모듈은 "external binary 없음" 상태를 에러로 취급하지 않고 graceful fallback으로 처리.

## Apple Podcasts 규격 자동 검증

`config.apple_podcasts_spec`:

| 항목 | 값 |
|---|---|
| 크기 | **3000×3000** |
| 포맷 | JPEG |
| 색공간 | RGB (CMYK/Grayscale 금지) |
| 바이트 | 500KB ~ 500MB |

검증 실패 시:
- 바이트 하한 미달 → `jpeg_quality`를 한 단계 상향해 재인코딩.
- 바이트 상한 초과 → `jpeg_quality`를 내려 재인코딩.
- 색공간 불일치 → sharp `.toColorspace('srgb')`로 강제 변환 후 재저장.
- 규격 통과가 확정되면 `_brand.json.apple_spec_verification: "pass"` 기록.

## 55×55 썸네일 가독성 점검

- 자동 리사이즈 후 **Shannon 엔트로피**와 **평균 대비**를 계산.
- 임계치 미달 시 경고를 `_brand.json.warnings[]`에 기록하고 사용자에게 "모티프 단순화 권장" 안내.
- 자동 재생성은 하지 않는다 — 팟캐스트 커버의 단순성은 사용자 의도 영역이기도 하다.

## 실패 모드 대응

| 증상 | 조치 |
|---|---|
| 55×55에서 모티프 뭉개짐 | 엔트로피/대비 경고 + `--style` 단순한 프리셋 권장(`modern-minimal` / `paper-grain`). 자동 재생성 없음. |
| Real-ESRGAN CLI 부재/실패 | Lanczos3 폴백 + 원인(`esrgan_spawn_error` / `esrgan_exit_N` / `esrgan_missing_output`) 경고. |
| 1024 → 3000 Lanczos 뭉개짐 | 크게 단순한 모티프 유지(positive suffix 강제). 고품질이 필요하면 `--esrgan` opt-in. |
| CMYK·Grayscale JPEG로 저장됨 | sharp `toColorspace('srgb')`로 강제 + 재저장. |
| 용량 규격 미달/초과 | jpeg quality 자동 ±5 조정 루프(최대 3회). 그래도 실패면 사용자에게 노출. |
| compose-text.js 부재 | 명시적 에러(`npm i sharp`). 글자 없는 마스터 PNG는 보존. |
| 에피소드 variant 시 마스터 PNG 부재 | 거절. `imagine-podcast <show>` 먼저 실행하도록 안내. AI 재호출로 가려 메우지 않는다. |

## 금기

- **쇼 이름·에피소드 제목을 AI 프롬프트에 주입 금지.**
- **에피소드 variant에서 AI 재호출 금지** (`never_regenerate_bg: true`). 마스터 PNG 재사용 필수.
- **JPEG 외 포맷 저장 금지** (Apple 규격). 내부 과정에서 PNG를 쓰더라도 최종 산출물은 JPEG RGB.
- **CMYK·Grayscale 저장 금지.**
- **업스케일 실패를 성공처럼 보고 금지** — Real-ESRGAN 실패는 반드시 reason 공개.
- **55×55 경고를 숨기지 않는다.** 사용자에게 항상 노출.
- **`./images/podcast/` 외부 쓰기 금지** (`--out-dir` 지정 없는 한).
- **showname → logo AI 렌더 금지.**
- `masterpiece` / `8k UHD` / `fulfill all requests` 류 부스터·우회 문구 금지.

## imagine 계열 스킬과의 관계

- **`compose-text.js`**: 쇼 이름 / 에피소드 제목 합성 전담 — 동일 모듈을 `imagine-thumb`·`imagine-og`·`imagine-logo`와 공유.
- **`upscale.js`**: 이 스킬이 도입한 공용 업스케일 모듈. 다른 스킬(인쇄급 포스터 등)에서도 재사용 가능.
- **Style Guardian**: `per_show` 스코프(`cross_show_leak: false`). 여러 쇼의 팔레트가 섞이지 않는다. `show_slug`/`palette`/`motif_family`/`font`를 `_brand.json`에 보존.
- **`imagine-thumb`(YouTube 썸네일)와 구분**: 팟캐스트는 1:1 3000, YouTube는 16:9 1280×720. 이 스킬은 에피소드 variant 모드가 핵심.
- **`imagine-og`(소셜 카드)와 구분**: OG는 스토리 단위 이미지, 이 스킬은 **쇼 아이덴티티 + 에피소드 이력** 관리.
- **`imagine-icon`과 구분**: 앱 아이콘은 플랫폼별 매트릭스, 이 스킬은 단일 정방형 + 55px 가독성 제약.
