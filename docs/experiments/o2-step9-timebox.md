# 실험 O2 — step 9 디스패치 TIMEBOX (45분 계약 판정)

한 실험 팔의 사전 등록서입니다. 유래: `/tmp/oru-poteto/report.md` §C O2(원출처 `orch:45` TIMEBOX), 같은 문서 §D 순위 1위. 공통 스키마: `/tmp/oru-wish-compare/report.md` §3.3. 공통 규칙은 시리즈와 같습니다: 시작 전 취소 기준 등록, 개선이 아니면 되돌리고 수치·이유를 기록. **이 팔은 병합 권한이 없습니다** — 소유자가 측정 결과를 보고 승자를 고릅니다. 이 PR은 팔과 사전 등록만 싣고, **측정된 결과를 주장하지 않으며 실제 PR을 측정하지 않았습니다**(소유자 go 이전 측정 금지).

## 가설

step 9 ultrabrain 최종 리뷰는 모든 PR이 지불하는 가장 긴 직렬 구간입니다. 리뷰어가 주어진 증거 대신 PR 전체를 다시 도출하며 스스로 범위를 넓히면 그 구간이 더 길어집니다(실측: P0 재실행 최종 리뷰 44.5분, 1차 24.2분). 디스패치 프롬프트에 45분 TIMEBOX와 증거 우선 스코프 문장을 넣으면, **같은 리뷰어가 같은 유한 계약을 같은 깊이로** 판정하되 벽시계만 예산 안에 묶입니다. 판정 의무("모든 CODE 결함을 한 판정에 보고")와 차단 정의는 불변이므로 품질이 줄지 않고, 리뷰가 끝나기 전에 처리할 수 있는 일은 이미 6·7단계가 소유합니다 — 이 팔은 그 뒤에 남은 **느린 구간의 예산**만 정합니다.

## 변수 (이 팔이 바꾸는 것) — 1개

**step 9 디스패치 프롬프트에 TIMEBOX·증거 우선 스코프 문장이 존재하는가.**

- 대조: 현행 텍스트(main `cbbfbf8`) — 시간 예산·범위 문장 없음.
- 처치: 모든 회차의 step 9 디스패치 프롬프트에 아래 문장이 들어감.

삽입 문장 원문(위치 포함, 3곳):

1. `skills/wish/references/review.md` Step 9(base 27-29행) 뒤 새 문단 —
   > TIMEBOX: reach a verdict on the plan's finite contract within 45 minutes of dispatch, judged from the evidence provided (the diff, the test and QA captures, the mutation records). Do not expand the scope by re-deriving the whole PR: build no new probe and run no repository check beyond the plan's axes. At expiry, return the verdict held so far, APPROVED or REVISE, and list every open item it leaves unexamined as an explicit note in that same verdict; the obligation to report every CODE defect the evidence shows in one verdict does not change.
2. `skills/wish/SKILL.md` 9단계 행(base 26행) — `reports every CODE defect of the PR in one verdict, under the TIMEBOX of references/review.md, Step 9.`
3. `README.md` 13단계 9행(base 106행, 한국어 미러) — 위 1번과 같은 의미(45분 TIMEBOX, 증거로 판정, PR 전체 재도출 금지, 만료 시 그때까지의 판정 + 미검토 항목 메모).

바꾸지 않는 것: 리뷰어(`category: ultrabrain` 1회), Delegation prompts의 리뷰어 규칙 문장(원문 그대로), 유한 계약 차단 정의, 회차 구조, 6·7·8·10·11단계, 게이트 순서(APPROVED 전 병합 금지), 12단계. **삭제된 검사: 0개.**

## omo 기반 (역할 불변 — 대체·우회 없음)

| 단계 | 도는 omo 기능 | 이 팔이 바꾸는 것 |
| --- | --- | --- |
| 3 계획 리뷰 | `architect` (1회) | 없음 |
| 4 목표·대기 | goals, monitors | 없음 |
| 5 실행 | mass-ulw (goal 결속 run, 노드별 worktree·주입 검사) | 없음 |
| 6(a) 저장소 테스트·변이 | mass-ulw 노드 | 없음 |
| 6(b) 실제 표면 QA | `omo-native-qa-executor` | 없음 |
| 7 코드 리뷰 | `omo-native-code-reviewer` | 없음 |
| 9 최종 리뷰 | `ultrabrain` (1회, 같은 차단 정의·같은 리뷰어 규칙) | **디스패치 프롬프트의 시간 예산·범위 문장만** |
| 12 병합 후 검증 | `omo-native-qa-executor` | 없음 |

