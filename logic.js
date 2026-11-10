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

// 분량 세기. opts: { unit: 'chars'|'words'|'sentences'|'bytes', noSpaces, noPunct, noSymbols, noComments }
export function countText(text, { unit = 'chars', noSpaces, noPunct, noSymbols, noComments } = {}) {
  if (noComments) text = text.split('\n').filter((line) => !line.trimStart().startsWith('//')).join('\n');
  if (unit === 'sentences') {
    return text.split(/[.!?。？！…]+|\n+/).filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
  }
  let t = text;
  if (noPunct) t = t.replace(/\p{P}/gu, '');
  if (noSymbols) t = t.replace(/\p{S}/gu, '');
  if (unit === 'words') return t.split(/\s+/).filter(Boolean).length;
  t = t.replace(/\r?\n/g, ''); // 줄바꿈은 분량에 넣지 않는다
  if (noSpaces) t = t.replace(/\s/g, '');
  return unit === 'bytes' ? new TextEncoder().encode(t).length : [...t].length;
}

// 입력 보조. 키 하나를 눌렀을 때 바꿀 내용을 돌려준다. 바꿀 게 없으면 null.
// opts: { autoQuotes, smartQuotes, autoBrackets, smartBrackets, divider }
// 반환: text의 [from, to)를 insert로 바꾸고 커서를 cursor에 둔다.
const QUOTES = { '"': ['“', '”'], "'": ['‘', '’'] };
const BRACKETS = { '(': ')', '[': ']', '{': '}' };
const CLOSING_QUOTES = '”’"\'';
const CLOSING_BRACKETS = ')]}';
const DIVIDER = /^(-{3,}|—{2,}|\*{3,})$/;

export function assist(text, start, end, key, o) {
  const prev = text[start - 1] ?? '';
  const next = text[end] ?? '';
  const sel = text.slice(start, end);
  const put = (insert, cursor) => ({ from: start, to: end, insert, cursor: start + cursor });

  if (key in QUOTES && (o.autoQuotes || o.smartQuotes)) {
    const [open, close] = o.autoQuotes ? QUOTES[key] : [key, key];
    if (!sel && next === close) return put('', 1); // 닫는 따옴표 건너뛰기
    const opening = !prev || /[\s(\[{“‘]/.test(prev);
    if (!opening) return o.autoQuotes ? put(close, 1) : null;
    if (o.smartQuotes) return put(open + sel + close, 1 + sel.length);
    return sel ? put(open + sel + close, 2 + sel.length) : put(open, 1);
  }
  if (key in BRACKETS && o.autoBrackets) return put(key + sel + BRACKETS[key], 1 + sel.length);
  if (CLOSING_BRACKETS.includes(key) && o.autoBrackets && !sel && next === key) return put('', 1);

  if (key === 'Enter' && !sel) {
    if (next && ((o.smartQuotes && CLOSING_QUOTES.includes(next)) || (o.smartBrackets && CLOSING_BRACKETS.includes(next)))) {
      return { from: start + 1, to: start + 1, insert: '\n', cursor: start + 2 };
    }
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    if (o.divider && (next === '' || next === '\n') && DIVIDER.test(text.slice(lineStart, start).trim())) {
      return { from: lineStart, to: start, insert: '* * *\n', cursor: lineStart + 6 };
    }
  }
  return null;
}

export const isConflict = (knownModified, currentModified) => knownModified !== currentModified;

// Drive 검색식(q)의 작은따옴표 문자열 안에 넣을 값
export const escapeQuery = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export const sanitizeTitle = (s) => s.replace(/[\\/]/g, '').trim() || '제목 없음';
