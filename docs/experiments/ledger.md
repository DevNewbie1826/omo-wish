<!-- C6 delta to the shared ledger. Authority: docs/experiments/ledger.md committed by PR #43 (branch wish/review-dispatch-gate); joint merge order is #43 first, then insert this row and section. Detailed pre-registration and baselines: docs/experiments/c6-risk-routing.md. This file is not a second authority. -->
# 리뷰 개선 실험 장부 — C6 delta

> 공유 장부의 C6 행만 담은 delta입니다. 결합 순서(공동 계획 §4)는 #43의 `docs/experiments/ledger.md` 먼저 → 이 행 삽입입니다. C6의 상세 사전등록·기준선·경로 표는 `docs/experiments/c6-risk-routing.md`가 소유하며, 취소 기준은 그 문서의 원문을 아래에 그대로 옮겼습니다.

## 실험 목록 (C6 row)

| ID | 변수 (한 개) | 상태 | 판정 시점 | 계속 조건 | 취소 조건 |
| --- | --- | --- | --- | --- | --- |
| C6 | 9단계 최종 리뷰어를 변경 경로 클래스로 라우팅: 모든 변경 경로가 test·docs·CI -> `omo-native-code-reviewer`, production 포함/혼합/미상/빈 diff -> `category: ultrabrain` (분류기 표 버전 c6-2026-10-27) | parked (리뷰 깊이 축소 — 소유자 지시 2026-10-27) | 라우팅된 PR 12건 (중간 6) | 아래 "C6 취소 기준"의 12건 유지 조건 1~5 | 아래 "C6 취소 기준"의 즉시·6건·12건·도달 실패 조건 |

## 상태

**parked: reduces review depth, owner direction 2026-10-27** — C6 replaces the ultrabrain final reviewer for test/docs/CI-only PRs, so it reduces review depth and who reviews. It is parked: no real-PR measurement, the PR stays open, and the pre-registered cancel criterion above stays unchanged.

## C6 취소 기준 (사전 등록, `docs/experiments/c6-risk-routing.md` 원문)

- 표본: 라우팅된 PR 12건. 중간 판정 6건.
- 즉시 취소: 라우팅된 PR에서 품질 가드 1건.
- 6건 중간: 최종 리뷰 벽시계 중앙이 25분을 넘으면 취소(ultrabrain 대기 추정 20~45분의 하한에서도 이득 없음).
- 12건 판정: 아래를 모두 만족해야 유지합니다.
  1. 최종 리뷰 벽시계 중앙 ≤ 15분.
  2. 최종 리뷰 REVISE≥1 비율 ≤ 42.9%(라우팅 대상 기준선).
  3. 열림→병합 중앙 ≤ 78.8분(라우팅 대상 기준선).
  4. 같은 창 병합 PR 중 라우팅 비중 ≥ 10%.
  5. 품질 가드 0건.
- 12건이 30일 또는 병합 120건 안에 모이지 않으면 "도달 실패"로 취소합니다(레버가 너무 작음).
- 취소 시: 라우팅 커밋을 revert하고, 이 파일의 결과 표에 수치와 이유를 기록한 뒤 다음 실험으로 넘어갑니다.

## 결과 보고: test-code-only REVISE 꼬리

`/tmp/oru-revise-tests/report.md` (2026-10-27)의 측정 규칙을 따릅니다. 결과 보고 전용이며 취소 기준은 바꾸지 않습니다.

- test-code-only 회차 = 그 회차의 모든 블로킹 파인딩이 테스트 산물(테스트 경로, mutation/guard/QA fixture, 검사 추가·강화) 수정을 요구하고 생산 코드 결함이 재현되지 않은 회차. PLAN/DOCS는 별도로 셉니다.
- test-only tail = 연속된 test-code-only 회차의 마지막 구간(길이·시간).
- 기록: `rounds.csv`의 `test_code_only`; `measurements.csv`의 `test_only_rounds`, `test_only_tail_length`, `test_only_tail_hours`.
- 팔 결과(12 PR 판정 시): 라우팅군의 test-code-only 회차 비중과 꼬리 길이를 별도 보고하고, 꼬리 감소를 `yes`/`no`/`insufficient`로 적습니다. 유지/취소에는 쓰지 않습니다.
- 기준선: genie 병합 104 10/74회차(13.5%) INFERENCE; genie 열린 9 16/43(37.2%) VERIFIED, #63 15연속·약 20시간; agent-sense 7/22(31.8%) VERIFIED.

## 측정 스키마

- PR 단위: `docs/experiments/measurements.csv` — 3.3의 공통 필드 19개(배정 팔과 공통 적용 팔을 `arm`/`common_arms`로 분리, 경로 분류는 `path_class`) + C6 보고 확장 3개(`test_only_rounds`, `test_only_tail_length`, `test_only_tail_hours`).
- 회차 단위: `docs/experiments/rounds.csv` — 3.3의 공통 필드 14개(결함 수·축을 `defect_count`/`defect_axes`로 분리) + C6 보고 확장 1개(`test_code_only`).
- 아직 라우팅된 PR이 없으므로 두 CSV는 헤더만 있습니다. 소유자 go 전에는 실제 PR 측정 행을 추가하지 않습니다.

## 이력

- 2026-10-27: 공유 장부 위치(`docs/experiments/`)로 동기화. 취소 기준은 `c6-risk-routing.md` 원문 그대로. 측정 시작 안 함(소유자 go 대기).
- 2026-10-27: test-code-only REVISE 꼬리 보고 필드를 추가(`rounds.csv` 1개, `measurements.csv` 3개). 취소 기준 불변.
- 2026-10-27: **parked: reduces review depth, owner direction 2026-10-27** — 실제 PR 측정 시작 안 함, PR #45 열어 둔 채 대기. 취소 기준 불변.