# omo-wish

`/wish`: 소원을 빕니다.

[OmO](https://github.com/code-yeongyu/oh-my-openagent) 플러그인입니다. 슬래시 명령 하나로 `wish` 스킬을 불러와, 승인된 요청 하나를 계획 → 빌드 → 검증 물결 → 동결된 PR → 리뷰(APPROVED까지) → 병합 → 정리까지 끝냅니다.

wish v2는 omo **위에서** 돕니다. 모든 단계는 omo의 기능이 실행합니다 — 카테고리(`architect`, `ultrabrain`, `quick`, `deep-high`), 네이티브 에이전트(`explore`, `librarian`, `omo-native-qa-executor`, `omo-native-code-reviewer`, `omo-native-gate-reviewer`), `mass-ulw`(빌드·수정·렌즈), `ulw-loop`(goal·evidence·checkpoint), `monitor`. 스킬의 스크립트는 그 역할들이 호출하는 보조 명령이며, omo의 역할을 대신하거나 대체하지 않습니다.

속도의 원천은 리뷰 축소가 아니라 앞당김입니다. 같은 리뷰, 같은 레인, 같은 차단 정의를 유지한 채 테스트·탐침·QA·코드 리뷰를 ultrabrain 앞에서 같은 head에 모읍니다. 리뷰 품질은 하한이지 변수가 아닙니다.

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

wish v2의 테스트와 로더 검증을 실제로 돌린 환경입니다.

| 구성 요소 | 테스트한 버전 |
| --- | --- |
| omo | 5.1.48 |
| Senpi | 2026.10.25-2 |
| Bun | 1.4.3 |

이건 테스트한 조합일 뿐, 최소 지원 버전이 아닙니다. 플러그인은 `pi.skills` 매니페스트 항목과 확장의 `before_agent_start` 이벤트를 지원하는 호스트를 전제로 합니다.

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
- 세션이 죽거나 컨텍스트가 압축된 뒤에는 `/wish --resume <run_id>`로 같은 run을 이어갑니다. 재개 절차는 `playbooks/resume.md`가 맡고, 상태(장부·영수증·계획 front matter)가 기억보다 우선합니다.
- `/wishful`, `/WISH` 같은 다른 명령은 wish 스킬을 부르지 않습니다. 평범한 요청에 `ulw`나 `ultrawork`를 쓰면 일반 ultrawork 모드는 켜질 수 있지만, wish 스킬이 선택되지는 않습니다.

## 동작 흐름

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
  └─ SKILL.md: 계약 + 단계 지도(이 파일이 권위)
      ├─ 작업 유형 플레이북(playbooks/<type>.md): todo에 복사되는 실행 단계
      └─ references/: 계획 문법, 유한 계약, 장부 스키마, 위임 프롬프트, 결함 부류, 측정
```

`/wish`는 초안 단계에서 goal이나 notepad를 만들지 않습니다. 계획 파일이 메모를 쥐고, GOAL 단계가 ulw-loop로 goal을 하나 등록합니다. 승인된 요청이 계획·빌드·PR·리뷰·병합·정리를 이미 덮으므로 단계 재승인을 묻지 않습니다. 질문은 오너 결정(되돌릴 수 없음·파괴·지출·계약 수준의 LIMIT)일 때만 `gates.md`에 주차하고 질문 도구로 묻습니다.

## 단계

`wish status`가 다음 단계와 그것을 막는 영수증을 알려줍니다. 플레이북은 "status가 허용할 때만 디스패치"로 읽습니다. `<ER>`은 ulw-loop가 알려준 evidence root이며 저장소 **밖**에 있습니다.

| 단계 | 실행하는 omo 기능 | `status`가 요구하는 영수증 |
| --- | --- | --- |
| `intake` | ultrawork 티어 판정 + `todo`(플레이북 단계 복사) | `wish init`이 만든 `intake` 이벤트(계획 생성 포함) |
| `lens` | `mass-ulw` run `wish-<run>-lens`: harvest → extract → reduce | `lens` 이벤트 + `<ER>/lens.md` (없으면 `skip: no corpus`) |
| `discover` | `explore` 2–4 읽기 전용 레인 ∥ `librarian` | `discover` 이벤트 + `receipts/discover-<lane>.md` |
| `ideal` | 세션(visual-qa 체크리스트·frontend 규칙에서 씨앗) | `ideal` 이벤트 + `<ER>/ideal.md` |
| `gap` | 세션(슬롭 보고 전용 레인·초안 가드 린트 병합) | `gap` 이벤트 + `<ER>/gaps.tsv` |
| `before` | 세션(캡처는 읽기 전용 레인이 실행 가능) | `before` 이벤트 + 첫 편집 전 `before-<gap>-<tree7>` |
| `plan` | 세션(ulw-plan 체크박스 문법) | `plan` 이벤트(계획) |
| `plan_lint` | `scripts/check-plan.mjs` (세션 또는 `quick` 노드) | `plan_lint` 이벤트, exit 0 |
| `plan_review` | `category: architect` 1회 (계획 게이트가 열렸으면 `plan-reviewer`) | `plan_review-architect-<head7>.md` (`OKAY` 또는 blocker+fix) |
| `goal` | `ulw-loop` goals + ulw-execute Boulder(형식만) | `goal` 이벤트(goal id) |
| `build` | `mass-ulw` run `wish-<run>-build` (커밋 노드는 `git-master` 로드) | `build` 이벤트 + `build-<node>.json` |
| `verify_lane` | head당 `task` 배치 1회: `quick` 테스트+변이·탐침, `omo-native-qa-executor`, `omo-native-code-reviewer`(+`remove-ai-slops`, `programming`), `deep-high` 적대 | `verify_lane-<lane>-<head7>.json` (유형별 필수 레인마다) |
| `triage` | 세션(bugbot 삼분법: fix / dismiss / owner) | `triage` 이벤트 + `findings.tsv` 행 |
| `fix` | `mass-ulw` run `wish-<run>-fix-r<n>` + `reuse-check.mjs` | `fix` + `reuse` 이벤트 |
| `freeze` | `wish freeze`, `wish pr-body` | `freeze` 이벤트(`head`, `tree`, `pr`) |
| `pr_open` | `gh pr create` + `tool.monitor`(=`pr-watch.mjs`) | `pr_open` 이벤트 |
| `round` | `wish gate` → `category: ultrabrain`(r1 전체, r2+ 델타+회귀) → `check-verdict.mjs` | `final-r<n>-<head7>.md` + `round`, `verdict` 이벤트 |
| `switch` | `architect` 전제 리뷰, `deep-high` 계열 전환, `SWITCH:` 계획 행, 재발견 | `switch` 이벤트(`round`, `kind`, `premise`, `new_approach`) |
| `merge` | 세션(작업한 세션이 병합): `wish pr-body` → `gh pr edit` → `wish merge-ready --body $ER/pr-body.md` exit 0 — 병합 ACK·질문·병합은 그 뒤에만 | `merge` 이벤트(`sha`, `merged_at`, `pr`) |
| `post_merge` | `omo-native-qa-executor`: tree 동일이면 smoke, 다르면 전체 | `post_merge` 이벤트 + `post_merge-<tree7>.*` |
| `checkpoint` | `ulw-loop` `checkpoint` + `omo-native-gate-reviewer` | `checkpoint` 이벤트(`checkpoint_op: complete`) |
| `cleanup` | 세션: `metrics export`, `memory` 기록 | `cleanup` 이벤트 + 정리 영수증 |

`lens`, `ideal`, `gap`, `before`, `fix`, `switch`는 조건부입니다. 해당이 없으면 todo에 `skip: <이유>`를 남기고 조용히 빼지 않습니다. 단위가 도는 동안 `wish status --progress`가 숫자가 바뀌는 전이마다, 그리고 진행 중 최소 30분마다 한 줄을 찍습니다. 같은 숫자의 반복은 출력하지 않습니다.

```
PROGRESS: run <id> · units <done>/<total> · gaps <fixed>/<total defect> · prs <merged> merged <open> open · wave <k>/<n> · round r<round> on <#pr|none> · switch <count> · waiting <what|none>
```

## 티어

티어는 omo의 LIGHT/HEAVY 사실로 정하고, 내려가지 않습니다(HEAVY 사실이 드러나면 즉시 올림).

| 티어 | 기준 | 달라지는 것 (리뷰 깊이는 그대로) |
| --- | --- | --- |
| **S** | 발견 추정 ≤2파일·≤150줄, HEAVY 사실 없음 | explore 1레인, 짧은 계획, PLAN-REVIEW를 BUILD와 함께 시작(차단 시 `amend`), 변이는 guard 행당 최대 1 |
| **M** | S 초과, HEAVY 사실 ≤1, 컴포넌트 ≤3 | 기본 직렬, 검증 물결 전체 |
| **L** | HEAVY 사실 ≥2, 컴포넌트 ≥4, 또는 요청자가 철저함을 요구 | M + `adversarial` 레인(고위험 행 없이도), 상태·수명 전이 표의 QA 실행, 변이 상한 |

## 작업 유형

| 유형 | 플레이북 | `status`가 요구하는 레인 |
| --- | --- | --- |
| `code` | `playbooks/code.md` (patch·feature·refactor) | `tests`, `qa`, `sweep`, `code-review`, 필요 시 `adversarial` |
| `design` | `playbooks/design.md` | `draft-guard`, `capture`, `vqa-passA`, `vqa-passB`, `code-review`, `qa` |
| `research` | `playbooks/research.md` | `fact-verify`, `claim-gate`, `skeptic`, `execution-verify`, `delivery-gate` |
| `audit` | `playbooks/audit.md` | `lint`, `spot`, `register-schema` |
| `mixed` | 주 유형의 플레이북 | 주·부 유형 레인의 합집합; `wish init`과 `sweep.mjs`에 `--type mixed --primary … --secondary …` |

설계는 `frontend`가 빌드하고 `visual-qa`가 검증하며, 연구는 `ulw-research`가 단계를 돌립니다. wish는 그 출력을 영수증으로 받아 계약·판정·장부·진행률을 붙일 뿐 그 스킬들을 다시 구현하지 않습니다.

요청 하나가 PR 여러 개를 낳아야 하면 `playbooks/program.md`가 단위(unit)와 파동(wave)을 얹습니다. 단위는 PR 하나이고, 파동은 쓰기 범위가 겹치지 않는 단위의 묶음입니다. 한 단위의 REVISE가 다른 단위의 병합을 막지 않습니다.

## 회차 규칙 — 상한은 전환 신호, 리뷰는 APPROVED까지

리뷰에는 회차 상한이 없습니다. **`APPROVED`만이 끝입니다.**

1. 같은 컴포넌트 **또는** 같은 결함 부류가 2회 연속 REVISE면 땜질을 멈추고, 실패한 수정들이 공유한 전제를 한 문장으로 적어 `architect` 전제 리뷰 1회를 받습니다.
2. **3회차 이후**의 REVISE 회차는 접근 전환을 강제하고, 그 뒤 매 REVISE마다 아직 쓰지 않은 종류를 하나씩 더 씁니다: `premise`(전제 리뷰), `family`(실패한 수정과 다른 모델 계열), `strategy`(`SWITCH:` 행으로 컴포넌트 재설계), `split`(프로그램 모드 전용), `rediscover`(렌즈로 재발견 + 변형 스윕).
3. 전환 뒤에는 수정 run → `reuse-check` → 무효 레인만 재실행 → `freeze` → 게이트 표 → **새** ultrabrain 리뷰어의 델타+직전 결함 회귀로 이어집니다. 회차 수에 상한이 없습니다.
4. 오너에게 "리뷰를 그만할까요"를 묻지 않습니다. 그건 오너 결정이 아닙니다. 오너 결정은 되돌릴 수 없는 변경·파괴·지출, 또는 계약 수준의 LIMIT 수락뿐이고, 게이트가 열려 있는 동안 다른 단위는 계속 돕니다.

`APPROVED` 뒤에 저자나 오너가 결함을 찾으면 그 회차를 `reopen`(회차, 사유, 새 head)으로 장부에 다시 열고, 다시 연 회차는 다른 회차와 같은 레인·게이트·새 리뷰어를 겁니다. 리뷰는 여전히 `APPROVED`에서만 끝나고, 바뀌는 것은 심사 대상 head입니다.

## 유한 계약 — 무엇이 차단 사유인가

계획의 `IS`·`COMPANION` 행이 요청이고, `INVARIANT`는 계속 지켜야 할 것, `LIMIT`은 알면서 처리하지 않는 것입니다.

차단 사유는 둘뿐입니다: **행이 전달되지 않았거나, 목록의 불변식 위반이 실패하는 테스트(또는 `no-test` 행의 실패하는 QA 시나리오)로 드러났을 때.** 나머지는 전부 메모나 후속 기록입니다. `WARN` 영수증은 차단하지 않고, `FAIL` 영수증은 세션이 먼저 재현해 보는 주장입니다. 계획에 적힌 알려진 한계는 발견이 아닙니다. 프로그램에서 단위의 계약은 그 단위의 `IS` 행뿐입니다.

모든 리뷰어 프롬프트는 `references/contract.md` §5의 문장을 원문 그대로 답니다. 증거의 오타·숫자 오류·문구 문제는 REVISE 사유가 아니라 수정 메모입니다.

## 증거와 상태

증거는 저장소 **밖**(`<ER>`)에 살고, 리뷰된 head를 움직이지 않습니다. 동결 뒤에는 아무것도 커밋하지 않습니다. 메모는 `<ER>`로 갑니다.

| 파일 | 내용 |
| --- | --- |
| `.omo/plans/wish-<slug>.md` | 계획: ulw-plan 체크박스 문법 + `IS`/`COMPANION`/`INVARIANT`/`LIMIT`/`DEVICE` 행 + front matter |
| `<ER>/ledger.jsonl` | 단계·레인·head·tree·판정·라운드 이벤트 |
| `<ER>/receipts/` | 레인별 영수증 `<stage>-<lane>-<head7>.json` (상태 `PASS`/`FAIL`/`WARN`/`SKIP`) |
| `<ER>/findings.tsv` | 리뷰·QA·탐침·ultrabrain 발견과 수정 상태 |
| `<ER>/gaps.tsv` | 전수 등록부(규칙 × 표면 판정, `kind: defect|taste`) |
| `<ER>/gates.md` | 오너 질문(선택지·기본값·답) |
| `<ER>/resume.md` | 재개 지점 |

쓰기 주체는 고정입니다: 세션만 계획·장부·findings·gaps·lens·ideal·gates·resume을 쓰고, 레인은 자기 영수증만 쓰며, 스크립트는 아무것도 저술하지 않습니다. 영수증은 `tree`가 맞는 동안 유효하고(연구 단위는 64자 sha256이 `head`이고 `tree`는 `null`), 판정은 `patch_id`가 맞는 동안 유효합니다. 끝난 실행(`stage: done`)의 영수증은 이력으로 읽습니다 — 다시 돌 레인이 없으므로 STALE로 보고하지 않고, 병합이 옮긴 체크아웃도 그 실행의 장애물이 아닙니다. `before` 캡처는 일부러 옛 것이므로 재사용 검사에서 제외됩니다.

## 스크립트

전부 에이전트가 호출하는 보조 명령입니다. 어느 것도 단계를 결정하거나 리뷰를 디스패치하지 않습니다. 종료 코드는 공통으로 **0** 정상, **1** 검사 실패, **2** 사용법 오류, **3** 상태 불일치입니다.

| 스크립트 | 역할 |
| --- | --- |
| `scripts/wish.mjs` | 상태·CLI: `init`, `status [--json\|--progress]`, `ledger append`, `findings add\|set`, `gaps add\|set\|list`, `gate`(재현 표·`add`·`resolve`), `freeze [--check]`, `pr-body`, `merge-ready`, `reuse-check`, `switch record`, `metrics export\|post-merge`, `resume-plan` |
| `scripts/check-plan.mjs` | 계획 린트: IS↔QA 짝, `DEVICE:` 행, guard/no-test 행, `HIGH-RISK`, front matter, `--register`일 때 gap 인용 |
| `scripts/sweep.mjs` + `scripts/probes/*.mjs` | 결함 부류 탐침 러너: 비밀값 카나리, 경계 입력, 레이스·수명, 오류 체인, 변이, 문서-도움말, 설정, 초안 가드. 레인 영수증을 쓰고, 프로브는 단독 실행도 됩니다 |
| `scripts/check-verdict.mjs` | 판정 줄 파서: 마지막 비어 있지 않은 줄이 `VERDICT: <APPROVED\|REVISE> round <n> head <sha>`이고 head를 덮는지, `--require-approved` |
| `scripts/patch-id.mjs` | `git patch-id --verbatim` 비교와 interdiff — 판정이 패치를 덮는지 |
| `scripts/reuse-check.mjs` | 영수증 유효성: tree 동일이면 `VALID`, 다르면 변경 파일·참조자 ∩ scope로 `STALE` 판정 |
| `scripts/pr-watch.mjs` | PR 상태기계 NDJSON(`READY`/`WAITING`/`BLOCKED`/`MERGED`/`CLOSED`) — `tool.monitor`가 구독 |
| `scripts/metrics.mjs` | `measurements.csv`·`rounds.csv` 행 생성·검증, 병합 뒤 재수정 검출 |
| `scripts/lib/schema.mjs`, `scripts/lib/store.mjs` | 스키마 검증, 원자적 쓰기, pid 잠금, ledger 재생(내부 모듈) |

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
│       ├── SKILL.md              # 계약 + 단계 지도 + 회차 규칙
│       ├── playbooks/            # code, design, research, audit, program, lens, revise, resume
│       ├── references/           # contract, plan-format, ledger, prompts, defect-classes, metrics
│       └── scripts/              # wish, check-plan, sweep(+probes), check-verdict, patch-id,
│                                 # reuse-check, pr-watch, metrics, lib/
├── test/                         # 로더·CLI·린트·탐침·판정·재사용·감시·측정 테스트
├── scripts/
│   └── verify.mjs                # 실제 로더 + 스크립트 --help 스모크
└── docs/
    └── experiments/              # 실험 장부, 기준선, measurements/rounds CSV
```

`package.json`의 `pi.skills: ["skills/wish"]`로 스킬이 호스트에 등록됩니다.

## 개발과 검증

```sh
bun test
bun scripts/verify.mjs .
```

`scripts/verify.mjs`는 설치된 Senpi의 실제 로더(프롬프트 템플릿, 스킬, 확장 러너)로 패키지를 불러와 다음을 확인합니다.

- 매니페스트가 가리키는 스킬 파일이 존재하고, 로더가 `wish` 스킬을 `skills/wish/SKILL.md`로 찾으며, 로더가 찾은 모든 스킬 파일이 디스크에 있습니다. 하나라도 없으면 실패합니다.
- 확장의 `before_agent_start` 동작: 미리보기 안전, 단어 단위 키워드, 한 번만 무장, 이미 무장된 세션·호스트 연동 없음에서 무동작.
- `skills/wish/scripts` 아래 **모든** 스크립트가 `--help`로 exit 0을 내는지. `scripts/` 바로 아래의 공개 도구는 사용법 줄까지 출력해야 합니다.

테스트와 검증기의 기본 Senpi 위치는 현재 사용자 홈 아래 `.bun/install/global/node_modules/@code-yeongyu/senpi`입니다. 다른 위치에 설치했다면 `SENPI_ROOT` 환경 변수로 설치 경로를 지정하세요.

## 실험

시간 목표와 품질 가드는 `docs/experiments/ledger.md`와 `skills/wish/references/metrics.md`가 권위입니다. 기준선은 병합 104건(2026-10-27)이고, 열림→병합 중앙 92.8분, 최종 리뷰 REVISE≥1 40.4%입니다.

v2 행은 처치 20 PR(10 PR 중간은 진단만)과 같은 창의 v1 교대 대조 ≥10 PR로 판정합니다. 계속 조건은 열림→병합 중앙 ≤55분 **그리고** REVISE≥1 ≤25% **그리고** 품질 가드 1–5 통과, 취소 조건은 중앙 ≥92.8분 **또는** REVISE≥1 ≥40% **또는** 가드 위반입니다. 사이값은 10 PR 연장 1회 뒤 같은 규칙으로 판정합니다. 파일럿은 genie의 신선 PR에 v1과 v2를 교대 배정하고, 규모로 층화해 각 팔 S 5건·M 5건을 같은 창에서 돌립니다. 프로그램 모드의 첫 실행은 대조군이 없어 진단만 합니다.

행은 장부에서 만들고 검사합니다.

```sh
bun skills/wish/scripts/metrics.mjs export --ledger "$ER/ledger.jsonl" --findings "$ER/findings.tsv" --gaps "$ER/gaps.tsv" --out "$ER/metrics"
bun skills/wish/scripts/metrics.mjs validate --dir "$ER/metrics"
```

## 커스터마이징

- 메뉴 설명과 진입 템플릿은 `prompts/wish.md`에 있습니다. 템플릿 문장에서 `ultrawork`와 `wish` 스킬 안내를 빼면 모드가 켜지지 않거나 스킬이 선택되지 않을 수 있습니다.
- 작업 규칙은 `skills/wish/SKILL.md`, 작업 유형별 `playbooks/`, 기계 형식은 `references/`에서 고칩니다. README는 설명일 뿐이니 규칙을 바꾸면 여기 요약도 맞춰 주세요. README와 스킬 파일이 다르게 읽히면 스킬 파일이 맞습니다.

## 모드 동작

- `/wish`는 ultrawork가 켜져 있다고 보고 동작합니다. 꺼져 있으면 플러그인이 확장된 문장의 `ultrawork`/`ulw` 키워드를 보고 호스트 모드를 한 번 켜고 호스트 지시문만 붙입니다. 다른 요청의 `ulw`도 일반 모드를 켤 수 있지만, 그렇다고 그 요청이 wish를 쓰게 되지는 않습니다.
- 이미 켜져 있으면 상태를 그대로 두고 지시문을 다시 붙이지 않습니다. 미리보기는 모드 상태를 바꾸지 않습니다.
- 스킬 지침은 시스템·개발자 지시, 나중에 사용자가 명시한 요청, 도구가 실제로 막는 게이트보다 우선하지 않습니다. 엔진이 강제하는 규칙이 아니라 지침의 우선순위입니다.
- 호스트의 모드 연동을 쓸 수 없거나, 입력이 `before_agent_start`를 거치지 않는 경로(예: 대기열에 쌓인 입력)로 들어오면 플러그인이 모드를 켜지 못할 수 있습니다. 그때도 켰다고 말하지 않고, wish 스킬 지침대로 계속 진행합니다.
- 승인된 요청이 전체 흐름을 이미 덮으므로 단계 재승인을 다시 묻지 않고 네이티브 리뷰어 루프나 실패 재시도 질문에 멈추지 않으며, 진짜 오너 결정만 질문 도구로, 도구가 없으면 일을 맡긴 에이전트를 통해 묻습니다.

## 네이티브 plan 게이트

`/wish`는 호스트의 네이티브 plan-reviewer 게이트를 스스로 열지 않습니다. 그 게이트는 요청자가 ulw-plan 흐름을 명시했을 때처럼 호스트 조건이 맞을 때만 열립니다. 게이트가 열려 있으면 PLAN-REVIEW는 `plan-reviewer` 1회를 쓰고, 아니면 `category: architect` 1회를 씁니다. 어느 쪽이든 차단 사항은 고치고 계획의 리뷰 기록에 남기며 다시 리뷰하지 않습니다. 최종 ultrabrain 리뷰가 그 수정을 확인합니다.