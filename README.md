# omo-wish

`/wish` — 소원을 빕니다.

[OmO](https://github.com/code-yeongyu/oh-my-openagent) 플러그인. 매일 쓰는 ultrawork + ulw loop + mass ulw 오케스트레이션 프롬프트를 슬래시 명령 한 번으로 실행합니다.

## 설치

```sh
omo install https://github.com/DevNewbie1826/omo-wish
```

프로젝트에만 설치하려면 `-l`을 붙이세요:

```sh
omo install -l https://github.com/DevNewbie1826/omo-wish
```

로컬 개발용(복사 없이 현재 폴더를 직접 로드):

```sh
omo install /path/to/omo-wish
```

제거:

```sh
omo remove https://github.com/DevNewbie1826/omo-wish
```

설치 후 새 세션(또는 `/reload`)부터 반영됩니다.

## 요구 사항

이 프롬프트는 **omo v5.0.0-beta.40 이상 (senpi 2026.9.4+)** 에 맞춰져 있습니다. 독립 태스크와 독립 DAG 노드의 병렬 디스패치는 wish.md가 명시하며, 저수준 툴·eval 실행 메커니즘만 시스템 제공 정책에 위임하므로 eval 툴 설명에 실행 가이드가 내장된 엔진이 필요합니다. JS eval 커널은 Bun 1.4 이상 런타임에서 동작합니다.

## 사용법

입력창에 `/`를 치면 목록에 **wish — 소원을 빕니다** 가 뜹니다.

```
/wish <작업 설명>
```

예:

```
/wish 로그인 리다이렉트 버그 수정
```

`$ARGUMENTS` 자리에 인자가 치환되어 프롬프트 전문이 전송됩니다. 인자는 본문 맨 앞에 사용자의 답으로 붙습니다. 인자 없이 `/wish`만 입력해도 됩니다 — 본문의 explore가 대화 맥락을 읽습니다. 위치 인자(`$1`), 기본값(`${1:-기본값}`) 등 bash 스타일 치환도 템플릿에서 쓸 수 있습니다.

## 프롬프트가 하는 일

1. **ultrawork explore** — 작업의 전체 맥락과 히스토리를 증거 기반으로 분석하고, 지금과 앞으로 사용자가 제품을 어떻게 쓰는지 상상한다. 마찰이 없고 무언가 잘못되었다고 느껴지지 않으며 회귀나 경험 저하가 없는 이상 상태를 하나의 최상위 목표로 정의한다
2. **갭 목록과 QA 시나리오** — 이상 상태와 현재 상태 사이의 모든 갭을 나열하고, 구현에 들어가기 전에 각 갭과 사용자가 막힐 수 있는 모든 지점에서 이상 상태에 도달했음을 증명하는 사용자 대면 QA 시나리오를 정의한다. 이 목표, 갭 목록, QA 시나리오, 실행 원칙은 작업이 끝날 때까지 계속 지배 기준으로 남는다. 끝내기 위해 범위를 좁히거나 기준·시나리오를 약하게 만들지 않는다. 작업 중 발견한 갭은 대응하는 QA 시나리오와 함께 같은 방식으로 묶어 목록에 추가한다
3. **단일 ulw loop와 태스크 분해** — 이 최상위 목표 하나에 대해 단일 ulw loop를 돌리고, 태스크는 별도의 목표가 아니라 실행 단위다. 갭은 안전하게 나눌 수 없을 때만 한 태스크에 묶고, 아니면 별도 태스크로 나눈다. 각 태스크는 하나의 worktree와 하나의 PR, 자체 DAG를 갖는다. 태스크는 서로의 정확성에 영향을 주지 않을 때 독립이며, 독립성이 불명확하면 한 태스크에 둔다. 병렬화는 두 수준에서 한다: 독립 태스크의 DAG는 순차가 아니라 동시에 돌리고, 각 DAG 안의 독립 노드도 병렬로 돌린다. 의존 태스크는 선행 태스크가 merge된 뒤에 시작한다
4. **DAG 실행** — 각 태스크는 전용 git worktree에서 작업과 실제 의존 관계를 감싼 mass ulw DAG로 실행하고, 그 DAG를 태스크의 QA 시나리오를 포함한 합산 검증 -> PR 생성 -> ultrabrain 검토 순서로 끝낸다. 모든 DAG(REVISE DAG 포함)에서 정확성이 허락하는 한 작업을 독립 노드로 쪼개고, 독립 노드는 쓰기 범위가 겹치지 않게 병렬, 의존 노드는 순서대로 돌린다. 최종 ultrabrain 검토는 verdict APPROVED 또는 REVISE로 끝나고, REVISE면 필수 변경 사항을 목록으로 붙인다
5. **REVISE 루프** — REVISE면 같은 worktree에서 필수 변경 사항으로 다음 mass ulw DAG를 만들고, 독립 수정은 병렬로 돌린 뒤 태스크의 QA 시나리오를 포함한 합산 결과를 검증하고, 마지막 노드에서 ultrabrain이 재검토한다. APPROVED가 나올 때까지 반복하고, APPROVED 전에는 merge하지 않는다
6. **merge·통합 검증·종료** — APPROVED된 태스크는 관련 없는 태스크를 기다리지 않고 한 번에 하나씩 merge한다. 다른 변경과의 통합이 태스크 동작에 영향을 주면 영향받는 동작만 검증하고, 아직 유효한 검증 결과는 재사용한다. 승인된 구현이 실질적으로 바뀌면 merge 전에 ultrabrain 재검토를 받는다. 모든 태스크가 merge되면 merge된 결과에서 모든 QA 시나리오가 통과하는지 확인한다. 유효한 결과는 재사용하고 merge가 영향을 준 시나리오만 다시 돌린다. 시나리오가 실패하면 그 원인을 새 태스크로 만들어 같은 흐름으로 처리한다. 최상위 목표가 완전히 충족되면 이 작업에 쓴 태스크 worktree와 merge된 태스크 브랜치를 제거한 뒤 ulw loop를 끝낸다

## 구조

```
omo-wish/
├── package.json                    # pi manifest: pi.prompts + pi.extensions 선언
├── extensions/
│   └── wish-ultrawork-arm.js       # 확장 본문의 트리거로 ultrawork arm
└── prompts/
    └── wish.md                     # 슬래시 명령 템플릿 (description = 메뉴 설명)
```

`pi.prompts`에 디렉터리를 선언하면 OmO가 템플릿을 슬래시 메뉴에 등록합니다. `pi.extensions`에 `extensions/wish-ultrawork-arm.js`를 선언하면 `/wish` 확장 본문의 트리거 단어로 ultrawork 모드를 arm합니다.

## 커스터마이징

`prompts/wish.md`를 고치면 됩니다 — `description`(메뉴에 뜨는 설명), `argument-hint`, 본문 전체가 다 템플릿 하나로 정의됩니다.

## 노트: 트리거 단어와 훅

이 템플릿 본문은 `ultrawork`, `mass ulw`, `ulw loop`를 명시적으로 지목합니다. OmO는 ultrawork 모드를 `input` 훅에서 arm하는데, senpi는 슬래시 프롬프트 템플릿 확장 **이전**에 이 훅을 쏘므로 `/wish ...`의 원시 라인만 보이고 wish.md 본문의 트리거 단어는 보지 못합니다. `extensions/wish-ultrawork-arm.js`가 `before_agent_start`를 듣습니다 — 이 이벤트의 `event.prompt`는 확장 **이후** 텍스트입니다. `ultrawork`/`ulw`가 있으면 OmO가 `globalThis[Symbol.for("omo.ultrawork.arming")]`에 공개한 상태로 세션을 arm하고, OmO 자신의 ultrawork 지시문을 hidden 메시지로 주입합니다. 이미 arm된 세션, 트리거 단어가 없는 프롬프트, OmO가 로드되지 않은 경우에는 아무것도 하지 않습니다. 그때는 예전처럼 모델이 본문을 읽고 스킬을 시맨틱 라우팅합니다.
