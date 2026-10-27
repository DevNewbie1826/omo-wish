<!-- X1 delta to the shared ledger. Authority: docs/experiments/ledger.md committed by PR #43 (branch wish/review-dispatch-gate); joint merge order inserts this row after that file lands. Detailed pre-registration, the measured class table and the blind-review guard: docs/experiments/x1-defect-sweep.md. This file is not a second authority. -->
# 리뷰 개선 실험 장부 — X1 delta

> 공유 장부의 X1 행만 담은 delta입니다. X1의 상세 사전등록·기준선·클래스 표는 `docs/experiments/x1-defect-sweep.md`가 소유하며, 취소 기준은 그 문서 §3의 원문을 아래에 그대로 옮겼습니다.

## 실험 목록 (X1 row)

| ID | 변수 (한 개) | 상태 | 판정 시점 | 계속 조건 | 취소 조건 |
| --- | --- | --- | --- | --- | --- |
| X1 | 9단계 직전에 PR 전 결함 클래스 훑기 추가(7b): 클래스별 자동 탐침 `skills/wish/scripts/sweep.mjs` + `category: quick` 체크리스트 1회. 리뷰어·차단 정의 불변 | 등록 완료·측정 대기(소유자 GO 대기) | 처치 PR 12건 (중간 6, 조기 취소 조건 있음) | §3.3 (2): 라운드당 covered-class blocking ≤1.32 ∧ REVISE≥1 ≤3/12 ∧ 열림→승인 중앙 ≤83.5분 ∧ 가드 0 ∧ 준수 ≥9/12 | §3.3 (1): ≥2.11 ∨ REVISE≥1 ≥5/12 ∨ 중앙 ≥92.8분 ∨ 꼬리 악화 ∨ 준수 <9/12; 가드 1건(즉시); 30일/120병합 도달 실패 |

## 상태

**등록 완료, 측정 대기.** 실제 PR 측정 행은 없습니다(소유자 GO 전 금지). 이 팔은 검사를 **더하는** 방향이고 9단계 ultrabrain을 그대로 두므로, E7·C6처럼 리뷰 깊이를 줄이는 이유로 park된 팔이 아닙니다.

## X1 취소 기준 (사전 등록, `docs/experiments/x1-defect-sweep.md` §3 원문 요지)

- 표본: 7b 영수증(`sweep.json`)과 체크리스트를 갖추고 9단계 dispatch가 고정 head에서 시작된 처치 PR 12건. 영수증 없는 PR은 비적합으로 분모에서 뺍니다.
- 1차: ultrabrain REVISE≥1 비율(기준선 42/104 = 40.4%).
- 2차: 라운드당 covered-class blocking 결함(C1·C2·C3·C4·C4-변형·C5·C7). 기준선 2.64(29/11 독립 리뷰 라운드).
- 3차: PR 열림→승인 중앙(기준선 열림→병합 92.8분).
- 중간 6건은 진단 기록만 하되, 그 시점에 2.64 초과 또는 가드 1건이면 조기 취소.
- 12건 계속: ≤1.32 ∧ REVISE≥1 ≤3/12 ∧ 중앙 ≤83.5분 ∧ 가드 0 ∧ 준수 ≥9/12. 취소: ≥2.11 ∨ ≥5/12 ∨ ≥92.8분 ∨ 꼬리 악화 ∨ 준수 <9/12. 그 사이 구간은 6건 연장 후 1회 재판정, 그래도 어느 쪽도 아니면 취소.
- 도달 실패: 12건이 30일 또는 병합 120건 안에 안 모이면 취소.
- 품질 가드(즉시 취소): 12단계 실패 / 병합 후 재수정 / **승인 PR 5건 blind 재리뷰에서 훑기가 덮는 클래스의 계약 안 결함 재현** / 꼬리 비율 악화.
- 취소 시: 7b 커밋을 revert하고 `x1-defect-sweep.md` "결과"에 수치와 이유를 적은 뒤 다음 실험으로.

## 측정 스키마

- PR 단위: `measurements.csv` — §3.3 공통 필드 + X1 확장(`approved_at`, `open_to_approval_minutes`, `start_to_open_minutes`, `ultrabrain_rounds`, `covered_class_blocking`, `covered_class_findings`, `sweep_receipt`, `sweep_checks`, `sweep_fail_fixed`, `checklist_rows`, `blind_review_result`).
- 회차 단위: `rounds.csv` — §3.3 공통 필드 + `blocking_count`, `defects_by_class`, `covered_class_blocking`, `sweep_receipt_seen`, `verdict_line_present_and_head_match`.
- 소유자 go 전에는 두 CSV 모두 헤더만 둡니다.

## 이력

- 2026-10-27: 등록. 소유자 방향(리뷰 축소 금지, ultrabrain 앞에서 처리)에 따라 7b를 PR 전 단계로 배치. 측정 시작 안 함.
