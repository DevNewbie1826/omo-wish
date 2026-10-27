# 실험 X1 — 최종 리뷰 전 결함 클래스 훑기 (PR 전 스윕)

상태: **등록 완료, 측정 대기.** 이 브랜치(`exp/x1`)가 실행 팔을 배포합니다. 팔의 좋음/나쁨은 아직 없습니다. 판정은 아래 취소 기준으로 실제 PR 12건을 측정한 뒤에만 적습니다. 소유자의 GO 전에는 배정 행도 측정 행도 쓰지 않습니다(CSV는 헤더만).

소유자 방향(2026-10-27, 한국어 요지): **리뷰를 줄이는 것이 아니다.** ultrabrain 최종 리뷰가 매우 오래 걸리므로, ultrabrain에 도달하기 전에 최대한 처리해서 ultrabrain이 적게 찾고 **짧은 한 라운드**로 끝나게 하되 **품질은 최소 동등**이어야 한다. 따라서 이 팔은 리뷰어를 줄이거나 판정 범위를 좁히지 않고, ultrabrain **앞에** 검사를 더한다.

시리즈 규칙(소유자): 한 실험에 한 변수, 시작 전에 취소 기준(지표·임계값·판정 PR 수) 등록, 개선이 아니면 되돌리고 수치와 이유를 기록한 뒤 다음 실험.

## 가설

독립 최종 리뷰가 실제로 찾은 결함은 소수의 반복 클래스에 몰려 있고(아래 §1), 그 클래스는 값싼 탐침으로 PR 전에 기계적으로 검출할 수 있다. 저자 세션이 9단계 직전에 그 탐침을 돌려 FAIL을 먼저 고치면, ultrabrain이 보는 head에는 그 클래스의 결함이 거의 남지 않아 **ultrabrain 1회차가 짧고 적게 찾고 끝나며**, 열림→승인 시간이 줄고, 품질은 (a) 제거된 검사가 없고 (b) blind 재리뷰 가드로 확인했을 때 동등 이상이다.

## 단일 변수

바뀌는 것: **9단계 직전에 7b단계(PR 전 결함 클래스 훑기)를 추가**한다 — 클래스별 탐침 실행기(`skills/wish/scripts/sweep.mjs`) + `category: quick` 체크리스트 1회.

바뀌지 않는 것:
- 9단계 ultrabrain 최종 리뷰는 **그대로 1회 실행**되고, 프롬프트의 차단 정의·리뷰어 규칙 원문·유한한 계약 규칙도 그대로다. 영수증은 "검증할 주장"으로 첨부될 뿐 대체하지 않는다.
- 6·7단계 게이트, 8단계 PR 본문 규칙, 10~13단계.
- 어떤 검사도 삭제·약화하지 않는다. 삭제된 것은 0건이다.

파일: `skills/wish/scripts/sweep.mjs`(신규 실행기), `skills/wish/references/sweep.md`(신규 참조), `skills/wish/SKILL.md`(7b단계·게이트 순서·참조 4개), `skills/wish/references/review.md`(Step 7b·Step 9 영수증 문장), `README.md`(미러), `test/sweep.test.js`+`test/fixtures/sweep/`(신규), 이 문서.

## 1. 측정된 결함 클래스 (deliverable 1)

### 1.1 방법

- 원자료: `/tmp/oru-indep-review/`의 독립 리뷰 문서. **판정(VERDICT)을 담은 리뷰 11건**을 셌습니다 — agent-sense #8 1회, #9 1회+델타1, #10 1회+델타1, #12 1회, #21 1회+델타1, #23 1회+2회, genie #81 1회. 브리프의 "약 14건"은 이 디렉터리의 문서 수(13개)를 센 값이고, 그중 `pr10-evidence.md`·`pr12-pr-body.md`는 리뷰가 아니며 `pr21-delta2`는 이전 지적의 해소만 적었습니다(현재 결함 0). 그래서 **결함이 있는 라운드는 10건, 판정 라운드는 11건**입니다.
- 세는 방법(기계적, 재현 가능): 각 문서의 `| id | severity | file:line | ... |` 표에서 `severity`가 `blocking`/`non-blocking`인 행만 셉니다. `pr10`·`pr21`은 `blocking (P1)`처럼 우선순위가 붙지만 접두어로 판별됩니다.
- 재현 명령:

