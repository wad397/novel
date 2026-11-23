import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  episodeFileName, parseEpisodeName, nextEpisodeNumber, conflictFileName,
  episodeNoteName, parseNoteName, episodeTemplate, WORK_TEMPLATE, addSeedScene, castTemplate, CAST_CARD, takeCast, castBrief, cardRange, castCards, addRelations, castRelations, parseDoc, formatDoc, tidyNote, pastNotes, summaryPrompt, summaryUpto, tableCells, isConflictCopy, exportText, countText, assist, diff, extractRevision, buildPrompt, isConflict, escapeQuery, sanitizeTitle,
} from '../logic.js';

test('회차 파일 이름', () => {
  assert.equal(episodeFileName(3, '시작'), '003 - 시작.md');
  assert.equal(episodeFileName(1234, '긴'), '1234 - 긴.md');
  assert.deepEqual(parseEpisodeName('012 - 밤.md'), { num: 12, title: '밤' });
  assert.deepEqual(parseEpisodeName('001 - a - b.md'), { num: 1, title: 'a - b' });
  assert.equal(parseEpisodeName('설정.md'), null);
});

test('다음 회차 번호', () => {
  assert.equal(nextEpisodeNumber([]), 1);
  assert.equal(nextEpisodeNumber(['001 - a.md', '007 - b.md', '설정.md']), 8);
});

test('충돌 사본 이름', () => {
  assert.equal(conflictFileName('001 - a.md', new Date(2026, 10, 10, 21, 30)), '001 - a (충돌 2026-11-10 21-30).md');
  assert.equal(conflictFileName('설정.md', new Date(2026, 0, 2, 3, 4)), '설정 (충돌 2026-01-02 03-04).md');
});

test('분량: 글자 수', () => {
  assert.equal(countText('가 나\n다', { unit: 'chars' }), 4); // 줄바꿈은 세지 않음
  assert.equal(countText('가 나\n다', { unit: 'chars', noSpaces: true }), 3);
  assert.equal(countText('안녕, 세상!', { unit: 'chars', noPunct: true }), 5);
  assert.equal(countText('안녕, 세상!', { unit: 'chars', noPunct: true, noSpaces: true }), 4);
  assert.equal(countText('가★나 ♥', { unit: 'chars', noSymbols: true }), 3);
  assert.equal(countText('', { unit: 'chars' }), 0);
});

test('분량: 단어·문장·용량', () => {
  assert.equal(countText('  하나 둘\n셋 ', { unit: 'words' }), 3);
  assert.equal(countText('하나 — 둘', { unit: 'words', noPunct: true }), 2);
  assert.equal(countText('첫 문장. 둘째 문장! 셋째', { unit: 'sentences' }), 3);
  assert.equal(countText('끝...', { unit: 'sentences' }), 1);
  assert.equal(countText('', { unit: 'sentences' }), 0);
  assert.equal(countText('가a', { unit: 'bytes' }), 4);
  assert.equal(countText('가 a', { unit: 'bytes', noSpaces: true }), 4);
});

test('충돌 판단', () => {
  assert.equal(isConflict('t1', 't2'), true);
  assert.equal(isConflict('t1', 't1'), false);
});

test('검색어 이스케이프와 제목 정리', () => {
  assert.equal(escapeQuery("a'b\\c"), "a\\'b\\\\c");
  assert.equal(sanitizeTitle(' a/b\\c '), 'abc');
  assert.equal(sanitizeTitle('  '), '제목 없음');
});

// assist(text, start, end, key, opts) → { from, to, insert, cursor } | null
const ON = { autoQuotes: true, smartQuotes: true, autoBrackets: true, smartBrackets: true, divider: true };
const apply = (text, start, end, key, opts = ON) => {
  const r = assist(text, start, end, key, opts);
  if (!r) return null;
  const out = text.slice(0, r.from) + r.insert + text.slice(r.to);
  return out.slice(0, r.cursor) + '|' + out.slice(r.cursor);
};

