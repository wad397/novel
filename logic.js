// 드라이브·화면과 무관한 순수 함수. test/logic.test.mjs에서 검사한다.

const EPISODE = /^(\d+) - (.*)\.md$/;

export const episodeFileName = (num, title) => `${String(num).padStart(3, '0')} - ${title}.md`;

export function parseEpisodeName(name) {
  const m = EPISODE.exec(name);
  return m ? { num: Number(m[1]), title: m[2] } : null;
}

export const nextEpisodeNumber = (names) =>
  Math.max(0, ...names.map((n) => parseEpisodeName(n)?.num ?? 0)) + 1;

export function conflictFileName(name, date) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}-${p(date.getMinutes())}`;
  return `${name.replace(/\.md$/, '')} (충돌 ${stamp}).md`;
}

export const countChars = (text) => ({
  withSpaces: text.length,
  withoutSpaces: text.replace(/\s/g, '').length,
});

export const isConflict = (knownModified, currentModified) => knownModified !== currentModified;

// Drive 검색식(q)의 작은따옴표 문자열 안에 넣을 값
export const escapeQuery = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export const sanitizeTitle = (s) => s.replace(/[\\/]/g, '').trim() || '제목 없음';
