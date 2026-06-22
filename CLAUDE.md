# PDF Annotator - Development Guide

## Branch Strategy

- **`dev`**: 개발 브랜치. 모든 기능 개발과 버그 수정은 여기서 진행. `main.js` 빌드 결과물은 `.gitignore`에 포함되어 추적하지 않음.
- **`main`**: 릴리즈 브랜치. Obsidian 플러그인으로 바로 설치 가능한 상태를 유지. `main.js`, `manifest.json`, `styles.css`, `versions.json`이 모두 포함됨.

## Release Workflow

1. `dev`에서 개발 완료
2. `dev` -> `main`으로 merge
3. `main`에서 `npm run build` 실행하여 `main.js` 생성
4. 빌드 결과물(`main.js`) 커밋
5. `versions.json` 업데이트 (새 버전 -> minAppVersion 매핑 추가)
6. 태그 생성: `git tag vX.Y.Z`
7. push: `git push origin main --tags`
8. GitHub Release 생성 후 `main.js`, `manifest.json`, `styles.css` 에셋 첨부

## Build

```bash
npm install
npm run dev    # watch mode (개발용)
npm run build  # production build
```

빌드 결과물은 `.obsidian/plugins/pdf-annotator/main.js`로 출력됨 (esbuild.config.mjs 참고). 릴리즈 시에는 이 파일을 프로젝트 루트로 복사.

## Key Files

- `src/main.ts` — 플러그인 엔트리포인트
- `src/PdfAnnotatorView.ts` — PDF 뷰어 메인 뷰
- `src/PdfRenderer.ts` — pdf.js 렌더링
- `src/AnnotationLayer.ts` — 하이라이트 오버레이 레이어
- `src/AnnotationStore.ts` — JSON 사이드카 파일 저장/로드
- `src/HighlightManager.ts` — 텍스트 선택 및 하이라이트 로직
- `src/ColorPicker.ts` — 색상 선택 UI
- `src/NoteModal.ts` — 노트 입력 모달
- `src/types.ts` — 타입 정의
