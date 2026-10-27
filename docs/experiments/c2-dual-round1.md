# 실험 C2 — 최종 리뷰 1회차: 다른 모델 계열 두 명 병렬 · 합집합 판정

상태: **등록 완료, 측정 대기.** 이 브랜치(`exp/c2`)가 실행 팔을 배포합니다. 팔의 좋음/나쁨은 아직 없습니다. 판정은 아래 취소 기준으로 실제 PR 12건을 측정한 뒤에만 적습니다. 소유자의 GO 전에는 배정 행도 측정 행도 쓰지 않습니다(CSV는 헤더만).

시리즈 규칙(소유자): 한 실험에 한 변수, 시작 전에 취소 기준(지표·임계값·판정 PR 수) 등록, 개선이 아니면 되돌리고 수치와 이유를 기록한 뒤 다음 실험.

## 가설

최종 리뷰(9단계)의 1회차를 서로 다른 모델 계열의 리뷰어 두 명이 같은 고정 head에서 병렬로 보고, 실행 에이전트가 두 보고서를 **합집합**으로 합치면, 한 명이 놓치는 결함 부류를 같은 라운드에서 잡아 REVISE 회차(특히 2회차 이상)와 열림→병합 시간이 줄고, 품질은 한 명 리뷰보다 낮아지지 않는다.

근거: 최종 리뷰 REVISE≥1 PR은 열림→병합 중앙 171.8분으로 REVISE=0(51.3분)의 3.3배이고, 꼬리(≥4회) 8건이 전체 시간을 지배한다. 합집합은 검사를 줄이는 변경이 아니라 넓히는 변경이므로, 실패하면 속도 축(라운드 시간)에서 실패해야 한다.

## 단일 변수

바뀌는 것: 9단계 **1회차 리뷰어 수 1 → 2**(모델 계열이 달라야 함), 판정 방식 = 합집합.

바뀌지 않는 것:
- 2회차부터는 `ultrabrain` 리뷰어 한 명이 델타만 본다.
- 6·7단계 게이트, 유한한 계약 차단 규칙, 리뷰어 규칙 원문, 10·11·12·13단계는 그대로다.
- 삭제된 검사는 없다. 한 명 리뷰에서 잡히던 결함은 합집합에 그대로 남는다.

파일: `skills/wish/SKILL.md`(9단계, 게이트 순서, frontmatter 설명, 리뷰어 규칙 적용 목록), `skills/wish/references/review.md`(Step 9), `README.md`(9단계·게이트 순서·plan 게이트 호환 줄·리뷰어 규칙 적용 목록), 이 문서.

## 기준선 (2026-10-27 측정)

출처: `/tmp/oru-genie-resume/wish-metrics.csv`(115행, 병합 104건) 재계산 + `/home/mirage/genie-old-reference/workflow-experiments.md`.

| 지표 | 기준선 |
| --- | --- |
| 최종 리뷰 REVISE ≥1 | 42/104 (40.4%) |
| 최종 리뷰 REVISE ≥2 | 17/104 (16.3%) |
| 열림→병합 중앙 | 92.8분 (REVISE 0: 51.3분 n=62 / ≥1: 171.8분 n=42) |
| 꼬리(REVISE ≥4) | 8/104 |
| 최종 리뷰 1회차 소요 | 20~45분 (PR 열린 뒤 ultrabrain 최종 리뷰, workflow-experiments.md 측정 메모) |

## 취소 기준 (사전 등록)