```sh
cd /tmp/oru-indep-review
grep -cE '^\| *[A-Za-z0-9_-]+ *\| *(blocking|non-blocking)' pr8-agent-sense.md pr9-agent-sense.md ...
```

- 분류는 그 행의 지적 내용으로 붙였고, 클래스 경계에 걸친 2행은 **그 행을 잡는 탐침** 기준으로 넣었습니다(PR12 R5 정수 오버플로 → 경계값, PR8 AS8-4 출력 쓰기 오류 무시 → 경계/오류 경로). 이 선택은 §2의 탐침표와 1:1로 맞습니다.

### 1.2 전체

| 항목 | 값 |
| --- | --- |
| 판정 라운드 | 11 |
| 결함 행 | **52** |
| blocking | **29** |
| non-blocking | 23 |
| 결함이 있는 라운드 | 10 |
| 라운드당 blocking | **2.64** (29/11) |

### 1.3 클래스 표

| 클래스 | 행 | blocking | 이 클래스를 잡는 탐침 |
| --- | --- | --- | --- |
| C1 민감 데이터가 오류·로그로 샘 (자격 증명, 하류 원문) | 8 | 7 | `secrets` (카나리) |
| C2 잘못된 입력에서 패닉 | 1 | 1 | `boundary` (크래시 표식) |
| C3 취소·핸들러 수명 (컨텍스트 무시, 파이프·고루틴 잔류, 종료 순서, `errors.Is` 상실) | 10 | 7 | `race` + `lifecycle` |
| C4 경계·홀수 입력 (빈 값, 잘못된 UTF-8, 4096 경계, 음수 id, 옵션처럼 보이는 피연산자, 극단 정수, 마크업 분할) | 18 | 11 | `boundary` |
| C5 가드 제거에 살아남는 테스트 (변이 생존, 공허한 단언, 등록 우회) | 8 | 1 | `mutation` |
| C6 문서가 코드와 어긋남 | 5 | 0 | `docs`(존재) + `quick` 체크리스트(의미) |
| C7 설정 키를 잘못 받아들임 (미지·오타 키 수용) | 1 | 1 | `config` |
| C4-변형: 분할이 HTML 속성·엔티티를 잃음 | 1 | 1 | `boundary`(마크업 왕복) |
| **계** | **52** | **29** | |

- **자동 탐침이 덮는 행: 47/52 (90.4%), blocking 29/29 (100%).** 남는 5행은 C6의 non-blocking이고, 그중 "문서에 적힌 플래그·키가 실제로 있는가"는 `docs` 탐침이 자동으로 보고, "문서가 약속한 행동이 실제와 같은가"만 quick 체크리스트가 읽습니다.
- 이 분류는 **같은 원자료를 보고 우리가 만든 것**이라 순환 위험이 있습니다(§7 한계). 그래서 커버리지 주장은 "이 11라운드에서 관측된 blocking 29건 전부"로 한정하고, 새 라운드에서의 재현율은 처치 표본에서 다시 셉니다.

### 1.4 라운드별 분포 (재발 증거)

| 라운드 | 결함 | blocking | 주요 클래스 |
| --- | --- | --- | --- |
| agent-sense #8 r1 | 6 | 3 | C1·C3·C4 |
| #9 r1 | 7 | 3 | C3·C4 |
| #9 delta2 | 3 | 1 | C1·C5 |
| #10 r1 | 8 | 5 | C3(5)·C1·C5·C7 |
| #10 delta2 | 5 | 2 | C3(2)·C4·C5(2) |
| #12 r1 | 8 | 4 | C1·C2·C4(2)·C6·C5 |
| #21 r1 | 2 | 1 | C1·C5 |
| #21 delta2 | 0 | 0 | (지적 2건 해소) |
| #23 r1 | 6 | 5 | C1·C4(3)·C4-변형·C6 |
| #23 r2 | 5 | 3 | C1·C4(3)·C6 |
| genie #81 r1 | 2 | 2 | C3·C4 |

### 1.5 대표 예 (file:line, 원문 인용)