test('따옴표: 여는·닫는 모양과 쌍', () => {
  assert.equal(apply('', 0, 0, '"'), '“|”');
  assert.equal(apply('그가 ', 3, 3, '"'), '그가 “|”');
  assert.equal(apply('“안녕”', 3, 3, '”'), null); // 이미 모양 따옴표를 직접 친 경우는 그대로
  assert.equal(apply('“안녕”', 3, 3, '"'), '“안녕”|'); // 닫는 따옴표 앞에서 치면 건너뛴다
  assert.equal(apply("don", 3, 3, "'"), 'don’|'); // 글자 뒤 작은따옴표는 닫는 모양, 쌍 없음
  assert.equal(apply('안녕', 0, 2, '"'), '“안녕|”'); // 선택한 글을 감싼다
  assert.equal(apply('', 0, 0, '"', { autoQuotes: true }), '“|');
  assert.equal(apply('', 0, 0, '"', { smartQuotes: true }), '"|"');
  assert.equal(apply('', 0, 0, '"', {}), null);
});

test('괄호: 쌍 넣기, 닫는 괄호 건너뛰기', () => {
  assert.equal(apply('', 0, 0, '('), '(|)');
  assert.equal(apply('()', 1, 1, ')'), '()|');
  assert.equal(apply('가', 0, 1, '['), '[가|]');
  assert.equal(apply('', 0, 0, '(', {}), null);
});

test('엔터: 닫는 따옴표·괄호 밖으로', () => {
  assert.equal(apply('“안녕”', 3, 3, 'Enter'), '“안녕”\n|');
  assert.equal(apply('(메모)', 3, 3, 'Enter'), '(메모)\n|');
  assert.equal(apply('(메모)', 3, 3, 'Enter', { smartQuotes: true }), null);
  assert.equal(apply('안녕', 2, 2, 'Enter'), null);
});

test('엔터: 구분선 바꾸기', () => {
  assert.equal(apply('끝.\n----', 7, 7, 'Enter'), '끝.\n* * *\n|');
  assert.equal(apply('——', 2, 2, 'Enter'), '* * *\n|');
  assert.equal(apply('***', 3, 3, 'Enter'), '* * *\n|');
  assert.equal(apply('--', 2, 2, 'Enter'), null);
  assert.equal(apply('***', 3, 3, 'Enter', {}), null);
});

test('분량: // 메모 줄 빼기', () => {
  assert.equal(countText('가나\n// 복선 회수\n다', { unit: 'chars', noComments: true }), 3);
  assert.equal(countText('가나\n// 메모', { unit: 'sentences', noComments: true }), 1);
});

test('비교: 줄 단위 바뀐 곳', () => {
  const ops = diff(['가', '나', '다'], ['가', '나!', '다', '라']);
  assert.deepEqual(ops, [
    { t: '=', v: '가' }, { t: '-', v: '나' }, { t: '+', v: '나!' }, { t: '=', v: '다' }, { t: '+', v: '라' },
  ]);
  assert.deepEqual(diff([], []), []);
  assert.deepEqual(diff(['a'], []), [{ t: '-', v: 'a' }]);
});

test('수정본 꺼내기', () => {
  assert.deepEqual(extractRevision('설명입니다.\n```수정본\n첫 줄\n둘째 줄\n```\n끝'), { mode: 'replace', body: '첫 줄\n둘째 줄' });
  assert.deepEqual(extractRevision('```이어쓰기\n다음 장면\n```'), { mode: 'append', body: '다음 장면' });
  assert.deepEqual(extractRevision('  그냥 붙여 넣은 글  \n'), { mode: null, body: '그냥 붙여 넣은 글' });
});