- **표본 단위**: 처치 PR 하나 = 최종 리뷰 1회차가 **서로 다른 두 모델 계열**로, **같은 고정 head**에서 돌고, 합집합 판정이 기록된 PR. 둘 중 하나라도 빠지면 비적합으로 세고 표본에서 뺀다(비적합 건수는 따로 기록).
- **1차 지표**: 최종 리뷰 REVISE≥1 비율. 기준선 40.4%.
- **판정 시점**: 적합 처치 PR **12건**. 6건 시점은 진단 기록만 하고 취소 게이트로 쓰지 않는다(품질 가드만 상시 적용).
- **계속 조건(전부 만족)**: ① REVISE≥1 **≤3/12 (25%)**, ② 1회차 중앙 소요(dispatch→합집합 판정) **≤1.5× 기준선**. 기준선 45분을 상한으로 잡아 **≤67.5분**; 같은 기간에 측정한 기준선이 있으면 그 중앙값의 1.5배로 대체하고 두 값을 함께 적는다, ③ 품질 가드 위반 없음.
- **취소 조건**: 계속 조건을 하나라도 못 지키면 취소. 12건에서 REVISE≥1이 **4/12 이상**(33%, 기준선 대비 개선 미증명)이면 취소한다. 장부에 선등록한 취소값 `≥40%`(5/12 이상)는 그 이상의 확정 실패이고, 이 팔의 계속 조건을 3/12로 두었으므로 4/12도 "개선 없음"으로 취소한다. 시간 상한 초과나 품질 가드도 취소다. "개선 없음"은 유지가 아니라 취소다.
- **품질 가드(언제든 즉시 취소)**: ① 병합 후 12단계(병합 뒤 전체 검증) 실패, ② 병합 뒤 그 PR을 다시 고치는 커밋/PR, ③ 무작위 5건 blind 재리뷰에서 계약 안 코드 결함 발견(이 팔이 줄인 검사가 놓친 것), ④ 꼬리(REVISE≥4) 비율 악화(기준선 8/104 = 7.7/100 초과).

## 측정 기록 위치 (단일 장부)

기록 권위는 이 저장소의 `docs/experiments/` 한 곳입니다.

- `ledger.md` — 실험 등록·판정. #43(C1 팔)이 커밋했고 C2 행은 그 52행에 있습니다. 이 팔은 `ledger.md`를 복제하지 않습니다(권위 이중화 금지). 이 문서는 C2의 상세 등록문이고, 등록값은 `ledger.md`의 C2 행과 같습니다.
- `measurements.csv` — PR 단위 공통 스키마(공동 비교 계획 §3.3). 열: `pr,repo,arm,common_e6_e9,path_class,size_bucket,stacked_on,opened_at,merged_at,open_to_merge_minutes,total_rounds,ultrabrain_calls,code_reviewer_calls,architect_calls,content_commits_after_approval,step12_result,post_merge_refix,blind_review_result,invalid_flag,notes`.
- `rounds.csv` — 회차 단위 공통 스키마(§3.3). 열: `pr,round_index,round_kind,verdict_head_sha,dispatch_at,verdict_at,minutes,reviewer_category,reviewer_family,defect_count,defect_axes,counterexample_present,gate_rows,c2_split,c2_families,six_axis_line_present,verdict_line_present,verdict_line_head_match`.

인코딩: 시각은 ISO-8601(초), 분은 소수 1자리, `gate_rows`=`fixed=N;not_fixed=N;no_command=N`, `c2_split`=`a_only=N;b_only=N;both=N`, `c2_families`=`A=<계열>;B=<계열>`, `invalid_flag`는 `524`·`stall`·`rebase`·`conflict`·`tail`을 `;`로 잇습니다. 처치 PR이 생기면 이 팔 세션이 자기 PR에 자기 행을 추가합니다.

## 비적합 표본

호스트가 다른 모델 계열로 라우팅하지 못해 1회차가 한 명으로 돈 PR은 비적합이다. 스킬은 그 사실을 기록하고 한 명으로 돌리게 하며(같은 계열 두 개를 두 의견으로 세지 않음), 이 표에 적고 분모에서 뺀다.

## 취소했을 때

1. 이 PR이 병합 전이면 PR을 닫는다. 병합 뒤면 이 브랜치의 커밋을 `git revert`로 되돌린다(스킬 문구·README·이 문서).
2. 이 문서의 "결과" 절에 측정값(12건 각 행, 비율, 중앙 소요, 걸린 가드)과 취소 이유를 적는다.
3. 단일 장부 `docs/experiments/ledger.md`의 C2 행(현재 52행) 상태를 `취소`로 바꾸고 다음 실험으로 넘어간다.

## 출처와 연결

