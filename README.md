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

이 프롬프트는 **Bun 1.4 이상 위에서 실행되는 OmO**에 맞춰져 있습니다. 프롬프트 본문이 js eval tool을 Bun 런타임의 기본 실행 환경으로 사용한다고 명시하므로, Bun 1.4 미만 런타임에서는 eval 환경 동작이 보장되지 않습니다.

## 사용법

입력창에 `/`를 치면 목록에 **wish — 소원을 빕니다** 가 뜹니다.

```
/wish <작업 설명>
```

예:

```
/wish 로그인 리다이렉트 버그 수정
```

`$ARGUMENTS` 자리에 인자가 치환되어 프롬프트 전문이 전송됩니다. 인자 없이 `/wish`만 입력하면 `작업 대상:` 뒤가 비어 들어가므로 인자를 붙이는 걸 권장합니다. 위치 인자(`$1`), 기본값(`${1:-기본값}`) 등 bash 스타일 치환도 템플릿에서 쓸 수 있습니다.

## 프롬프트가 하는 일

1. **ultrawork explore** — 작업 맥락·히스토리 분석, 이상적인 상태 정의
2. **Phase 분할** — 전체 작업을 여러 Phase로 나누고 ulw loop로 순차 진행
3. **Phase 실행** — Git worktree 생성 → mass ulw로 구현/검증/테스트 → PR
4. **검토 루프** — ultrabrain 검토, deep agent 수정 반영, 승인까지 반복 → merge → 다음 Phase

## 구조

```
omo-wish/
├── package.json    # pi manifest: prompts 리소스 선언
└── prompts/
    └── wish.md     # 슬래시 명령 템플릿 (description = 메뉴 설명)
```

`pi.prompts`에 디렉터리를 선언하면 OmO가 템플릿을 슬래시 메뉴에 등록합니다. 확장 JS는 필요 없습니다.

## 커스터마이징

`prompts/wish.md`를 고치면 됩니다 — `description`(메뉴에 뜨는 설명), `argument-hint`, 본문 전체가 다 템플릿 하나로 정의됩니다.

## 노트: 트리거 단어와 훅

이 템플릿 본문은 `ultrawork`, `mass ulw`, `ulw loop`를 명시적으로 지목합니다. OmO의 입력 훅(정규식 기반 확정 발동)은 슬래시 명령의 **원시 라인**(`/wish ...`)만 보고 확장된 본문은 보지 못하므로, 훅 주입 대신 에이전트가 본문 지시에 따라 해당 스킬을 직접 읽어 따르는 시맨틱 라우팅으로 동작합니다. ultrawork 모드를 확정적으로 arm하고 싶으면 파일명을 `wish-ulw.md`처럼 `ulw`를 포함하게 바꾸세요.
