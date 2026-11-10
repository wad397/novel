import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  episodeFileName, parseEpisodeName, nextEpisodeNumber, conflictFileName,
  countChars, isConflict, escapeQuery, sanitizeTitle,
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

test('글자 수', () => {
  assert.deepEqual(countChars('가 나\n다'), { withSpaces: 5, withoutSpaces: 3 });
  assert.deepEqual(countChars(''), { withSpaces: 0, withoutSpaces: 0 });
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