새 에이전트·새 리뷰어·새 게이트·새 모델 슬러그를 만들지 않고, 어느 역할도 대체하지 않습니다. 바뀌는 것은 step 9가 **받는 브리프의 예산 문장** 하나입니다.

## 기준선 (2026-10-27)

| 지표 | 값 | 출처 |
| --- | --- | --- |
| step 9 dispatch→verdict 중앙 | 20-45분 (간접) | poteto 리포트 O2(팔 문서 인용), wish-compare §1.1 |
| P0 최종 리뷰 1차 | 24.2분 | sense-why §1 VERIFIED (poteto O2 인용) |
| P0 재실행 최종 리뷰(범위 자기확장) | 44.5분 | 위와 동일 |
| 열림→병합 중앙 | 92.8분 (n=104) | `/tmp/oru-genie-resume/wish-metrics.csv` 재계산(e2c3 등록문서 기준선) |
| 최종 리뷰 REVISE ≥1 | 42/104 = 40.4% | 위와 동일 |
| 꼬리(최종 리뷰 ≥4회) | 3/104 = 2.9% | 위와 동일 |

이 팔의 1차 지표는 회차 수가 아니라 **시간**입니다.

## 지표와 판독

판정 단위: **처치 회차** — 이 텍스트가 설치된 실행의 step 9 라운드. 취소 기준의 모집단은 **처치 PR 12건**입니다(회차가 아니라 PR 단위로 센다; REVISE 회차가 있는 PR도 1건).

- **M1(1차)** step 9 dispatch→verdict 중앙 분. 대조는 같은 시기 무처치 회차(현행 cbbfbf8 텍스트) 또는 위 기준선 밴드. 개선 = 중앙 **감소 ≥ 25%**.
- **M2** 최종 리뷰 REVISE ≥1 비율(깊이 훼손 신호). 기준선 40.4%.
- **M3 준수(진단)** 처치 회차 중 디스패치 프롬프트에 TIMEBOX 문장이 실제로 들어간 비율, 그리고 만료 시 그 판정에 미검토 항목이 note로 나열되었는지. 관측은 세션 캡처(디스패치 프롬프트 원문·판정 원문)로 하며, 관측 불가면 미준수로 셉니다. 준수 미달은 "효과 없음"이 아니라 **전달 실패**이므로 취소 트리거가 아니며, 문구·배치를 고쳐 같은 팔로 재등록합니다.
- **M4(보고용)** 총 회차, ultrabrain 호출 수(1 유지 확인), code-reviewer·architect 호출 수(불변이면 1·1), 열림→병합 중앙, step-12 결과, 만료 후 판정이 열린 항목을 실제로 남겼는지.
- **M5(상시 합의, 2026-10-27)** `test_only_revise_rounds`: 테스트 코드만 지적한 REVISE 라운드 수를 **별도로** 보고하고, 이 팔이 그 꼬리를 줄였는지 명시합니다(리포트 문면에 따라).
- 무효 플래그: 524/정지/리베이스가 낀 PR은 시간 지표에서 제외하고 비고에 남깁니다.

## 공통 필드 (`/tmp/oru-wish-compare/report.md` §3.3)

**PR 단위(measurements.csv 한 행)**: PR, 저장소, 배정 팔(+공통 E6/E9), 경로 분류(C6 표), 규모 버킷, stacked_on, 열림 시각, 병합 시각, 열림→병합 분, 총 회차, ultrabrain 호출 수, code-reviewer 호출 수, architect 호출 수, 승인 뒤 내용 커밋 수(E6), step-12 결과, 병합 후 재수정(커밋/PR), blind 재리뷰 결과(블록 단위), 무효 플래그(524/정지/리베이스), 비고(공동 적용 팔 목록) — **이 팔 추가**: `timebox_minutes`(45), `timebox_sentence_present`(0/1), `verdict_after_expiry`(0/1), `open_items_listed`(0/1), `test_only_revise_rounds`.

**회차 단위(rounds.csv 한 행)**: PR, 회차 인덱스, 회차 종류(first / revise / delta / gate-blocked), 판정 head SHA(40자), dispatch 시각, verdict 수신 시각, 분, 리뷰어(카테고리·모델 계열), 결함 수·축, 반례 존재(E2+C3), 게이트 행(fixed / not fixed / no command), C2 분해(A만 / B만 / 둘 다, 계열명), 6축 줄 존재(E2+C3 M4), 판정 줄 존재·헤드 일치(E9, check-verdict 결과) — **이 팔 추가**: `timebox_sentence_present`(0/1), `expired_at_45m`(0/1), `open_items_count`, `test_only_defects`(0/1 — 이 회차의 차단 지적이 테스트 코드에만 있었는지).