- **C1** `internal/adapter/chat/telegram/voice.go:109-110,132-137` — "Transcriber failures bypass `endpoint.redact`: stderr is included verbatim in the returned error and then in the normalization log." 같은 클래스가 #23 1회차(`voice.go:109-110`)와 2회차(`voice.go:86-89`, 다운로드 본문 읽기)에서 **같은 파일의 다른 경로**로 재발했습니다.
- **C1(지속)** `internal/watches/line.go:141,151` — "Raw matching lines are persisted in Seen state despite redaction of the emitted event." 내보내는 이벤트만 가리고 저장은 그대로인 형태.
- **C2** `internal/adapter/chat/telegram/send.go:230-236` — "reproduced `slice bounds out of range [:4098] with length 4097`" (4095 ASCII + `"\xffb"`). 우리 `boundary` 탐침의 `boundary-4096` 변형이 이 모양 그대로입니다.
- **C3** `internal/adapter/chat/discord/listen.go:378,486-499` — "Waiting for in-flight handlers before returning from each session blocks transport reconnect." / `internal/adapter/mux/herdr/herdr.go:59-74` — "No WaitDelay or equivalent pipe-drain cancellation is configured."
- **C4** `cmd/agent-sense/mux.go:89-118,127-157` — "implements no `--` terminator" (옵션처럼 보이는 리터럴 피연산자). `internal/adapter/chat/telegram/send.go:334-342` — "selects the first `>` even inside a quoted attribute."
- **C5** `cmd/agent-sense/adapters_telegram_test.go:9,13-15` — "the shipped-binary guard imports `telegram` itself, so its `init` runs even when the production blank import is absent" (등록 제거 변이 생존). `internal/watches/store_test.go:896-971` — "Removing only the capture truncation leaves all six newly added regression tests passing."
- **C6** `docs/adapters/telegram.md:165-168` — "The documentation says a crash re-delivers an update instead of dropping it", 코드는 offset을 먼저 전진시켜 건너뜁니다.
- **C7** `internal/adapter/chat/discord/discord.go:102-107,132-134` — "Unknown config keys with null values are silently accepted instead of rejected by the closed schema."

### 1.6 기존 기준선과의 관계

| 지표 | 기준선 | 출처 |
| --- | --- | --- |
| 최종 리뷰 REVISE ≥1 | 42/104 (40.4%) | `/tmp/oru-wish-next/report.md` §1-1, `wish-metrics.csv` 재계산(VERIFIED) |
| 최종 리뷰 REVISE ≥2 | 17/104 (16.3%) | 같음 |
| 꼬리(REVISE ≥4) | 8/104 (7.7%) | 같음 |
| 열림→병합 중앙 | 92.8분 (REVISE 0: 51.3분 n=62 / ≥1: 171.8분 n=42) | 같음 |
| 9단계 1회차 소요 | 20~45분 | `workflow-experiments.md` 측정 메모(INFERENCE) |
| **라운드당 blocking 결함(이 팔의 1차 품질 지표)** | **2.64** (29/11) | 이 문서 §1.2 — 독립 리뷰 표본 |

## 2. 스윕 (deliverable 2)

### 2.1 클래스별 탐침 (탐침 하나 = 클래스 하나)