test('질문 문구', () => {
  const p = buildPrompt({ concept: '윤 편집장', request: '피드백해줘', extra: '대사 위주로', work: '열람실의 유령', episode: '1화 프롤로그', memo: '', text: '본문' });
  assert.match(p, /^\[너의 역할\]\n윤 편집장/);
  assert.match(p, /\[요청\]\n피드백해줘\n대사 위주로/);
  assert.match(p, /\[설정 메모\]\n\(없음\)/);
  assert.match(p, /\[본문\]\n본문/);
  assert.match(p, /```수정본/);
  assert.doesNotMatch(buildPrompt({ concept: '', request: 'r', extra: '', work: 'w', episode: 'e', memo: 'm', text: 't' }), /너의 역할|이번 화 설정/);
  assert.match(buildPrompt({ concept: '', request: 'r', extra: '', work: 'w', episode: 'e', memo: 'm', note: '끝 장면', text: 't' }), /\[이번 화 설정\]\n끝 장면\n\n\[본문\]/);
});

test('회차별 설정 파일 이름', () => {
  assert.equal(episodeNoteName(3), '003 설정.md');
  assert.equal(parseNoteName('003 설정.md'), 3);
  assert.equal(parseNoteName('설정.md'), null);
  assert.equal(parseNoteName('003 - 설정.md'), null);
  assert.equal(parseEpisodeName(episodeNoteName(3)), null); // 회차 목록·번호 매기기에 끼지 않는다
  assert.match(episodeTemplate(3), /^# 3화 설정/);
  assert.match(episodeTemplate(3), /\| 몇 화 \| 3화 \|/);
});

test('표 한 줄 읽기', () => {
  assert.deepEqual(tableCells('| 가제 | 재능은 애매하지 않다 |'), ['가제', '재능은 애매하지 않다']);
  assert.deepEqual(tableCells('| 직전 화 |  |'), ['직전 화', '']);
  assert.equal(tableCells('|---|:--|'), null);
  assert.equal(tableCells('| --- | --- |'), null);
});

test('설정 파일을 덩어리로 읽고 다시 쓰기', () => {
  // 양식은 읽었다 써도 글자 하나 바뀌지 않는다
  assert.equal(formatDoc(parseDoc(WORK_TEMPLATE)), WORK_TEMPLATE);
  assert.equal(formatDoc(parseDoc(episodeTemplate(7))), episodeTemplate(7));
  const blocks = parseDoc('## 표\n| 항목 | 내용 |\n| --- | --- |\n| 가제 |  |\n| 모자란 줄 |\n\n- 메모\n');
  assert.deepEqual(blocks, [
    { head: '## 표' },
    { cols: ['항목', '내용'], rows: [['가제', ''], ['모자란 줄', '']] },
    { text: '- 메모' },
  ]);
  blocks[1].rows[0][1] = '첫 줄\n둘째 | 줄';
  assert.match(formatDoc(blocks), /\| 가제 \| 첫 줄 둘째 \/ 줄 \|/); // 표를 깨는 글자는 바꿔서 넣는다
});

test('내보내기', () => {
  const eps = [{ title: '1화 시작', text: '첫 문장\n\n둘째 문단\n' }, { title: '2화 밤', text: '밤이다' }];
  assert.equal(exportText([eps[0]], 'md'), '# 1화 시작\n\n첫 문장\n\n둘째 문단\n');
  assert.equal(exportText([eps[0]], 'txt'), '1화 시작\n\n첫 문장\n\n둘째 문단\n');
  assert.equal(exportText(eps, 'md', '작품'), '# 작품\n\n## 1화 시작\n\n첫 문장\n\n둘째 문단\n\n## 2화 밤\n\n밤이다\n');
  assert.equal(exportText(eps, 'txt', '작품'), '작품\n\n\n1화 시작\n\n첫 문장\n\n둘째 문단\n\n\n2화 밤\n\n밤이다\n');
  assert.ok(isConflictCopy('001 - 시작 (충돌 2026-11-14 10-30).md'));
  assert.ok(!isConflictCopy('001 - 시작.md'));
});

test('목록 기호 맞추기', () => {
  assert.equal(tidyNote('• 가\n-나\n* 다\n- 라\n-\n---\n| 항목 | 내용 |\n**굵게**'), '- 가\n- 나\n- 다\n- 라\n-\n---\n| 항목 | 내용 |\n**굵게**');
  assert.equal(tidyNote(episodeTemplate(2)), episodeTemplate(2));
  assert.equal(tidyNote(WORK_TEMPLATE), WORK_TEMPLATE);
});

test('지난 화 설정 모으기', () => {
  const one = episodeTemplate(1).replace('| 이번 화에서 일어날 일 |  |', '| 이번 화에서 일어날 일 | 환생 |').replace(/^-$/m, '-엄마는 화내지 않음');
  assert.equal(pastNotes([{ num: 1, text: one }, { num: 2, text: episodeTemplate(2) }]), '1화\n- 이번 화에서 일어날 일: 환생\n- 엄마는 화내지 않음');
  assert.equal(pastNotes([]), '');
  const p = buildPrompt({ concept: '', request: 'r', extra: '', work: 'w', episode: 'e', memo: 'm', past: '1화\n- 환생', note: 'n', text: 't' });
  assert.match(p, /\[지난 화 설정\]\n1화\n- 환생\n\n\[이번 화 설정\]/);
});

test('지난 화 설정: 최근 10화는 전부, 그 전은 중요한 것만', () => {
  const note = (n) => ({ num: n, text: `| 항목 | 내용 |\n|---|---|\n| 몇 화 | ${n}화 |\n| 이번 화에서 일어날 일 | 사건${n} |\n| 이번 화 분위기 | 밝게 |\n\n- 설정${n}\n` });
  const out = pastNotes(Array.from({ length: 12 }, (_, i) => note(i + 1)));
  assert.match(out, /^\((오래된 화: 중요한 것만)\)\n\n1화\n- 이번 화에서 일어날 일: 사건1\n- 설정1\n\n2화/);
  assert.match(out, /\(최근 10화: 전부\)\n\n3화\n- 이번 화에서 일어날 일: 사건3\n- 이번 화 분위기: 밝게\n- 설정3/);
  assert.equal((out.match(/분위기/g) || []).length, 10);
  assert.doesNotMatch(pastNotes([note(1), note(2)]), /중요한 것만|최근/);
});

test('오래된 화는 Claude 요약으로', () => {
  const note = (n) => ({ num: n, text: `| 항목 | 내용 |\n|---|---|\n| 이번 화에서 일어날 일 | 사건${n} |\n\n- 설정${n}\n` });
  const notes = Array.from({ length: 13 }, (_, i) => note(i + 1));
  assert.equal(summaryUpto('# 1~2화 요약\n- 요약'), 2);
  assert.equal(summaryUpto('그냥 메모'), 0);
  // 요약이 2화까지라 3화는 규칙으로 덧붙이고, 1~2화 원문은 빠진다
  const out = pastNotes(notes, 10, '# 1~2화 요약\n- 큰 줄기');
  assert.match(out, /^\((오래된 화: 중요한 것만)\)\n\n# 1~2화 요약\n- 큰 줄기\n\n3화\n- 이번 화에서 일어날 일: 사건3/);
  assert.doesNotMatch(out, /사건1\n|설정2\n/);
  // 부탁 글: 이미 요약한 1~2화는 요약으로, 3화만 새로
  const p = summaryPrompt({ work: 'w', memo: '', summary: '# 1~2화 요약\n- 큰 줄기', notes });
  assert.match(p, /첫 줄은 정확히 "# 1~3화 요약"/);
  assert.match(p, /\[지금까지 요약\]\n# 1~2화 요약/);
  assert.match(p, /\[3~3화 설정\]\n3화\n/);
  assert.doesNotMatch(p, /사건1\n/);
  assert.equal(summaryPrompt({ work: 'w', memo: '', notes: notes.slice(0, 10) }), null);
  assert.equal(summaryPrompt({ work: 'w', memo: '', summary: '# 1~3화 요약', notes }), null);
});

test('뒤 화까지 들어간 요약은 앞 화를 고칠 때 쓰지 않는다', () => {
  const notes = Array.from({ length: 12 }, (_, i) => ({ num: i + 1, text: `- 설정${i + 1}\n` }));
  assert.doesNotMatch(pastNotes(notes, 10, '# 1~13화 요약\n- 미래'), /미래/);
  assert.match(pastNotes(notes, 10, '# 1~13화 요약\n- 미래'), /1화\n- 설정1/);
});

test('처음 떠올린 장면 칸', () => {
  assert.match(WORK_TEMPLATE, /## 2\. 떠올린 장면·에피소드[\s\S]*## 3\. 꼭 지켜야 할 설정[\s\S]*## 5\. 받은 원고 피드백/);
  assert.equal(addSeedScene(WORK_TEMPLATE), WORK_TEMPLATE); // 이미 있으면 그대로
  // 예전 양식: 1~5번 → 장면 칸이 2번으로 들어가고 뒤가 하나씩 밀린다. 적어 둔 내용은 그대로.
  const old = '# 작품 설정\n\n## 1. 작품 기본 정보\n\n| 항목 | 내용 |\n|---|---|\n| 가제 | 용사 |\n\n## 2. 인물 카드\n\n| 이름 | 역할 |\n|---|---|\n| 닉스 | 친구 |\n\n## 3. 꼭 지켜야 할 설정\n\n-프리나는 회귀함\n';
  const up = addSeedScene(old);
  assert.match(up, /\| 가제 \| 용사 \|\n\n## 2\. 떠올린 장면·에피소드\n[\s\S]*\| 장면 \| 나오는 때[\s\S]*\n\n## 3\. 인물 카드\n\n\| 이름 \| 역할 \|\n\|---\|---\|\n\| 닉스 \| 친구 \|\n\n## 4\. 꼭 지켜야 할 설정\n\n-프리나는 회귀함\n$/);
  assert.match(addSeedScene('# 메모\n\n그냥 글'), /그냥 글\n\n## 떠올린 장면·에피소드\n/);
  // AI에게: 칸이 있을 때만 "때가 오기 전에는 당겨 쓰지 마"를 알려 준다
  const ask = (memo) => buildPrompt({ concept: '', request: 'r', extra: '', work: 'w', episode: 'e', memo, text: 't' });
  assert.match(ask(WORK_TEMPLATE), /'떠올린 장면·에피소드'는 작가가 생각날 때마다 모아 두는 장면 목록이야/);
  assert.doesNotMatch(ask('그냥 메모'), /떠올린 장면/);
});

test('앞서 넣은 "처음 떠올린 장면" 칸은 이름만 바뀌고 적은 줄은 남는다', () => {
  const before = '## 1. 작품 기본 정보\n\n## 2. 처음 떠올린 장면\n\n이 작품을 떠올리게 한 장면이에요. 꼭 첫 화일 필요는 없어요. 언제 나올지 적어 두면 AI가 그때까지 이 장면으로 이어지게 깔아 둬요.\n\n| 장면 | 나오는 때 (처음 / 중간 / 결말 / N화쯤) | 그 전에 깔아 둘 것 |\n|---|---|---|\n| 재회 | 결말 |  |\n\n## 3. 인물 카드\n';
  const after = addSeedScene(before);
  assert.match(after, /## 2\. 떠올린 장면·에피소드\n\n떠오른 장면이나 에피소드를 생각날 때마다[^\n]*\n\n\| 장면 \| 나오는 때 \(처음 \/ 중간 \/ 결말 \/ N화쯤, 비워도 돼요\) \| 그 전에 깔아 둘 것 \|\n\|---\|---\|---\|\n\| 재회 \| 결말 \|  \|\n\n## 3\. 인물 카드\n$/);
  assert.equal(addSeedScene(after), after);
  assert.match(buildPrompt({ concept: '', request: 'r', extra: '', work: 'w', episode: 'e', memo: after, text: 't' }), /'12화에 씀'처럼 이미 쓴 장면은 다시 쓰지 마/);
});

test('인물 설정: 양식, 예전 인물 카드 옮기기, Claude에게 보낼 글', () => {
  assert.doesNotMatch(WORK_TEMPLATE, /인물 카드/);
  const t = castTemplate();
  assert.equal(formatDoc(parseDoc(t)), t); // 칸 화면에서 고쳐도 모양이 그대로
  assert.match(t, /### 생김새[\s\S]*\| 눈 \(모양·색·인상\) \|[\s\S]*### 몸 특이사항[\s\S]*### 아는 것과 모르는 것[\s\S]*\| 모르는 것 \/ 틀리게 아는 것 \|[\s\S]*### 이야기 중에 새로 알게 된 것·바뀐 것/);
  assert.ok(t.endsWith(CAST_CARD));

  const memo = '# 작품 설정\n\n## 1. 작품 기본 정보\n\n| 항목 | 내용 |\n|---|---|\n| 가제 | 용사 |\n\n## 2. 인물 카드\n\n안내\n\n| 이름 | 역할 | 직업 | 특이점 |\n|---|---|---|---|\n| 닉스 | 친구 | 대장장이 | 왼손잡이 |\n|  |  |  |  |\n\n## 3. 꼭 지켜야 할 설정\n\n- 회귀함\n';
  const { memo: rest, people } = takeCast(memo);
  assert.equal(rest, '# 작품 설정\n\n## 1. 작품 기본 정보\n\n| 항목 | 내용 |\n|---|---|\n| 가제 | 용사 |\n\n## 2. 꼭 지켜야 할 설정\n\n- 회귀함\n');
  assert.equal(people.length, 1);
  const moved = castTemplate(people);
  assert.match(moved, /\| 이름 \| 닉스 \|\n\| 역할 \| 친구 \|\n\| 나이 \/ 학년·직업 \| 대장장이 \|/);
  assert.match(moved, /\| 특이점 \| 왼손잡이 \|/);
  assert.equal(takeCast('# 메모\n\n## 1. 끝\n'), null);
  assert.match(takeCast('## 4. 인물 카드\n\n| 이름 |\n|---|\n| 아 |\n').memo, /^$/);

  // 빈칸·안내·빈 제목은 빼고 보낸다
  const brief = castBrief(moved);
  assert.match(brief, /^# 인물 설정\n\n## 닉스\n\n### 기본\n\n\| 항목 \| 내용 \|\n\|---\|---\|\n\| 이름 \| 닉스 \|\n\| 역할 \| 친구 \|\n\| 나이 \/ 학년·직업 \| 대장장이 \|\n\n### 성격과 말투/);
  assert.doesNotMatch(brief, /생김새|성별|인물마다 카드|23화/);
  assert.equal(castBrief(castTemplate()), '');

  const ask = (cast) => buildPrompt({ concept: '', request: 'r', extra: '', work: 'w', episode: 'e', memo: 'm', cast, text: 't' });
  assert.match(ask(moved), /\[설정 메모\]\nm\n\n\[인물 설정\]\n# 인물 설정[\s\S]*모른다고 적힌 건 아는 척하지 말고/);
  assert.doesNotMatch(ask(castTemplate()), /인물 설정\]|아는 척/);
});

test('인물 카드 목록과 한 카드의 범위', () => {
  const blocks = parseDoc(`${castTemplate([{ 이름: '서윤', 역할: '주인공' }, { 이름: '닉스' }])}`.replace('## 서윤', '## 서윤 - 주인공'));
  assert.deepEqual(castCards(blocks), [{ title: '서윤 - 주인공', name: '서윤', role: '주인공' }, { title: '닉스', name: '닉스', role: '' }]);
  const [from, to] = cardRange(blocks, 1);
  assert.equal(blocks[from].head, '## 닉스');
  assert.equal(to, blocks.length);
  assert.ok(blocks.slice(from, to).every((b, i) => i === 0 || !/^##\s/.test(b.head ?? '')));
  assert.deepEqual(cardRange(blocks, 2), [0, 0]);
  assert.deepEqual(castCards(parseDoc('# 인물 설정\n\n안내\n')), []);
});

test('인물 관계: 예전 카드 옮기기와 관계도', () => {
  const old = '# 인물 설정\n\n## 서윤 - 주인공\n\n### 기본\n\n| 항목 | 내용 |\n|---|---|\n| 이름 | 서윤 |\n| 다른 인물과의 관계 | 닉스와 소꿉친구 |\n\n### 생김새\n\n| 항목 | 내용 |\n|---|---|\n| 키 / 체격 | 172cm |\n\n## 닉스\n\n### 기본\n\n| 항목 | 내용 |\n|---|---|\n| 이름 | 닉스 |\n';
  const up = addRelations(old);
  assert.match(up, /\| 이름 \| 서윤 \|\n\n### 다른 인물과의 관계\n\n[^\n]+\n\n\| 상대 \| 관계 \|\n\|---\|---\|\n\|  \| 닉스와 소꿉친구 \|\n\n### 생김새/);
  assert.doesNotMatch(up, /\| 다른 인물과의 관계 \|/);
  assert.equal(addRelations(up), up); // 두 번 해도 그대로
  assert.equal(addRelations('# 인물 설정\n\n안내\n'), '# 인물 설정\n\n안내\n');

  const filled = up.replace('|  | 닉스와 소꿉친구 |', '| 닉스 | 소꿉친구 |\n| 민호 | 라이벌 |\n| 서윤 | 자기 자신 |')
    .replace(/(## 닉스[\s\S]*\| 이름 \| 닉스 \|\n)/, '$1\n### 다른 인물과의 관계\n\n| 상대 | 관계 |\n|---|---|\n| 서윤 - 주인공 | 짝사랑 |\n');
  const { nodes, edges } = castRelations(parseDoc(filled));
  assert.deepEqual(nodes.map((n) => [n.key, n.title, n.card]), [['0', '서윤 - 주인공', 0], ['1', '닉스', 1], ['?민호', '민호', null]]);
  assert.deepEqual(edges, [
    { from: '0', to: '1', label: '소꿉친구' },
    { from: '0', to: '?민호', label: '라이벌' },
    { from: '1', to: '0', label: '짝사랑' },
  ]);
});

test('인물 사진 줄 넣기·바꾸기·빼기', async () => {
  const { castTemplate, parseDoc, cardPhoto, setCardPhoto, castBrief, castCards } = await import('../logic.js');
  const t0 = castTemplate([{ '이름': '서윤' }, { '이름': '닉스' }]);
  assert.equal(cardPhoto(parseDoc(t0), 1), null);
  const t1 = setCardPhoto(t0, 1, 'abc');
  assert.equal(cardPhoto(parseDoc(t1), 1), 'abc');
  assert.equal(cardPhoto(parseDoc(t1), 0), null);
  const t2 = setCardPhoto(t1, 1, 'xyz');
  assert.equal((t2.match(/사진: /g) || []).length, 1);
  assert.equal(cardPhoto(parseDoc(t2), 1), 'xyz');
  assert.ok(!castBrief(t2).includes('사진:')); // Claude에게는 안 보낸다
  assert.deepEqual(castCards(parseDoc(t2)).map((c) => c.title), ['서윤', '닉스']);
  assert.equal(setCardPhoto(t2, 1, null), t0);
});
