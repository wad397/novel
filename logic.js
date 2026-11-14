// 드라이브·화면과 무관한 순수 함수. test/logic.test.mjs에서 검사한다.

const EPISODE = /^(\d+) - (.*)\.md$/;

export const episodeFileName = (num, title) => `${String(num).padStart(3, '0')} - ${title}.md`;

export function parseEpisodeName(name) {
  const m = EPISODE.exec(name);
  return m ? { num: Number(m[1]), title: m[2] } : null;
}

export const nextEpisodeNumber = (names) =>
  Math.max(0, ...names.map((n) => parseEpisodeName(n)?.num ?? 0)) + 1;

// 회차별 설정 파일. 번호로 회차와 짝을 지어서 회차 제목을 바꿔도 따라간다.
export const episodeNoteName = (num) => `${String(num).padStart(3, '0')} 설정.md`;
export const parseNoteName = (name) => { const m = /^(\d+) 설정\.md$/.exec(name); return m ? Number(m[1]) : null; };

export const WORK_TEMPLATE = `# 작품 설정

작품마다 한 번만 채워요. 빈칸은 비워 둬도 돼요.

## 1. 작품 기본 정보

| 항목 | 내용 |
|---|---|
| 가제 |  |
| 장르 |  |
| 핵심 재미 (한 줄) |  |
| 주인공이 끝까지 원하는 것 |  |
| 참고작 / 비슷한 느낌 |  |
| 회당 분량 |  |
| 시점 |  |
| 피하고 싶은 것 |  |

## 2. 인물 카드

이름이나 외모보다 말버릇과 고집이 더 중요해요.

| 이름 | 역할 | 원하는 것 | 말버릇 / 말투 | 절대 안 하는 행동 | 직업 | 특이점 |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

## 3. 꼭 지켜야 할 설정

-

## 4. 앞으로의 끝 장면 메모

마지막 장면만 미리 정해 두면 그 화는 거기로 가기만 하면 돼요.

| 화 | 끝 장면 한 줄 |
|---|---|
| 1 |  |
| 2 |  |
| 3 |  |

## 5. 받은 원고 피드백

-
`;

export const episodeTemplate = (num) => `# ${num}화 설정

## 1. 회차 요청서

| 항목 | 내용 |
|---|---|
| 몇 화 | ${num}화 |
| 직전 화가 끝난 상황 |  |
| 이번 화에서 일어날 일 |  |
| 마지막 장면 (다음 화를 누르게 할 장면) |  |
| 꼭 넣고 싶은 장면이나 대사 |  |
| 이번 화 분위기 |  |
| 이번 화에서 빼고 싶은 것 |  |

## 2. 이번 화 설정

이번 화에 처음 나오거나 꼭 지켜야 할 설정만 적어요.

-
`;

// 마크다운 표 한 줄을 칸으로. 구분선(|---|)이면 null.
// shortcut: 칸 안의 \| 는 처리하지 않는다, 내용에 | 를 쓸 일이 생기면 고친다
export const tableCells = (line) =>
  (/^[\s|:]*-[\s|:-]*$/.test(line) ? null : line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));

// 설정 파일을 덩어리로 나눈다: 제목 { head }, 표 { cols, rows }, 그 밖의 글 { text }
export function parseDoc(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const isHead = (l) => /^#+\s/.test(l);
  const isRow = (l) => l.trimStart().startsWith('|');
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { i++; continue; }
    if (isHead(lines[i])) { blocks.push({ head: lines[i++] }); continue; }
    const table = isRow(lines[i]);
    const block = [];
    while (i < lines.length && lines[i].trim() && !isHead(lines[i]) && isRow(lines[i]) === table) block.push(lines[i++]);
    if (!table) { blocks.push({ text: block.join('\n') }); continue; }
    const [cols, ...rows] = block.map(tableCells).filter(Boolean);
    // 칸 수가 모자라거나 넘치는 줄은 제목 줄에 맞춘다
    blocks.push({ cols, rows: rows.map((r) => cols.map((_, k) => r[k] ?? '')) });
  }
  return blocks;
}

// 칸에 적은 글을 표 한 칸에 넣을 수 있게: 줄바꿈은 띄어쓰기로, | 는 / 로
const cell = (v) => v.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '/').trim();
const row = (cells) => `| ${cells.map(cell).join(' | ')} |`;

