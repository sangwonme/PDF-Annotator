# Obsidian PDF Annotator Plugin - Development Context

## Background

Zotero에서 Obsidian으로 논문 관리를 완전히 이전하려는 과정에서, Obsidian 내 PDF 어노테이션 도구가 부족하다는 문제를 발견했다.

### 왜 Zotero를 떠나려 하는가

- **도구 통일**: Obsidian 하나로 연구 노트 + 논문 관리를 통합하고 싶음
- **git 기반 싱크**: 여러 컴퓨터에서 작업하는데, Zotero 싱크가 불안정하고 컴퓨터마다 소프트웨어 세팅이 번거로움. Obsidian vault는 git으로 모든 환경이 동기화되므로 이 방식으로 통일하고 싶음
- **오픈소스 수정 용이성**: Obsidian은 모든 파일과 플러그인이 오픈소스로 관리되어 커스텀이 쉬움

### 현재 환경

- Obsidian vault를 git repo로 관리 중 (GitHub)
- 약 500개 논문을 관리할 예정 (HCI 학회 논문 중심, 평균 2-3MB, 총 ~1GB)
- PDF를 git에 직접 넣어도 GitHub Free 한도(~2GB) 내에서 감당 가능
- 연구 노트 시스템(LLM Wiki)이 이미 Obsidian에 구축되어 있음

## 문제 정의

Obsidian에서 PDF를 Zotero 수준으로 어노테이션할 수 있는 플러그인이 없다.

### 기존 플러그인 검토 결과

| 플러그인 | 방식 | 문제 |
|---------|------|------|
| **PDF++** | 백링크 기반 (마크다운에서 PDF를 참조) | PDF 위에 직접 하이라이트/메모 불가. 읽기 흐름이 끊김 |
| **PDF Tools** (voidash) | Zotero 스타일 인라인 | 초기 단계, 어노테이션 저장 포맷 불확실, git 친화성 미검증 |
| **Annotator** (hypothes.is 기반) | 인라인 하이라이트 + 마진 코멘트 | 유지보수 중이나 완성도 부족 |

어느 것도 "PDF 위에 바로 하이라이트 + 메모"를 안정적으로 제공하지 못함.

## 개발 목표

Obsidian vault 안에서 완결되는 미니멀 PDF 어노테이션 플러그인.

### 필수 기능 (MVP)

1. **PDF 뷰어**: pdfjs-dist 기반, Obsidian 내 탭/패인에서 열림
2. **텍스트 하이라이트**: 텍스트 선택 후 색상별 하이라이트 (최소 4-5색)
3. **인라인 메모**: 하이라이트에 메모 추가 (팝오버 또는 사이드 패널)
4. **어노테이션 저장**: vault 내 마크다운 또는 JSON 파일로 저장 (git diff 가능)
5. **세션 간 유지**: Obsidian 재시작 후에도 하이라이트/메모가 보임

### 비기능 요구사항

- **git 친화적**: 어노테이션 데이터가 텍스트 기반이어야 함 (바이너리 X)
- **PDF 원본 불변**: PDF 파일 자체를 수정하지 않음
- **경량**: 불필요한 기능 없이 하이라이트 + 메모에 집중
- **Obsidian API 호환**: 표준 Obsidian 플러그인 구조 (TypeScript)

### 있으면 좋지만 MVP 이후

- 색상별 라벨링 (예: 노랑=중요, 파랑=정의, 빨강=의문)
- 어노테이션 검색/필터
- 어노테이션을 마크다운 노트로 내보내기 (wiki 연동)
- Obsidian 링크와 연결 (`[[페이지명]]`)

## 기술 스택

- **언어**: TypeScript
- **PDF 렌더링**: pdfjs-dist (Mozilla, 모든 Obsidian PDF 플러그인이 사용)
- **플러그인 프레임워크**: Obsidian Plugin API
- **어노테이션 저장**: JSON 또는 마크다운 (vault 내, PDF와 같은 디렉토리 또는 별도 폴더)

## 접근 방식 선택지

- **A. 기존 플러그인 포크**: PDF Tools 또는 Annotator를 포크해서 수정
- **B. 미니멀 신규 개발**: pdfjs 위에 핵심 기능만 새로 구현

어느 쪽이든 클로드 코드와 함께 작업하면 빠르게 프로토타입 가능.

## 사용자 프로필

- HCS Lab (인간중심컴퓨터시스템) PhD 2년차
- HCI 연구자, 논문을 많이 읽고 어노테이션함
- 주로 읽는 논문: CHI, UIST, IMWUT, DIS 등 HCI 학회
- 여러 컴퓨터에서 작업, git으로 환경 동기화
- Obsidian + git + Claude Code 기반 워크플로우
