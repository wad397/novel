import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  episodeFileName, parseEpisodeName, nextEpisodeNumber, conflictFileName,
  countText, assist, isConflict, escapeQuery, sanitizeTitle,
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
