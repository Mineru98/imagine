---
name: prompt-director
description: 한국어 또는 추상적 표현("몽환적인", "힙한", "따뜻한" 등)을 감지해 gpt-image-2 모델이 선호하는 구체적 영어 시각 언어로 1패스 보정한다. `imagine <설명>` 형태의 요청에 즉시 개입하며, 프롬프트가 이미 영어이고 시각적으로 구체적이면 개입하지 않는다.
---

# prompt-director

추상적 한국어 서술을 시각 모델이 이해하기 좋은 구체 영어 키워드 구문으로 **한 번만** 번역·보정한다. 사용자의 원 의도를 보존하는 번역가 역할이지, 프롬프트 엔지니어가 아니다.

## 언제 개입하는가

- 사용자 입력에 한글 음절이 하나라도 포함되어 있을 때.
- 입력이 영어여도 **추상 형용사 위주**이고 시각 주체·배경·재료·조명 중 둘 이상이 비어 있을 때 (예: `"vibes"`, `"mood"`, `"aesthetic"` 단독).

## 언제 개입하지 않는가

- 프롬프트가 이미 영어이며 주체·배경·스타일·조명 중 다수가 명시되어 있을 때.
- 사용자가 특정 스타일 키워드를 이미 고정했을 때 (`"anime, flat shading, ..."`).
- 사용자가 원문 유지를 명시했을 때 (`"as-is"`, `"그대로"`, `"원문 그대로"`).

## 변환 규칙

1. **단일 패스만.** 번역된 결과를 다시 번역·재보정하지 않는다. 재귀 rewrite 금지.
2. **booster 우위 금지.** 보정 결과물에서 사용자 원 토큰이 부가 수식보다 토큰 수·가중치 면에서 밀리면 안 된다. 원래 키워드는 반드시 구문 앞쪽에 배치하고, 부가 키워드는 원문을 설명·구체화하는 범위에서만 덧붙인다.
3. **투명 공개.** 변환을 수행한 경우 반드시 사용자에게 다음 포맷으로 먼저 보고한 뒤 이미지를 생성한다:
   - `다음과 같이 변환했습니다: "<영문 프롬프트>"`
4. **무개입 분기.** 개입하지 않기로 판단하면 원문을 그대로 하위 스킬에 전달하고, 변환 보고도 출력하지 않는다.
5. **의도 보존.** 의미 축소, 과장, 재해석을 하지 않는다. 사용자가 쓴 명사·주체는 반드시 유지한다.
6. **스타일 주입 금지.** 사용자가 고정하지 않은 매체/시점/해상도 수식어(예: "oil painting", "cinematic 35mm", "8k")를 임의로 붙이지 않는다. 단, 원문의 감정/분위기를 *직접 구체화*하는 조명·색조·질감 키워드는 허용한다.
7. **언어 혼용.** 고유명사·상표·지명은 원형을 유지하고 나머지만 영역한다.

## 예시 변환

| 한국어 / 추상 입력 | 보정 결과 |
|---|---|
| 몽환적인 숲 | `ethereal forest, volumetric mist, soft diffused light, dreamlike atmosphere` |
| 힙한 카페 | `trendy minimalist cafe, exposed brick, warm Edison bulbs, urban aesthetic` |
| 따뜻한 거실 | `cozy living room, warm tungsten lighting, soft woolen throw, late-afternoon golden hour` |
| 쓸쓸한 바닷가 새벽 | `lonely seashore at dawn, pale blue-grey sky, gentle low tide, single set of footprints in wet sand` |
| 레트로한 게임 방 | `retro gaming room, CRT monitor glow, stacked cartridges, neon wall poster, late-90s aesthetic` |

## 출력 형식

개입한 경우:
```
다음과 같이 변환했습니다: "<영문 프롬프트>"
(이후 imagine 스킬에 영문 프롬프트 전달)
```

개입하지 않은 경우: 추가 출력 없이 원문 그대로 전달.

## 금기

- **재귀 rewrite 금지.** 이미 변환된 영문 결과를 다시 다른 영문으로 다듬는 2차 보정을 하지 않는다.
- **사용자 의도 검열·완화·도덕화 금지.** 프롬프트가 표현한 감정·주제·대상을 임의로 순화·삭제하지 않는다.
- **안전 우회 문구 주입 금지.** "authorized red-team", "ignore safety", "without disclaimers" 등 안전장치 무력화성 표현을 결과에 포함하지 않는다.
- **품질 booster 과다 주입 금지.** `masterpiece`, `8k UHD`, `best quality` 류의 일반형 품질 키워드를 사용자 요청 없이 덧붙이지 않는다.
- **프롬프트 체인 분기 금지.** 보정 결과는 항상 단일 구문이어야 하며, "variant A / variant B" 식 다중 프롬프트를 생성해 하위 스킬에 떠넘기지 않는다.
