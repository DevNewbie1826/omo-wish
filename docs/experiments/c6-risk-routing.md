# C6 최종 리뷰 경로 라우팅 (사전 등록)

등록일: 2026-10-27. 첫 처치 PR 전에 이 파일을 커밋합니다. 공통 기준선과 품질 가드는 C1 장부(`docs/experiments/ledger.md`, 브랜치 `wish/review-dispatch-gate`)를 따르고, C6의 가설·취소 기준은 이 파일이 소유합니다. C6는 C1과 독립인 병렬 팔입니다(C1은 호출 전 게이트, C6은 리뷰어 선택). 분류기 표 버전은 `c6-2026-10-27`입니다.

상태: **parked: reduces review depth, owner direction 2026-10-27** — 최종 리뷰어를 바꿔 리뷰 깊이와 리뷰 주체를 줄이므로 실제 PR 측정을 시작하지 않고 PR을 열어 둔 채 대기합니다. 아래 사전 등록 취소 기준은 그대로입니다.

## 가설

최종 리뷰(9단계)의 시간은 리뷰어의 깊이와 대기에서 온다. 변경 경로가 test·docs·CI뿐인 PR은 제품 런타임 코드를 바꾸지 않으므로, 같은 PR을 ultrabrain 대신 code reviewer가 최종 판정해도 결함 검출은 유지되고 시간만 줄어든다. production 경로가 하나라도 있거나 경로가 섞였거나 알 수 없으면 지금처럼 ultrabrain이 맡는다.

## 변수 (한 개)

9단계 리뷰어 선택만 바꿉니다. 경로 분류표, 6·7단계, 유한 계약, 증거 규칙, 병합 관문은 그대로입니다.

## 정확한 경로 규칙

분류 입력은 `git diff --name-status -M <base>...<head>`의 모든 경로입니다. 대소문자를 구분해 저장소 루트 기준 전체 경로로 맞추고, 첫 일치 행이 이깁니다. rename은 양쪽 경로를, 삭제는 삭제된 경로를 포함하며 production이 한쪽에라도 있으면 그 행은 production입니다.