| 클래스 | 탐침 | 자동 판정 | FAIL이 뜻하는 것 |
| --- | --- | --- | --- |
| C1 | `secrets` | 선언한 오류 경로마다 환경에 **카나리 자격 증명**을 넣고 실행 → stdout·stderr·선언한 로그 파일에서 카나리 검색 | 카나리가 출력에 도달했다 = 서식·절단·저장 전에 가려야 한다 |
| C2·C4 | `boundary` | 선언한 각 케이스 + **빈 stdin / 잘못된 UTF-8 / 4096 경계+끝의 잘못된 바이트** 변형을 실행 | 크래시 표식(`panic:`, `RangeError`, `slice bounds out of range`, `Traceback` 등) 또는 선언한 종료 코드 밖의 종료 |
| C3 | `race` + `lifecycle` | 변경 패키지에 race 검출기 1회 + 준비 신호를 기다렸다가 시그널을 보내고 종료까지 시간 측정, 프로세스 그룹 잔류 확인 | race 진단, 자식이 끝났는데 그룹이 살아 있음, 예산 초과 종료 |
| C4 | `boundary`(선언 케이스) | `--`, 옵션형 피연산자, 음수 id, 극단 정수, 경로 이탈 등 케이스를 계획이 선언 | 잘못된 입력을 받아들임, 또는 크래시 |
| C5 | `mutation` | `git diff <base>...HEAD`의 **추가된 생산 코드 줄**을 임시 복사본에서 하나씩 지우고 선언한 테스트 명령 실행 | `SURVIVED` = 그 줄이 없어도 스위트가 초록 |
| C6 | `docs` | 변경 문서의 `--flag` 토큰이 `--help` 출력 또는 선언한 known 목록에 있는지 | 문서가 약속한 플래그가 코드에 없음 |
| C7 | `config` | 선언한 accept/reject 케이스(미지 키·오타 키 포함)를 실제 로더로 실행 | 닫힌 스키마가 미지 키를 받아들임 / 문서화된 키를 거부 |
| C4-변형 | `boundary`(마크업 왕복) | 태그·속성·엔티티가 든 입력의 분할 결과를 다시 붙여 원문과 비교 | 분할이 의미를 잃음 |

- 스크립트가 판단할 수 없는 나머지: **`category: quick` 체크리스트 1회**. 같은 클래스 목록으로 완성된 diff를 읽고 `CLASS | clean | finding | fixed` 한 줄씩 남깁니다. 산문이 약속한 행동(C6의 의미 부분), 와이어 스키마, 상태 전이의 주인은 여기서만 걸립니다.
- 안전 한계(소유자 지시 준수): 명령은 각 1회, 재시도·대기 루프·sleep 없음, 병렬 ≤ 8, 명령 타임아웃 ≤ 300초. `INVALID`(컴파일 실패 변이 등)는 살상으로 세지 않고 고칠 대상이며, `SKIP`은 이유를 적어 체크리스트로 넘깁니다.
- 픽스처가 계약을 고정합니다: `test/sweep.test.js`는 깨끗한 픽스처에서 7개 탐침 전부 PASS(오탐 0)를, 심은 픽스처에서 클래스마다 자기 탐침만 FAIL을 확인합니다(§8).

### 2.2 스킬 텍스트에 삽입한 단계 (정확한 위치)

- **`skills/wish/SKILL.md`**: 13단계 목록의 7단계와 8단계 사이에 **7b**를 넣었습니다. 9단계(ultrabrain)는 번호가 그대로라 다른 팔과 공유하는 앵커가 움직이지 않습니다.
- **`skills/wish/references/review.md`**: `## Step 7b: Pre-review defect-class sweep` 절을 `## Step 8` **앞**에 두고, `## Step 9`에 "영수증은 검증할 주장이며 리뷰어의 판독을 대신하지 않는다"는 문장을 더했습니다.
- **`skills/wish/references/sweep.md`**: 탐침표·설정 모양·규칙(신규 참조).
- **`README.md`**: 흐름도·13단계 목록·7b절·참조 표·구조도 미러.
- 게이트 순서: "6단계 통과, 7단계 실행, **7b 훑기 깨끗** 전에는 PR을 열지 않는다".

**왜 8단계 뒤가 아니라 7b(PR 전)인가:** 8단계가 PR을 열면 6단계 캡처와 8단계 본문의 head가 고정됩니다. 그 뒤 스윕 수정을 커밋하면 (a) 6단계 증거가 낡고 (b) ultrabrain이 판정할 head 동결 창에 커밋이 들어갑니다(E6가 겨냥한 바로 그 구간). 그래서 수정이 공짜인 마지막 지점인 PR 전에 둡니다. ultrabrain **직전**이라는 조건은 그대로입니다.

### 2.3 영수증

`bun skills/wish/scripts/sweep.mjs --config .wish-sweep.json --json <evidenceRoot>/sweep.json` → `x1-sweep/1` 스키마: 탐침별 `status`(PASS/FAIL/SKIP/INVALID), 검사별 `id`·`status`·`detail`, `summary`, `exit`(FAIL>0이면 1), `head`, `parallel`, `timeoutMs`. 체크리스트는 `<evidenceRoot>/sweep-checklist.md`. 두 경로가 9단계 프롬프트와 PR 본문에 들어갑니다.

