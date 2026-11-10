# 소설 집필 웹 편집기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 구글 드라이브에 회차별 .md로 저장하는 모바일 대응 웹 편집기.
**Architecture:** 빌드 없는 정적 페이지(ES 모듈). `logic.js`(순수 함수) / `drive.js`(Drive REST) / `app.js`(화면·해시 라우팅). GitHub Pages 호스팅.
**Tech Stack:** HTML/CSS/바닐라 JS, Google Identity Services 토큰 클라이언트, Drive API v3, Node 내장 `node:test`.
**Spec:** `docs/superpowers/specs/2026-11-10-novel-editor-design.md`

## Global Constraints
- 권한 범위: `https://www.googleapis.com/auth/drive.file`
- 최상위 폴더 이름: `내소설`, 작품 폴더 안에 `설정.md` + `NNN - 제목.md`
- 자동 저장: 입력 멈춘 뒤 2000ms, 화면 숨김 시 즉시
- 충돌 사본 이름: `NNN - 제목 (충돌 YYYY-MM-DD HH-mm).md`
- 말없이 덮어쓰기 금지

## Review Focus
- 제목에 `'`, `/`, `\` 포함 → 검색 쿼리 깨짐/경로 문제 없이 저장 (escapeQuery, sanitizeTitle 테스트)
- 로그인 만료(401) 중 입력 → 글이 브라우저 임시 보관에 남고 재로그인 후 저장
- 다른 기기에서 먼저 수정 → 사본 생성, 원본 유지 (isConflict 테스트)
- 회차 번호 999 초과·빈 목록 → nextEpisodeNumber가 1 / 정상 증가
- 탭 닫기 직전 미저장 → beforeunload 경고

---

### Task 1: 순수 로직 (`logic.js`, `test/logic.test.mjs`)
**Produces:** `episodeFileName(num:number, title:string):string`, `parseEpisodeName(name):{num,title}|null`, `nextEpisodeNumber(names:string[]):number`, `conflictFileName(name, date:Date):string`, `countChars(text):{withSpaces,withoutSpaces}`, `isConflict(known:string, current:string):boolean`, `escapeQuery(s):string`, `sanitizeTitle(s):string`
- [ ] 테스트: `episodeFileName(3,'시작')==='003 - 시작.md'`; `parseEpisodeName('012 - 밤.md')` → `{num:12,title:'밤'}`; `parseEpisodeName('설정.md')===null`; `nextEpisodeNumber([])===1`, `(['001 - a.md','007 - b.md','설정.md'])===8`; `conflictFileName('001 - a.md', new Date(2026,10,10,21,30))==='001 - a (충돌 2026-11-10 21-30).md'`; `countChars('가 나\n다')` → `{withSpaces:5, withoutSpaces:3}`; `isConflict('t1','t2')===true`, `('t1','t1')===false`; `escapeQuery("a'b\\c")==="a\\'b\\\\c"`; `sanitizeTitle(' a/b\\c ')==='abc'`, `sanitizeTitle('  ')==='제목 없음'`
- [ ] `node --test test/` 실패 확인 → 구현 → 통과 확인 → 커밋

### Task 2: Drive 연동 (`drive.js`)
**Consumes:** `escapeQuery`. **Produces:** `setToken(t)`, `findOrCreateFolder(name, parentId='root')→id`, `listChildren(folderId)→[{id,name,mimeType,modifiedTime}]`, `readText(id)→string`, `getMeta(id)→{id,name,modifiedTime}`, `createText(name, parentId, text)→meta`, `updateText(id, text)→meta`, `rename(id,name)→meta`, `trash(id)`. 401이면 `err.status===401`로 throw.
- [ ] 실제 계정 없이는 테스트 불가 → 브라우저 확인 단계(Task 4)에서 확인

### Task 3: 화면 (`index.html`, `style.css`, `app.js`)
**Consumes:** Task 1, 2. 해시 라우트 `#/`, `#/n/<folderId>`, `#/e/<folderId>/<fileId>`. `CLIENT_ID` 상수 미설정 시 설정 안내 표시.
- 작품: 만들기(폴더 + 빈 `설정.md`). 회차: 새 회차, 제목 변경(번호 유지), 휴지통.
- 편집기: 저장 상태 표시, 글자 수, 2초 자동 저장, `localStorage['draft:'+fileId]` 임시 보관 → 열 때 복구 제안, 충돌 시 사본 생성 후 사본으로 전환하고 알림.
- [ ] 로컬 서버에서 화면·모바일 폭 확인 → 커밋

### Task 4: 안내서 (`README.md`) + 배포
- [ ] 구글 클라우드 설정, GitHub Pages 켜기, Claude와 함께 쓰는 법 → 커밋·푸시