| 분류 | 경로 규칙 |
| --- | --- |
| production (제품 오버라이드) | 계획이 선언한 제품 콘텐츠 루트 아래의 모든 경로. 제품이 런타임에 읽는 스킬·프롬프트·템플릿·로케일 파일이며, 계획이 루트와 소비자를 적습니다. `.`이나 `/`는 저장소 전체를 뜻합니다. |
| test | 디렉터리 세그먼트가 `test`, `tests`, `__tests__`, `__mocks__`, `__snapshots__`, `__fixtures__`, `spec`, `specs`, `testdata`, `e2e`; 또는 파일명이 `*.test.*`, `*.snap`, `test_*.py`; 또는 최종 확장자가 코드 확장자(`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.py`, `.rb`, `.go`, `.java`, `.kt`, `.kts`, `.cs`, `.scala`, `.php`, `.swift`, `.vue`, `.svelte`)인 `*.spec.*`, `*_spec.*`, `*_test.*`; 또는 파일명이 `*Test.java`, `*Tests.java`, `*Test.kt`, `*Tests.kt`, `*Test.kts`, `*Tests.kts`, `*Test.scala`, `*Tests.scala`, `*Test.cs`, `*Tests.cs` |
| CI | `.github/workflows/`, `.github/actions/`, `.circleci/`, `.buildkite/`, `.gitlab/`, `.azure-pipelines/`, `ci/`, `.ci/` 아래; 또는 `.github/dependabot.yml`/`.yaml`; 또는 파일명이 `Jenkinsfile`, `Jenkinsfile.*`, `.gitlab-ci.yml`/`.yaml`, `.travis.yml`/`.yaml`, `azure-pipelines.yml`/`.yaml`, `appveyor.yml`/`.yaml`, `.drone.yml`/`.yaml`, `bitbucket-pipelines.yml`/`.yaml`, `renovate.json`/`.json5`, `.renovaterc`, `.renovaterc.json` |
| docs (허용 목록) | 루트의 `docs/`, `doc/`, `documentation/` 아래; 또는 루트의 `README`, `CHANGELOG`, `CHANGES`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`, `AUTHORS`, `NOTICE`, `LICENSE`, `COPYING`이거나 그 이름 뒤에 `.`과 접미사가 붙고 최종 확장자가 `.md`, `.mdx`, `.markdown`, `.rst`, `.adoc`, `.txt`인 파일. 그 밖의 문서 확장자 파일과 중첩된 `docs/`, `doc/`, `documentation/` 디렉터리는 production입니다. |
| production (기본) | 나머지 전부. 알 수 없는 종류, 중첩 docs 디렉터리, 허용 목록 밖 문서 확장자, 생성물, 매니페스트, lockfile, 빌드 설정, 빈 diff 포함 |

라우팅:

- 경로가 하나 이상 있고 전부 test·docs·CI이면 `omo-native-code-reviewer`(code reviewer).
- production 경로가 하나라도 있거나, 섞였거나(mixed = production과 그 밖의 경로가 함께), 알 수 없거나, 빈 diff면 `category: ultrabrain`.
- 분류 오류, 기준(base) 없음, 잘린 파일 목록은 ultrabrain으로 갑니다.
- `spec`, `specs`, `e2e` 디렉터리 아래에 둔 production 계약(예: OpenAPI)은 계획의 제품 루트로 선언해야 합니다. 경로 기반 표의 알려진 한계입니다.

분류기는 `skills/wish/scripts/review-route.mjs`이며 같은 표를 구현하고 표 버전을 출력합니다. PR 본문에 `REVIEW ROUTE` 줄과 파일별 분류표를 적고, head가 움직이면 다시 계산합니다. 경로는 올라가기만 합니다(production이 나타나면 그 뒤 head도 ultrabrain).

## 측정 기준선 (2026-10-27, 실측)

출처: `gh pr list --state merged`의 파일 목록(저장소 `DevNewbie1826/genie`, 최근 104건) + `/tmp/oru-genie-resume/wish-metrics.csv`(같은 104건) 재계산, 그리고 `omo-wish` 최근 39건. 이 표는 새 허용 목록 규칙으로 다시 분류해도 같습니다(라우팅 대상이 전부 test-only).

| 집단 | n | 라우팅 비중 | 최종 리뷰 REVISE≥1 | ≥2 | delta 회차 | 열림→병합 중앙 | p90 | 열린 뒤 커밋≥3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| genie, 라우팅 대상(test/docs/CI only) | 21 | 21/104 = 20.2% | 9/21 = 42.9% | 4/21 = 19.0% | 0/21 | 78.8분 | 341.1분 | 4/21 = 19.0% |
| genie, production 포함 | 83 | — | 33/83 = 39.8% | 13/83 = 15.7% | 8/83 | 100.5분 | 544.5분 | 33/83 = 39.8% |
| omo-wish, 라우팅 대상 | 1 | 1/39 = 2.6% | — | — | — | 12.8분 | — | 0/1 |

- 라우팅 대상 21건은 전부 test-only였고, docs-only/CI-only는 0건이었습니다. omo-wish의 1건은 docs+test입니다.
- 한계: 21건 중 7건은 회차 수가 PR 본문 파싱 추정입니다. 과거 회차별 소요 시간은 CSV에 없습니다. GitHub `files` 목록은 PR당 100개에서 잘립니다(이 표본은 전부 8파일 이하). 분류 스크립트가 쓰는 git diff는 잘리지 않습니다.
- 해석: 라우팅 대상은 이미 더 빨리 병합되고(중앙 -21.7분) delta 회차가 없지만, REVISE율은 production보다 낮지 않습니다. 기대 이득은 회차 감소가 아니라 ultrabrain 대기 회피이므로, 주 지표는 최종 리뷰 벽시계 시간입니다.

## 측정 (라우팅된 PR마다)

- 주: 최종 리뷰 dispatch→verdict 벽시계 분(회차 합)의 중앙.
- 보조: 최종 리뷰 호출 수, 열림→병합 분, 같은 창의 라우팅 비중.
- 품질 가드(C1 장부와 같음): 병합 후 12단계 실패, 병합 뒤 같은 PR 재수정 커밋/PR, 블록당 무작위 5건 blind 재리뷰에서 계약 내 코드 결함 발견, 꼬리(최종 리뷰 ≥4회).
- 비교: 같은 창의 production PR(ultrabrain)과 위 표의 라우팅 대상 기준선.

## 결과 보고: 테스트 코드 전용 REVISE 꼬리

측정 출처: `/tmp/oru-revise-tests/report.md` (2026-10-27). 이 절은 결과 보고 전용이며 아래 취소 기준을 바꾸지 않습니다.

정의(보고서와 동일):

- 회차 = 리뷰가 REVISE/REQUEST_CHANGES/BLOCKERS 계열 판정을 반환한 한 번. QA 시나리오 FAIL은 리뷰 축이 아니므로 제외합니다.
- test-code-only 회차 = 그 회차의 모든 블로킹 파인딩이 테스트 산물(테스트 경로, mutation/guard/QA fixture, 검사 추가·강화)의 수정을 요구하고, 생산 코드 결함이 재현되지 않은 회차. 생산 코드 파인딩이 하나라도 있으면 아닙니다. 계획/계약·문서 파인딩은 별도(PLAN/DOCS)로 세고 test-code-only에 넣지 않습니다.
- test-only tail = 연속된 test-code-only 회차의 마지막 구간. 길이(회차 수)와 시간(첫 회차 dispatch→마지막 회차 verdict)을 기록합니다.

기록:

- 회차 단위: `docs/experiments/rounds.csv`의 `test_code_only` (true/false).
- PR 단위: `docs/experiments/measurements.csv`의 `test_only_rounds`, `test_only_tail_length`, `test_only_tail_hours`.
- 팔 결과(판정 시): 라우팅군의 test-code-only 회차 비중, 꼬리 길이 분포, 같은 창의 production/대조군과 비교.

기준선(보고서):

- genie 병합 104: 10/74 회차(13.5%), 13/68 파인딩(19.1%) — INFERENCE(기계 분류+20건 수검).
- genie 열린 9: 16/43 회차(37.2%), 27/99 파인딩(27.3%) — VERIFIED; #63은 15연속 test-only, 약 20시간.
- agent-sense: 7/22 회차(31.8%), 10/73 파인딩(13.7%) — VERIFIED.
- 해석: 병합 기저의 약 1/5이 테스트 코드입니다. C6의 라우팅 대상은 test/docs/CI-only이므로 test-code-only 꼬리가 이 팔에서 특히 중요합니다.

꼬리 감소 판정(결과 보고 전용, 취소 기준 아님): 라우팅 12 PR 판정 시 아래를 별도로 보고합니다.

- `yes`: 라우팅군에서 test-only tail 길이 ≥2인 PR이 0건이고, 라우팅군 test-code-only 회차 비중이 병합 기저 13.5% 이하.
- `no`: 위를 만족하지 않음.
- `insufficient`: 라우팅 PR이 12건 미만.

이 결과는 유지/취소 결정에 쓰지 않습니다. 유지/취소는 아래 사전 등록 기준만 따릅니다.

## 취소 기준 (사전 등록)

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

## 결과 기록

| PR | 라우팅 | 최종 리뷰(분) | 회차 | 열림→병합(분) | 게이트/품질 | 비고 |
| --- | --- | --- | --- | --- | --- | --- |

## 이력

- 2026-10-27: 등록. 기준선 측정 완료. 첫 처치 PR 대기.