## 3. 취소 기준 (사전 등록, deliverable 3)

### 3.1 표본

- **표본 단위 = 처치 PR**: 7b 훑기가 9단계 dispatch **전에** 실행되어 영수증(`sweep.json`)과 체크리스트가 남고, dispatch가 고정 head에서 시작된 PR.
- 영수증이 없거나, 훑기가 dispatch 뒤에 돌았거나, 체크리스트가 비어 있으면 **비적합**으로 세어 표본에서 빼고 `invalid_flags`에 적습니다(비적합 건수는 따로 보고).
- 같은 PR의 2회차 이후 라운드·델타 라운드는 그 PR 기록에 포함합니다(회차 단위는 `rounds.csv`).

### 3.2 지표 (셋 다 사전 등록, 우선순위 순)

1. **9단계 회차·판정**: PR별 ultrabrain 호출 수와 그중 REVISE 수. 1차 판정은 **REVISE ≥1 비율**. 기준선 42/104 = 40.4%.
2. **훑기가 덮는 클래스에서 ultrabrain이 찾은 blocking 결함**: 라운드당 개수. 기준선 **2.64**(29/11, §1.2). 회차의 `defects_by_class`에서 C1·C2·C3·C4·C4-변형·C5·C7을 셉니다(C6는 체크리스트 축이라 따로 보고).
3. **PR 열림→승인까지 분**: `approved_at`은 9단계 APPROVED 판정 시각(가능하면 E9 판정 줄의 head 일치 확인 뒤). 기준선은 열림→병합 92.8분 중앙이며, 승인 시각이 없으면 승인된 head의 커밋 시각으로 대체하고 그 사실을 적습니다.

### 3.3 판정 (12건, 중간 6건)

- **즉시 취소(0)**: 품질 가드 1건 이상(§3.5).
- **중간 6건(진단만, 취소 게이트 아님)**: 지표 1·2의 중간값을 기록. 단, 이 시점에서 **라운드당 covered-class blocking이 2.64를 넘거나 품질 가드가 걸리면 조기 취소**합니다(악화 방향이 명확한 경우만).
- **12건 취소(1)**: 아래 중 하나라도 참이면 취소.
  - 라운드당 covered-class blocking **≥ 2.11** (기준선의 80% — 개선 미증명)
  - REVISE ≥1 비율 **≥ 5/12** (41.7% — 기준선 40.4% 대비 개선 없음)
  - 열림→승인 중앙 **≥ 92.8분** (기준선과 같거나 나쁨)
  - 꼬리(REVISE ≥4) 비율이 기준선 8/104보다 나쁨
  - 준수: 영수증+체크리스트를 갖춘 처치 PR이 **9/12 미만**(나머지는 비적합)
- **12건 계속(2)**: 아래를 모두 만족하면 유지.
  - 라운드당 covered-class blocking **≤ 1.32** (기준선의 50%)
  - REVISE ≥1 비율 **≤ 3/12** (25%)
  - 열림→승인 중앙 **≤ 83.5분** (기준선 −10%)
  - 품질 가드 0건, 준수 ≥ 9/12
- **연장(3)**: (1)도 (2)도 아닌 구간(예: 중앙 83.5~92.8분, 또는 라운드당 1.32~2.11)이면 **6건 연장(총 18)** 후 같은 임계값으로 한 번 더 판정하고, 연장 뒤에도 (1)도 (2)도 아니면 취소. 연장은 1회뿐입니다.
- **도달 실패**: 12건이 **30일 또는 병합 120건** 안에 모이지 않으면 취소(레버가 너무 작음).
- **취소 시**: 이 브랜치의 커밋(SKILL/review/README/sweep.md/scripts/tests)을 `git revert`로 되돌리고, 이 문서의 "결과" 절에 측정값(12행, 비율, 중앙, 가드)과 취소 이유를 적은 뒤 다음 실험으로 넘어갑니다.

### 3.4 보고 전용(취소 기준 아님)