- 단일 장부의 C2 행(선등록, 원문; `docs/experiments/ledger.md` 52행, #43 커밋): `| C2 | 1회차 리뷰어 수 1 vs 2(다른 모델 계열) 합집합 판정 | 대기 | 12 PR | ≥1 비율 ≤25% | ≥1 비율 ≥40% 또는 회차 시간 50% 이상 증가 또는 품질 가드 위반 |`
- 측정 데이터: `/tmp/oru-genie-resume/wish-metrics.csv`, `/tmp/oru-genie-resume/report.md` §4, `/tmp/oru-wish-next/report.md` §1-1, `/home/mirage/genie-old-reference/workflow-experiments.md`(라운드 20~45분).
- 선행 실험: E1(지침 6종) 결론 없음, C1(9단계 dispatch gate, #43)은 장부를 커밋했고 이 팔은 그 장부를 단일 권위로 쓴다 — C2는 1회차 폭만 바꾸므로 C1과 독립 변수다. 다만 C1이 켜진 PR에서는 게이트가 ultrabrain 호출 전에 도는 만큼 1회차 시작점이 늦어질 수 있으니, 시간 비교는 같은 기간 C1 적용 여부를 `common_e6_e9`/`notes`에 적는다.

## 다른 팔과의 충돌 메모 (공유 파일)

base = origin/main `cbbfbf8`, 줄 번호는 base 파일 기준이며 공동 비교 계획 §2 매트릭스와 같다.

- `skills/wish/references/review.md` 26-32(Step 9): **다섯 팔 전부**가 같은 구역을 고친다. 내 텍스트는 후보일 뿐이고, 둘 이상이 승자면 자동 병합하지 말고 살아남은 Step 9 원문 위에 수동으로 다시 얹어야 한다. 특히 #44의 E6 동결·E9 판정 줄과 같은 문단을 공유한다.
- `skills/wish/SKILL.md` 1-6(frontmatter description), 23-29(9단계), 45-57(게이트 순서·리뷰어 프롬프트 목록): #43(22-33, 45-51)·#44(23-31, 45-56)·#45(1-6, 21-29, 45-51)와 겹친다. #42는 SKILL을 고치지 않는다. frontmatter 1-6은 #45와 직접 겹친다.
- `README.md` 103-109(9단계), 124-135(게이트 순서·리뷰어 규칙 목록), 156-162(plan 게이트 호환): 전 팔이 102~140을 고치고, 156-162는 #45와 같은 줄이다. 헝크가 줄로 안 겹쳐도 같은 절이라 순차 병합마다 충돌한다.
- 신규 파일: 이 팔은 `docs/experiments/c2-dual-round1.md`·`measurements.csv`·`rounds.csv`만 추가한다. #44·#45의 스크립트/시험과 겹치지 않고, #43의 `ledger.md`·`baseline.md`·`baseline-data.csv`와도 파일이 다르다. **`ledger.md`는 만들지 않는다** — #43판이 단일 권위이고 C2 행은 그 52행에 이미 있다.
- 결합 순서(§4): C2는 5번째다. #44(E6+E9) 뒤에 Step 9를 다시 쓰고, #45(C6)의 라우팅 아래에서 ultrabrain 라우팅 PR에만 적용하는 안이 결합 결정 1로 제안되어 있다(소유자 확인 필요). #43의 C1 게이트와는 게이트→이중 디스패치 순서로 조합한다.
- 공통 적용: 배정된 처치 PR에는 공통 E6+E9가 함께 걸리므로 `measurements.csv`의 `common_e6_e9`와 `notes`에 남긴다.

## 결과

(측정 전. 12건이 모인 뒤에만 채운다.)

## QA (이 팔의 문구 검증, 2026-10-27)

이 표는 배포된 문구의 구조 검증이고, 실험 결과가 아니다. 처치 PR은 아직 0건이다.

| QA | 방법 | 결과 |
| --- | --- | --- |
| QA1 합집합·고정 head·독립·2회차·폴백 | SKILL.md 9단계, review.md Step 9, README 9단계에서 29개 조항 문자열 확인: 두 명 병렬·다른 계열(A/B 양쪽), 고정 head, 상호 비공개, 합집합(다수결·교집합 금지), 둘 다 APPROVED, 2회차 단일 델타, 폴백, 커밋 유입 시 재시작, patch-id 예외, 지표 필드 | 29/29 PASS, 0 FAIL |
| QA2 배포 로더 | `timeout 300 bun scripts/verify.mjs .` (worktree) | ALL PASS, exit 0 |
| QA3 저장소 시험 | `timeout 300 bun test` | 6 pass, 0 fail, exit 0 |
| QA4 모순 문구 잔존 | `grep -rn 'One review with\|One ultrabrain final review\|ultrabrain 리뷰 한 번\|ultrabrain 최종 리뷰 한 번' . --include='*.md'` | NO_STALE_HITS |

문서 자체는 읽어서 검증한다(저장소 규칙: 문구를 고정하는 시험은 쓰지 않는다). 이 파일의 숫자는 기준선 표와 장부 C2 행에서 그대로 가져왔다.