export const formatDoc = (blocks) => blocks.map((b) =>
  b.head ?? b.text ?? [row(b.cols), `|${b.cols.map(() => '---').join('|')}|`, ...b.rows.map(row)].join('\n')).join('\n\n') + '\n';

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

// 두 배열의 차이. [{ t: '=' | '-' | '+', v }]
// 앞뒤의 같은 부분을 먼저 떼고 가운데만 LCS로 비교한다.
export function diff(a, b) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const A = a.slice(s, ea), B = b.slice(s, eb);
  const mid = [];
  if (A.length * B.length > 4e6) {
    // shortcut: 바뀐 부분이 아주 크면 통째로 지우고 넣은 것으로 본다
    A.forEach((v) => mid.push({ t: '-', v }));
    B.forEach((v) => mid.push({ t: '+', v }));
  } else {
    const L = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
    for (let i = A.length - 1; i >= 0; i--) {
      for (let j = B.length - 1; j >= 0; j--) {
        L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < A.length || j < B.length) {
      if (i < A.length && j < B.length && A[i] === B[j]) { mid.push({ t: '=', v: A[i] }); i++; j++; }
      else if (j < B.length && (i === A.length || L[i][j + 1] > L[i + 1][j])) mid.push({ t: '+', v: B[j++] });
      else mid.push({ t: '-', v: A[i++] });
    }
  }
  return [
    ...a.slice(0, s).map((v) => ({ t: '=', v })),
    ...mid,
    ...a.slice(ea).map((v) => ({ t: '=', v })),
  ];
}

// Claude 답에서 ```수정본 / ```이어쓰기 블록을 꺼낸다. 없으면 붙여 넣은 글 전체.
export function extractRevision(pasted) {
  const m = /```(수정본|이어쓰기)[^\n]*\n([\s\S]*?)\n?```/.exec(pasted);
  if (m) return { mode: m[1] === '수정본' ? 'replace' : 'append', body: m[2].trim() };
  return { mode: null, body: pasted.trim() };
}

// Claude에게 보낼 질문 한 덩어리
export function buildPrompt({ concept, request, extra, work, episode, memo, note = '', text }) {
  return [
    concept.trim() && `[너의 역할]\n${concept.trim()}`,
    `[요청]\n${[request, extra.trim()].filter(Boolean).join('\n')}`,
    `[작품] ${work}\n[회차] ${episode}`,
    `[설정 메모]\n${memo.trim() || '(없음)'}`,
    note.trim() && `[이번 화 설정]\n${note.trim()}`,
    `[본문]\n${text}`,
    '[답하는 방법]\n'
      + '- 원고를 고쳐 달라는 요청이면 설명은 짧게 하고, 고친 회차 전체를 ```수정본 으로 시작하는 코드 블록 하나에 담아줘. 고치지 않은 문장도 빠짐없이 그대로 넣어줘.\n'
      + '- 이어 쓸 장면을 부탁하면 새로 쓴 부분만 ```이어쓰기 로 시작하는 코드 블록 하나에 담아줘.\n'
      + '- 피드백이나 검토만 부탁하면 코드 블록 없이 답해줘.',
  ].filter(Boolean).join('\n\n');
}

export const isConflictCopy = (name) => / \(충돌 [^)]*\)\.md$/.test(name);

// 내보낼 글. eps: [{ title, text }]. work가 있으면 작품 제목을 맨 위에 두고 회차 제목을 한 단계 내린다.
export function exportText(eps, fmt, work = '') {
  const head = (t, lv) => (fmt === 'md' ? `${'#'.repeat(lv)} ${t}` : t);
  const parts = eps.map((e) => `${head(e.title, work ? 2 : 1)}\n\n${e.text.trim()}`);
  return [work && head(work, 1), ...parts].filter(Boolean).join(fmt === 'md' ? '\n\n' : '\n\n\n') + '\n';
}

export const isConflict = (knownModified, currentModified) => knownModified !== currentModified;

// Drive 검색식(q)의 작은따옴표 문자열 안에 넣을 값
export const escapeQuery = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export const sanitizeTitle = (s) => s.replace(/[\\/]/g, '').trim() || '제목 없음';