- **스윕 비용**: 세션 시작→PR 열림 분(`start_to_open_minutes`)과 스윕 실행 벽시계. 이 팔은 PR 전에 일을 더하므로 이 값은 늘어나는 것이 정상이며, 유지/취소에는 쓰지 않습니다.
- **고친 FAIL 수**: 탐침이 잡아 저자가 고친 건수(`sweep_fail_fixed`). 이 값이 0에 가까우면 팔의 레버가 없다는 뜻이므로 결과 해석에 함께 적습니다.
- **test-only 꼬리**: `/tmp/oru-revise-tests/report.md` 규칙으로 별도 보고합니다(이 팔은 테스트 검사를 줄이지 않으므로 악화 가능성은 낮지만 측정은 합니다).

### 3.5 품질 가드(하나라도 걸리면 즉시 취소, 공통 4종 + 이 팔의 blind 재리뷰)

1. 병합 후 12단계(병합 뒤 전체 검증) 실패.
2. 병합 뒤 그 PR을 다시 고치는 커밋/PR.
3. **blind 재리뷰에서 훑기가 덮는 클래스의 계약 안 결함 발견** — 아래 절차.
4. 꼬리(REVISE ≥4) 비율 악화(기준선 8/104).

**blind 재리뷰 절차(승인 PR 5건)**: 처치 PR이 5건 승인되면, 가장 최근 승인 5건을 고릅니다. 각 PR에 대해 **작성 세션과 다른 모델 계열**의 리뷰어를 새로 띄우고, 입력은 (a) 승인 head의 PR diff, (b) 계획의 IS·COMPANION 행과 불변식, (c) §1.3 클래스 목록만 줍니다. **영수증·체크리스트·이전 판정·훑기 결과는 주지 않습니다.** 리뷰어는 클래스마다 "승인 head에서 재현되는 계약 안 결함"을 명령과 관측으로 보고하고, 훑기가 덮는 클래스에서 재현 1건이라도 나오면 **가드 위반**입니다(덮지 않는 클래스의 지적은 기록만). 결과는 `blind_review_result`에 `pr/head/family/reproduced`로 적습니다.

## 4. 측정 필드

- PR 단위 `measurements.csv`: 공동 스키마(`/tmp/oru-wish-compare/report.md` §3.3)의 PR 필드 + 이 팔 확장 `approved_at`, `open_to_approval_minutes`, `start_to_open_minutes`, `ultrabrain_rounds`, `covered_class_blocking`, `covered_class_findings`, `sweep_receipt`, `sweep_checks`, `sweep_fail_fixed`, `checklist_rows`, `blind_review_result`.
- 회차 단위 `rounds.csv`: 공동 스키마의 회차 필드 + `blocking_count`, `defects_by_class`, `covered_class_blocking`, `sweep_receipt_seen`, `verdict_line_present_and_head_match`.
- 두 CSV는 **헤더만** 있습니다. 소유자 GO 전에는 실제 PR 행을 추가하지 않습니다.

## 5. 다른 팔과의 충돌 메모 (공유 파일)

base = origin/main `cbbfbf8`, 줄 번호는 base 파일 기준입니다.