## 품질 가드 (전 안 공통 4종, 무관용)

1. **step-12 실패**: 병합 후 병합된 결과에서 전체 검증 실패.
2. **병합 후 재수정**: 그 PR의 문제로 병합 뒤 커밋/PR이 생김.
3. **blind 재리뷰 계약 내 결함**: 처치 5건(블록)마다 무작위 1건을 이 팔의 텍스트를 모르는 새 리뷰 세션으로 다시 리뷰해, 계획의 유한 계약 안 코드 결함이 나옴.
4. **꼬리 악화**: 최종 리뷰 회차 ≥4인 처치 PR 비율이 기준선(3/104)보다 나빠짐.

가드는 언제든(중간 6건에서도) 즉시 취소 사유입니다.

## 취소 기준 (사전 등록 — 원문 그대로, 변경 금지)

- **판정 시점: 처치 PR 12건.** 6건 중간 점검은 품질 가드로 즉시 중단할지만 판단하고 채택/취소 결정은 하지 않습니다.
- **계속(채택)**: M1 중앙 **감소 ≥ 25%** **그리고** M2(REVISE≥1) **≤ 40.4%** **그리고** 가드 **0건**.
- **취소**: M1 중앙 **감소 < 25%** **또는** M2(REVISE≥1) **> 50%**(기준선 40.4% + 10pp, 깊이 훼손 신호) **또는** 가드 **1건**.
- 회색 구간(40.4% 초과 ~ 50% 이하)은 원문에 정의가 없으므로 이 문서도 정의를 더하지 않습니다: 취소도 채택도 아니며 소유자가 연장 여부를 정합니다.
- 참고 산술(기준 아님): 기준선 밴드 20-45분에서 25% 감소는 상단 기준 33.8분 이하에 해당하지만, 판정은 **비율**로 합니다 — 절대 분 임계를 새로 등록하지 않습니다.

## 기록 위치

이 파일이 지금 이 팔의 권위 등록문서입니다. #43의 `docs/experiments/{ledger.md,measurements.csv,rounds.csv}`는 아직 main에 없으므로 **이 PR은 공유 장부·CSV 헤더를 만들거나 고치지 않습니다**(#42 `e2c3.md`·O1 등록문서 선례). 공유 장부가 들어오면 위 필드로 행을 더합니다(§3.3–3.4).

## 파일·충돌 (wish-compare §2)

- `skills/wish/references/review.md` — base 27-29(Step 9 문단) 뒤 삽입. 실행 중 팔 헝크와 **최중첩**: #41 26-32, #42 28-33, #43 24-32, #44 20-43, #45 16-32, 그리고 X1(`exp/x1`)이 같은 29행을 제자리에서 고쳐 씁니다. 두 팔 이상이 승자면 이 구역은 자동 병합 불가 — 살아남은 Step 9 텍스트 위에 수동 재작성.
- `skills/wish/SKILL.md` — base 26(9단계 행). #41 23-29, #43 22-33, #44 23-31, #45 21-29, X1이 같은 행을 편집 → 텍스트 충돌.
- `README.md` — base 106(13단계 9행). #41·#42·#43·#44·#45가 102-140을 편집하고, X1은 104에 삽입, o5는 108을 편집 → 같은 절.
- **겹치지 않는 형제 O팔**: O1 = review.md 19 / SKILL 48 / README 127, O3 = plan.md / SKILL 19 / 신규 스크립트·테스트, O5 = review.md 40 / SKILL 28 / README 108. 이 팔의 세 줄과 교차하지 않습니다.
- 신규 파일 `docs/experiments/o2-step9-timebox.md` — 파일명 유일, 공유 CSV·장부 불변.

## 예상 절감

PR당 **15-30분**(INFERENCE): 실측 근거는 P0 재실행 44.5분의 범위 자기확장과 20-45분 기준선 밴드, sense-why 추천 3의 "조각당 ~20-30분" 추정. 104 PR 규모로 약 35시간. 판정은 n=12 실측으로 합니다.

## 판정 절차

소유자가 처치 12건의 M1·M2·가드와 M5(테스트 전용 REVISE 꼬리)를 보고 채택/취소를 정합니다. 이 팔은 단독 병합하지 않습니다.