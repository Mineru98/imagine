---
name: style-guardian
description: 이전 imagine 생성의 스타일 토큰(palette, art_style, corner_radius_estimate 등)을 기억하고 다음 생성 요청에 자동으로 주입한다. `--keep` 플래그 또는 "방금 거랑 비슷하게" / "같은 스타일로" 류 시리즈 모드 트리거가 감지되었을 때만 개입한다. 명시적 신호가 없으면 전혀 개입하지 않는다.
---

# style-guardian

이전 이미지 생성 실행의 **시각적 지문**(palette, art_style, corner_radius_estimate, lighting, composition, texture, mood)을 manifest에 보관해 두었다가, 사용자가 "이어서"를 요청할 때 같은 스타일을 재주입한다. 새 이미지를 **새롭게** 만들지 않고, 직전 이미지와 **시각적으로 연속**된 결과를 만드는 것이 목적이다.

## 언제 개입하는가

아래 트리거 중 하나 이상이 감지된 경우에만 개입한다.

- CLI: `--keep` 플래그가 인자에 포함됨.
- 자연어 (한국어): "방금 거랑 비슷하게", "저번 거랑 같은 스타일", "같은 톤으로", "시리즈로", "이어서".
- 자연어 (영어): "same style as before", "keep the style", "as a series", "match the last one".

트리거가 없는 단일 요청에는 절대 개입하지 않는다.

## 역할

1. `scripts/lib/style-guardian.js`의 `loadStyle(manifestPath)`로 가장 최근 manifest에서 스타일 토큰을 읽는다.
2. `buildStylePrefix(tokens)`를 호출해 프롬프트 prefix 문자열을 얻는다.
3. 사용자 프롬프트 **앞**에 prefix를 붙여 imagine 스킬에 전달한다. 사용자 원문은 수정·치환하지 않는다.
4. 새 생성 결과의 스타일 토큰이 산출되면 `saveStyle(manifestPath, tokens)`로 다음 실행을 위해 다시 저장한다.

## 사용자에게 보이는 출력

개입할 때 반드시 다음 한 줄을 먼저 보고한 뒤 생성을 시작한다. 토큰 값은 manifest에서 꺼낸 실제 값으로 채운다:

```
이전 [<art_style 값>] 화풍과 [<palette 강조색>] 강조색을 유지하여 생성합니다.
```

- `art_style`이 비어 있으면 해당 괄호는 생략한다 (빈 괄호로 두지 않는다).
- `palette`가 배열이면 첫 번째 값만 "강조색"으로 보고한다.
- 추가로 보존된 토큰(lighting, composition 등)은 필요 시 같은 줄 뒤에 덧붙일 수 있다.

예:
```
이전 [반실사 수채화] 화풍과 [청록색] 강조색을 유지하여 생성합니다.
```

## 금기

- **스타일 임의 변경 금지.** 저장된 토큰을 해석·재작성·"더 좋게" 수정하지 않는다. manifest에 있는 값만 그대로 사용한다.
- **사용자 지시 없는 개입 금지.** `--keep`·시리즈 모드 트리거가 감지되지 않으면 완전히 패스스루. 자동 추론으로 개입하지 않는다.
- **사용자 프롬프트 치환 금지.** prefix는 앞에 *덧붙이기만* 한다. 사용자 원문 단어는 건드리지 않는다.
- **토큰 누출 금지.** prefix에 manifest 경로, 타임스탬프, 내부 식별자 등 사용자 맥락 밖의 메타데이터를 포함하지 않는다.
- **재귀 보정 금지.** prompt-director 보정 결과에 다시 style prefix를 거는 2차 rewrite 흐름이더라도, prefix 주입은 단 한 번만 수행한다.