- `skills/wish/references/review.md` **16~27행(Step 6~9 구역)**: 다섯 팔(#41 C2는 26-32, #42는 28-33, #43은 24-32, #44는 20-43, #45는 16-32)이 이미 이 구역을 고칩니다. X1은 **Step 8 바로 앞**에 절 하나를 더하고 Step 9 첫 문단 끝에 문장 하나를 더하므로, `## Step 7b` 삽입 지점이 다른 팔의 Step 8/9 헝크와 줄로 겹칩니다. 둘 이상이 승자면 살아남은 텍스트 위에 수동으로 다시 얹어야 합니다.
- `skills/wish/SKILL.md` 1-6(frontmatter description), 23-29(7~9단계), 41-57(Rules·Delegation prompts 부근): #41·#43·#44·#45와 겹칩니다. X1은 **7b 항목 하나**와 게이트 순서 한 줄, 참조 개수 한 단어만 고칩니다.
- `README.md` 100~140(13단계·7단계·참조 표)·155~200(구조): 전 팔과 같은 절입니다. X1은 7b 목록 항목·7b 절·참조 표 1행·구조도만 더합니다.
- **신규 파일은 불격침**: `skills/wish/scripts/sweep.mjs`, `skills/wish/references/sweep.md`, `test/sweep.test.js`, `test/fixtures/sweep/**`, 이 문서, `ledger.md`(delta), 두 CSV. #44의 `check-verdict.mjs`·#45의 `review-route.mjs`와 파일이 다릅니다.
- **장부 권위**: `docs/experiments/ledger.md`의 권위는 #43(PR이 커밋한 99행)입니다. 이 팔의 `ledger.md`는 **X1 행만 담은 delta**이며 두 번째 권위가 아닙니다. 장부 확정 시 X1 행을 #43판에 삽입합니다.
- **결합 순서**: 공동 계획 §4는 측정 후 승자 선택입니다. X1은 검사를 더하는 방향이라 어느 팔과도 검사 충돌이 없고, 텍스트 충돌만 있습니다.

## 6. 결과

(측정 전. 처치 PR 12건이 모인 뒤에만 채웁니다. 소유자 GO 전에는 측정을 시작하지 않습니다.)

## 7. 한계·리스크

1. **분류 순환**: 클래스는 같은 11라운드에서 만들었습니다. "blocking 29/29가 덮인다"는 이 표본의 사실이고, 새 표본의 재현율은 처치 PR에서 다시 셉니다(지표 2).
2. **훑기의 거짓 음성**: 탐침은 계획이 선언한 진입점만 봅니다. 선언을 빠뜨린 경로는 여전히 ultrabrain 몫이며, 그래서 리뷰어를 빼지 않습니다.
3. **변이 탐침의 비용**: 추가된 생산 줄마다 복사본 + 스위트 1회입니다. 상한 12줄/회, 병렬 ≤ 8, 줄당 300초로 묶었지만 큰 PR에서는 PR 전 시간이 늘 수 있습니다(보고 전용 지표).
4. **`secrets` 탐침의 전제**: 카나리가 실제 설정 경로를 타야 합니다. 설정을 파일로만 받는 프로그램은 `env` 대신 설정 파일 픽스처가 필요하고, 그 경우 계획이 그 경로를 선언해야 합니다.
5. **ultrabrain 시간 축의 기준선 약함**: 9단계 1회차 20~45분은 INFERENCE입니다. 그래서 이 팔의 1차 판정을 시간이 아니라 **회차·covered-class 결함 수**에 두고, 시간은 보조 지표로 씁니다.
6. **다른 팔과의 동시 적용**: 공통 E6+E9가 함께 걸리면 열림→승인 측정이 오염될 수 있으므로 `common_arms`에 기록합니다.

## 8. QA (이 브랜치의 문구·도구 검증, 실험 결과 아님)

| QA | 방법 | 결과 |
| --- | --- | --- |
| QA1 깨끗한 픽스처 | `bun test test/sweep.test.js` — clean 픽스처에서 탐침 7개 전부 PASS, `summary` = PASS 7 | PASS (오탐 0) |
| QA2 심은 결함 | 같은 시험 — seeded 픽스처에서 secrets·boundary·race·mutation·docs·config·lifecycle 각각 FAIL, 검사 id까지 일치 | PASS (7/7 클래스 검출) |
| QA3 경계 변형 | seeded의 `boundary/stdin:boundary-4096` FAIL 상세에 `slice bounds out of range` 포함, `declared` 변형은 PASS | PASS |
| QA4 상한·INVALID | `parallel: 99 → 8`, `timeoutMs: 999999 → 300000`, 없는 줄 변이 → `INVALID`(살상 아님) | PASS |
| QA5 저장소 시험·로더 | `timeout 300 bun test`, `timeout 300 bun scripts/verify.mjs .` | 아래 §9 기록 |
| QA6 문구 정합 | SKILL.md·review.md·README에서 7b·게이트 순서·참조 4개가 서로 어긋나지 않는지 grep으로 확인 | 아래 §9 기록 |

문서 자체는 읽어서 검증합니다(저장소 규칙: 문구를 고정하는 시험은 쓰지 않습니다). 숫자는 §1.2~1.6의 표에서 그대로 가져왔습니다.

## 9. 검증 기록

(이 브랜치에서 실행한 명령과 출력. 실험 결과가 아니라 도구·문구 검증입니다.)