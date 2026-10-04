# omo-wish

`/wish`: 소원을 빕니다.

[OmO](https://github.com/code-yeongyu/oh-my-openagent) 플러그인입니다. 슬래시 명령 하나로 `wish` 스킬을 불러와, 요청한 목적 하나를 기준으로 계획, TDD, QA, 리뷰를 끝까지 진행합니다. `/wish`를 입력하면 ultrawork 모드도 켜지고, 그 위에서 wish 스킬이 이번 요청의 범위와 절차를 정합니다. 긴 프롬프트를 통째로 보내지 않고, 필요한 단계에서 필요한 지침만 읽습니다.

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

## 호환성

아래 환경에서 실제로 테스트했습니다.

| 구성 요소 | 테스트한 버전 |
| --- | --- |
| omo | 5.1.15 |
| Senpi | 2026.10.6 |
| Bun | 1.4.2 |

이건 테스트한 조합일 뿐, 최소 지원 버전이 아닙니다. 더 오래된 버전에서 동작하는지는 확인하지 않았습니다. 플러그인은 `pi.skills` 매니페스트 항목과 확장의 `before_agent_start` 이벤트를 지원하는 호스트를 전제로 합니다.

## 사용법

입력창에 `/`를 치면 목록에 **wish: 소원을 빕니다** 가 뜹니다.

```
/wish <작업 설명>
```

예:

```
/wish 로그인 리다이렉트 버그 수정
```

- 인자는 템플릿 맨 앞의 `$ARGUMENTS` 자리에 그대로 들어갑니다. 인자 안에 `$ARGUMENTS`나 `$1` 같은 글자가 있어도 다시 치환하지 않고 문자 그대로 전달합니다.
- 인자 없이 `/wish`만 입력해도 됩니다. 이때는 대화 맥락에서 원하는 결과를 파악합니다.
- `/wishful`, `/WISH` 같은 다른 명령은 wish 스킬을 부르지 않습니다. 평범한 요청에 `ulw`나 `ultrawork`를 쓰면 일반 ultrawork 모드는 켜질 수 있지만, wish 스킬이 선택되지는 않습니다. (자세한 건 아래 모드 동작을 보세요.)

## 동작 흐름

`/wish`를 실행하면 이런 순서로 진행됩니다.

```
/wish <요청>
  │
  ├─ prompts/wish.md 확장: 인자 + "Use ultrawork. Read and follow the `wish` skill"
  │
  ├─ extensions/wish.js: 확장된 문장의 ultrawork 키워드를 보고
  │   아직 꺼져 있으면 호스트 ultrawork 모드를 한 번 켬
  │
  ├─ 호스트가 등록된 스킬 목록(pi.skills)에서 wish를 찾아 경로를 제공
  │
  └─ 에이전트가 SKILL.md(핵심 규칙)를 읽고, 단계마다
      references/ 파일을 하나씩 추가로 읽음
        planning.md      → 발견, 이상 상태, 계획 (+ ulw-plan 스킬)
        execution.md     → 루프 목표, worktree, DAG, TDD (+ ulw-loop, mass-ulw 스킬)
        verification.md  → QA, PR, 최종 리뷰, REVISE, merge
```

### 1. 진입점

`prompts/wish.md`는 짧은 템플릿입니다. 맨 앞의 `$ARGUMENTS` 뒤에 ``Use ultrawork. Read and follow the `wish` skill for this request.`` 한 줄만 붙고, 작업 규칙은 하나도 담지 않습니다. 스킬 경로는 `pi.skills` 등록으로 호스트가 제공합니다.

`extensions/wish.js`는 확장된 문장에서 `ultrawork`나 `ulw`를 단어 단위로(대소문자 구분 없이) 찾습니다. 호스트 연동이 가능하고 아직 켜지지 않은 세션의 실제 호출이면 호스트의 `markArmed(sessionId)`로 활성화를 기록하고, 호스트 지시문만 `omo-ultrawork:directive` 숨은 메시지로 넘깁니다. wish 전용 지시는 덧붙이지 않습니다. 이미 켜져 있거나, 키워드가 없거나, 미리보기이거나, 호스트 연동이 없으면 아무 메시지도 보내지 않고 상태도 바꾸지 않습니다. 별도의 활성화 상태를 만들지 않고 호스트가 제공하는 세션 상태를 사용합니다.

이 키워드 처리는 일반 ultrawork 활성화일 뿐입니다. 평범한 `ulw` 요청을 wish로 보내지 않습니다. 어떤 스킬을 쓸지는 프롬프트 내용과 등록된 스킬 목록을 보고 에이전트가 고릅니다.

템플릿 자체에 "`wish` 스킬을 읽고 따르라"는 지시가 들어 있습니다. 그래서 큐에 쌓인 입력처럼 확장 훅이 건너뛰어지는 경로에서도 에이전트가 스킬을 찾아갈 수 있습니다. 이 경로는 코드를 따라가며 확인한 것이고, 실제 스트리밍 세션을 끝까지 돌려 본 라이브 테스트는 아닙니다.

### 2. 단계별 스킬 로딩

`skills/wish/SKILL.md`가 전체를 지배하는 계약입니다. 세 참조 파일은 단계마다 네이티브 스킬(`ulw-plan`, `ulw-loop`, `mass-ulw`)을 wish에 맞게 구체화하고, 해당 단계에 들어갈 때만 읽습니다. 처음부터 긴 지침을 전부 떠안지 않으니, 서로 충돌하는 정책이 한꺼번에 켜지는 일이 줄어듭니다.

| 단계 | 들어갈 때 꼭 읽는 파일 |
| --- | --- |
| 1. 발견과 계획 | `references/planning.md`, `ulw-plan` 스킬 |
| 2. 실행 (plan 게이트 통과 후) | `references/execution.md`, 목표를 만들기 전에 `ulw-loop` 스킬, DAG를 정의하기 전에 `mass-ulw` 스킬과 그 `references/planning.md` 전체, 이어서 `references/verification.md` |
| 3. 검증, PR, 리뷰 | 새로 읽을 파일 없음. 2단계에서 `references/verification.md`를 보고 정의해 둔 DAG의 마무리 노드가 프로덕션 노드 뒤에 실행됩니다 |

REVISE가 나오면 처음부터 다시 시작하지 않고 2단계로 돌아갔다가 3단계로 돌아옵니다. 읽기 규칙(이번 실행에서 직접 열 것, 없는 네이티브 스킬은 차단 사항으로 보고, 단계 첫 보고에 읽은 파일 적기)은 SKILL.md에 있습니다.

단계마다 스킬 이름을 직접 적는 데는 이유가 있습니다. omo의 키워드 스킬 포인터는 사용자가 직접 입력한 원문만 봅니다. 템플릿이나 스킬 본문에 스킬 이름이 들어 있어도 그 스킬이 자동으로 붙지 않습니다. 그래서 wish가 단계별로 읽을 스킬을 이름으로 지정합니다.

## 스킬이 정하는 것

여기는 개요입니다. 규칙의 정확한 문장은 각 항목이 가리키는 스킬 파일에만 있고, README와 다르게 읽히면 스킬 파일이 맞습니다.

### 반드시 지키는 규칙

요청 크기나 모델과 상관없이 늘 지킵니다. SKILL.md의 "Non-negotiable rules"가 원본입니다.

- 단계마다 필요한 파일을 그 단계에 들어갈 때 직접 읽고, 첫 보고에 읽은 파일을 적습니다.
- 목표는 ulw-loop SDK로만 만들고, 그 결과로 받은 handoff를 `create_goal`로 등록합니다.
- 태스크 파일을 바꾸는 일(테스트 작성, REVISE 수정 포함)은 모두 mass-ulw로 정의한 DAG 노드가 태스크의 worktree에서 합니다. 리드는 아무리 작은 수정이라도 직접 고치지 않습니다.
- mass-ulw의 `references/planning.md`를 다 읽기 전에는 DAG를 정의하지 않습니다.
- 합산 검증 전에는 PR을 열지 않고, ultrabrain 리뷰의 APPROVED 전에는 merge하지 않습니다.

### 원래 목적이 경계

요청한 목적 하나가 발견, 계획, TDD, QA, 리뷰 전부의 범위를 정합니다. 넓게 조사하는 건 영향 범위를 찾기 위해서이고, 영향받는 모든 불편을 고치라는 뜻은 아닙니다. 요청이 전달되지 않았거나, 이번 변경이 회귀를 만들었거나, 증거가 잘못됐다면 범위 안이니 같은 태스크에서 알아서 고칩니다. 나머지는 이미 있던 진짜 버그라도 고치지 않고 후속 기록으로 남깁니다.

### 후속 기록

범위 밖 발견 사항은 루프 증거 디렉터리의 `follow-ups.md` 한 파일에 내용, 재현, 증거, 영향, 제외 이유를 적습니다. 영구 메모리에는 짧은 요약, 이번 작업에서 고치지 않은 이유, 파일 경로를 색인으로 남기고, 최종 보고에도 빠짐없이 적습니다. 없으면 없다고 쓰고 빈 파일은 만들지 않습니다. 경로를 정하는 방법과 루프가 생기기 전의 처리는 SKILL.md의 "Follow-up record"에 있습니다.

### 태스크와 런

- 목적 하나가 태스크 하나입니다. merge 전 전달 단위마다 태스크 하나는 worktree 하나, PR 하나, 브랜치 하나를 씁니다. 현재와 이상 상태의 차이는 태스크가 아니라 DAG 노드가 됩니다.
- 태스크의 작업은 순차적인 런으로 진행됩니다. 런 하나는 mass-ulw `workflow` DAG 하나(mass-ulw 단계 하나)입니다. 첫 런 뒤에 앞 런이 증명한 것을 바탕으로 다듬기, REVISE 수정, merge 후 수정 런을 이어 갑니다. merge 전의 다듬기·REVISE 수정 런은 같은 worktree와 같은 PR에서 돌고, merge 후 수정은 같은 목적의 연장으로 병합된 main에서 새 worktree와 새 PR을 만들어 ultrabrain 리뷰까지 거칩니다.
- 목적이 다른 일만 별도 태스크가 됩니다. 독립 태스크는 동시에 돌고, 의존 태스크는 선행 태스크가 merge된 뒤 시작합니다.
- DAG 노드는 작게 나누고 카테고리는 크기가 아니라 난이도로 고릅니다. 카테고리는 호스트의 `task` 도구가 사용 가능하다고 나열한 것만 씁니다. 네이티브 스킬 표에 나오는 이름이라도 이 호스트에 없으면 쓰지 않습니다. 자세한 노드 설계는 `references/execution.md`에 있습니다.

### 검증, PR, 리뷰

순서는 합산 QA, PR 생성, ultrabrain 최종 리뷰입니다. 리뷰 결과는 APPROVED 또는 REVISE이고, 막을 수 있는 이유는 목표 미달, 새 회귀, 잘못된 증거 세 가지뿐입니다. 증거는 대상별로 재사용 여부를 정하고, 모든 태스크가 merge된 뒤 마지막 보고 직전에만 병합 결과에서 전체 검증을 한 번 돌립니다. 세부 절차는 `references/verification.md`에 있습니다.

### 네이티브 스킬과 다른 점

wish는 네이티브 기본값 일부를 일부러 바꿉니다. 전체 표는 SKILL.md의 "Where wish specializes a native default"에 있고, 주요한 것만 추리면 이렇습니다.

- `/wish` 자체가 승인입니다. ulw-plan의 서약, 승인 대기, 별도 실행 세션은 없고 같은 세션에서 이어 갑니다. 계획 규율과 진짜 소유자 결정(되돌릴 수 없음, 파괴적, 비용) 질문은 그대로 남습니다.
- 계획은 최소 plan 게이트 하나만 거칩니다(아래 네이티브 plan 게이트 호환성).
- 루프 목표는 wish 전체에 하나입니다. 태스크와 런은 그 안에 삽니다.
- ultrawork는 TDD를 강제하지 않지만, wish는 런타임 동작이 바뀌고 저장소가 테스트를 담을 수 있는 곳에서 행동 TDD(RED, GREEN, REFACTOR)를 일부러 유지합니다.
- ultrawork는 재리뷰를 두 번까지만 하고 사용자에게 묻지만, wish의 REVISE 라운드는 APPROVED가 나올 때까지 횟수 제한이 없습니다. 소유자가 정한 정책입니다. 라운드마다 바뀐 부분만, 매번 새 리뷰어가 봅니다.

호환되는 나머지 네이티브 규칙(증거 수집, 정리 기록, 비동기 대기, 실패를 숨기지 않기, 검증 엄격함, 잡힌 회귀와 QA 실행 방법의 메모리 기록, 대상별 증거 재사용과 마지막 전체 검증 한 번)은 그대로 적용됩니다.

## 모드 동작

- `/wish`는 ultrawork가 켜져 있다고 보고 동작합니다. 꺼져 있으면 플러그인이 확장된 문장의 `ultrawork`/`ulw` 키워드를 보고 호스트 모드를 한 번 켜고 호스트 지시문만 붙입니다. 다른 요청의 `ulw`도 일반 모드를 켤 수 있지만, 그렇다고 그 요청이 wish를 쓰게 되지는 않습니다.
- 이미 켜져 있으면 상태를 그대로 두고 지시문을 다시 붙이지 않습니다. 미리보기는 모드 상태를 바꾸지 않습니다.
- 스킬 지침은 시스템·개발자 지시, 나중에 사용자가 명시한 요청, 도구가 실제로 막는 게이트보다 우선하지 않습니다. 엔진이 강제하는 규칙이 아니라 지침의 우선순위입니다.
- 호스트의 모드 연동을 쓸 수 없거나, 입력이 `before_agent_start`를 거치지 않는 경로(예: 대기열에 쌓인 입력)로 들어오면 플러그인이 모드를 켜지 못할 수 있습니다. 그때도 켰다고 말하지 않고, wish 스킬 지침대로 계속 진행합니다.

## 네이티브 plan 게이트 호환성

`/wish`를 쓴다고 호스트의 네이티브 plan-reviewer 게이트가 자동으로 열리지는 않습니다. 그 게이트는 사용자가 ulw-plan 흐름을 명시적으로 요청했을 때처럼 호스트 조건이 맞을 때만 열립니다.

- 게이트가 정말로 열려 있으면 네이티브 plan-reviewer로 계획을 리뷰합니다.
- 닫혀 있으면 카테고리 기반 읽기 전용 리뷰어 하나로 대신 계획을 리뷰합니다.
- 게이트를 수동으로 풀거나, 거부된 호출을 반복해서 재시도하지 않습니다.

## 구조

```
omo-wish/
├── package.json                  # pi manifest: pi.prompts, pi.extensions, pi.skills
├── prompts/
│   └── wish.md                   # 슬래시 명령 템플릿 (description = 메뉴 설명)
├── extensions/
│   └── wish.js                   # ultrawork 키워드로 호스트 모드를 켜는 확장
├── skills/
│   └── wish/
│       ├── SKILL.md              # 핵심 규칙과 단계별 로딩 지점
│       └── references/
│           ├── planning.md
│           ├── execution.md
│           └── verification.md
├── test/
│   └── wish.test.js              # 동작 테스트
└── scripts/
    └── verify.mjs                # 실제 호스트 로더로 확인하는 검증 스크립트
```

`package.json`의 `pi.skills: ["skills/wish"]`로 스킬이 호스트에 등록됩니다.

## 개발과 검증

```sh
bun test
bun scripts/verify.mjs .
```

`scripts/verify.mjs`는 설치된 Senpi의 실제 로더(프롬프트 템플릿, 스킬, 확장 러너)로 패키지를 불러와 확인합니다. 테스트와 검증기의 기본 Senpi 위치는 현재 사용자 홈 아래 `.bun/install/global/node_modules/@code-yeongyu/senpi`입니다. 다른 위치에 설치했다면 `SENPI_ROOT` 환경 변수로 설치 경로를 지정하세요.

## 커스터마이징

- 메뉴 설명과 진입 템플릿은 `prompts/wish.md`에 있습니다. 템플릿 문장에서 `ultrawork`와 `wish` 스킬 안내를 빼면 모드가 켜지지 않거나 스킬이 선택되지 않을 수 있습니다.
- 작업 규칙은 `skills/wish/SKILL.md`와 `references/` 파일에서 고칩니다. README는 설명일 뿐이니 규칙을 바꾸면 여기 요약도 맞춰 주세요.
