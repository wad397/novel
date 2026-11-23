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

const SEED_HEAD = '떠올린 장면·에피소드';
const SEED_HINT = '떠오른 장면이나 에피소드를 생각날 때마다 한 줄씩 더해요. 언제 나올지 적어 두면 AI가 그때까지 이어지게 깔아 두고, 비워 두면 어울리는 화에 넣어요. 쓴 장면은 나오는 때에 "12화에 씀"처럼 적어 두세요.';
const SEED_COLS = '| 장면 | 나오는 때 (처음 / 중간 / 결말 / N화쯤, 비워도 돼요) | 그 전에 깔아 둘 것 |';
const SEED_BLOCK = `## 2. ${SEED_HEAD}

${SEED_HINT}

${SEED_COLS}
|---|---|---|
|  |  |  |
`;
// 앞서 넣었던 "처음 떠올린 장면" 칸의 제목·안내·머리줄. 적어 둔 줄은 그대로 두고 이것만 새 것으로 바꾼다.
const SEED_OLD = [
  ['처음 떠올린 장면', SEED_HEAD],
  ['이 작품을 떠올리게 한 장면이에요. 꼭 첫 화일 필요는 없어요. 언제 나올지 적어 두면 AI가 그때까지 이 장면으로 이어지게 깔아 둬요.', SEED_HINT],
  ['| 장면 | 나오는 때 (처음 / 중간 / 결말 / N화쯤) | 그 전에 깔아 둘 것 |', SEED_COLS],
];

// 예전 작품 설정에 "떠올린 장면·에피소드" 칸을 인물 카드 앞에 끼워 넣고 뒤 번호를 하나씩 민다.
// 인물 카드 제목이 없으면 맨 끝에 붙인다.
export function addSeedScene(text) {
  if (text.includes(SEED_OLD[0][0])) return SEED_OLD.reduce((t, [a, b]) => t.replace(a, b), text);
  if (text.includes(SEED_HEAD)) return text;
  const at = text.search(/^## \d+\. 인물 카드/m);
  if (at < 0) return `${text.replace(/\s*$/, '\n\n')}${SEED_BLOCK.replace('## 2. ', '## ')}`;
  const rest = text.slice(at).replace(/^## (\d+)\. /gm, (_, n) => `## ${Number(n) + 1}. `);
  return `${text.slice(0, at)}${SEED_BLOCK}\n${rest}`;
}

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

${SEED_BLOCK}
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

// 인물 설정(인물.md): 인물마다 카드 하나. 카드 안 표의 이름표를 예전 인물 카드 표의 칸 이름과 맞춰 둬서 옮길 때 그대로 채운다.
const CAST_PARTS = [
  ['기본', ['이름', '역할', '나이 / 학년·직업', '성별', '원하는 것', '두려워하는 것 / 약점']],
  ['생김새 (이것만 보고 그림을 그릴 수 있게)', ['키 / 체격', '얼굴형 / 피부', '눈 (모양·색·인상)', '눈썹·코·입', '머리 (색·길이·모양)', '평소 옷차림', '자주 짓는 표정 / 자세', '첫인상 한 줄']],
  ['몸 특이사항', ['흉터·점·문신 (위치까지)', '안경·손잡이·시력', '건강·장애·체질', '목소리', '몸에 밴 버릇']],
  ['성격과 말투', ['성격 한 줄', '말버릇 / 말투', '예시 대사', '절대 안 하는 행동', '특이점']],
  ['아는 것과 모르는 것', ['관심 분야와 수준', '잘 아는 것', '모르는 것 / 틀리게 아는 것', '아는 걸 쓰는 버릇']],
];
const CAST_ALIAS = { '나이 / 학년·직업': '직업' }; // 예전 칸 이름
// 관계는 "상대 | 관계" 표. 상대 칸에 다른 카드의 이름이나 제목을 적으면 관계도에서 선으로 잇는다.
const REL_HEAD = '### 다른 인물과의 관계';
const REL_HINT = '상대 칸에 인물 카드 이름을 그대로 적으면 관계도에서 선으로 이어져요.';
const REL_COLS = ['상대', '관계'];
const relBlock = () => `${REL_HEAD}\n\n${REL_HINT}\n\n| 상대 | 관계 |\n|---|---|\n|  |  |\n`;
const castCard = (p = {}) => `## ${p['이름']?.trim() || '인물'}

${CAST_PARTS.map(([part, rows], i) => `### ${part}

| 항목 | 내용 |
|---|---|
${rows.map((r) => `| ${r} | ${(p[r] ?? p[CAST_ALIAS[r]] ?? '').trim()} |`).join('\n')}
${i === 0 ? `\n${relBlock()}` : ''}`).join('\n')}
### 이야기 중에 새로 알게 된 것·바뀐 것

"23화: 상담 선생님에게 '투사'를 배움", "40화: 왼손에 화상"처럼 화와 함께 적어요.

-
`;
const CAST_HEAD = `# 인물 설정

인물마다 카드 하나예요. 생김새와 몸 특이사항은 그림을 그릴 수 있을 만큼 자세히 적을수록 좋아요. 빈칸은 비워 둬도 돼요.

`;
export const CAST_CARD = castCard();
export const castTemplate = (people = []) => CAST_HEAD + (people.length ? people : [{}]).map(castCard).join('\n');

// 인물 설정 덩어리(parseDoc)에서 k번째 카드("## " 제목부터 다음 "## " 또는 "# " 앞까지)의 [시작, 끝]. 없으면 [0, 0].
export function cardRange(blocks, k) {
  const starts = blocks.map((b, i) => (/^##\s/.test(b.head ?? '') ? i : -1)).filter((i) => i >= 0);
  if (!(k in starts)) return [0, 0];
  const end = blocks.findIndex((b, i) => i > starts[k] && /^##?\s/.test(b.head ?? ''));
  return [starts[k], end < 0 ? blocks.length : end];
}

// 카드 목록: 제목과 이름·역할
export function castCards(blocks) {
  const out = [];
  for (let k = 0; ; k++) {
    const [from, to] = cardRange(blocks, k);
    if (from === to) return out;
    const rows = blocks.slice(from, to).flatMap((b) => (b.cols?.length === 2 ? b.rows : []));
    const get = (key) => rows.find((r) => r[0] === key)?.[1] ?? '';
    const title = blocks[from].head.replace(/^##\s*/, '');
    out.push({ title: title === '인물' && get('이름') ? get('이름') : title, name: get('이름'), role: get('역할') }); // 제목을 안 바꾼 카드는 이름으로
  }
}

// 관계 표가 없는 예전 카드에 끼워 넣는다. 기본 표의 "다른 인물과의 관계" 줄은 빼서 관계 칸으로 옮긴다.
export function addRelations(text) {
  const blocks = parseDoc(text);
  let changed = false;
  for (let k = 0; ; k++) {
    const [from, to] = cardRange(blocks, k);
    if (from === to) break;
    const card = blocks.slice(from, to);
    if (card.some((b) => b.head === REL_HEAD)) continue;
    const basic = card.find((b) => b.cols?.[0] === '항목' && b.rows.some((r) => r[0] === '이름'));
    const i = basic ? basic.rows.findIndex((r) => r[0] === '다른 인물과의 관계') : -1;
    const old = i >= 0 ? basic.rows.splice(i, 1)[0][1] : '';
    blocks.splice(basic ? blocks.indexOf(basic) + 1 : from + 1, 0, { head: REL_HEAD }, { text: REL_HINT }, { cols: REL_COLS, rows: [['', old]] });
    changed = true;
  }
  return changed ? formatDoc(blocks) : text;
}

// 관계도: 카드마다 점 하나, 관계 표 한 줄마다 화살표 하나. 상대가 카드에 없으면 카드 밖 점(key "?이름")으로.
export function castRelations(blocks) {
  const cards = castCards(blocks).map((c, k) => ({ ...c, key: String(k), card: k }));
  const find = (who) => cards.find((c) => [c.name, c.title].includes(who))
    ?? cards.find((c) => c.title.startsWith(who) || (c.name && who.startsWith(c.name)));
  const nodes = [...cards], edges = [];
  for (const c of cards) {
    const [from, to] = cardRange(blocks, c.card);
    const card = blocks.slice(from, to);
    const at = card.findIndex((b) => b.head === REL_HEAD);
    const table = at < 0 ? null : card.slice(at).find((b) => b.cols?.[0] === REL_COLS[0]);
    for (const [who = '', what = ''] of table?.rows ?? []) {
      const name = who.trim();
      if (!name) continue;
      let n = find(name) ?? nodes.find((x) => x.key === `?${name}`);
      if (!n) nodes.push(n = { key: `?${name}`, title: name, name, role: '', card: null });
      if (n !== c) edges.push({ from: c.key, to: n.key, label: what.trim() });
    }
  }
  return { nodes, edges };
}

// 예전 작품 설정의 "인물 카드" 칸을 떼어 낸다. 뒤 칸 번호는 하나씩 당긴다. 칸이 없으면 null.
export function takeCast(memo) {
  const m = /^## \d+\. 인물 카드[^\n]*\n[\s\S]*?(?=^## |(?![\s\S]))/m.exec(memo);
  if (!m) return null;
  const table = parseDoc(m[0]).find((b) => b.cols);
  const people = (table?.rows ?? []).filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(table.cols.map((c, k) => [c, r[k]])));
  const rest = memo.slice(m.index + m[0].length).replace(/^## (\d+)\. /gm, (_, n) => `## ${n - 1}. `);
  return { memo: memo.slice(0, m.index) + rest, people };
}

// Claude에게 보낼 인물 설정: 빈칸, 안내 글, 내용 없는 제목은 뺀다
export function castBrief(text) {
  const out = [];
  for (const b of parseDoc(text)) {
    if (b.head) out.push(b);
    else if (b.text !== undefined) {
      const t = b.text.split('\n').filter((l) => /^\s*-\s*\S/.test(l)).join('\n');
      if (t) out.push({ text: t });
    } else {
      const rows = b.rows.filter((r) => (b.cols[0] === '항목' ? r.slice(1) : r).some(Boolean));
      if (rows.length) out.push({ ...b, rows });
    }
  }
  const level = (h) => /^#+/.exec(h)[0].length;
  const kept = out.filter((b, i) => {
    if (!b.head) return true;
    for (const n of out.slice(i + 1)) {
      if (!n.head) return true;
      if (level(n.head) <= level(b.head)) return false;
    }
    return false;
  });
  return kept.length ? formatDoc(kept).trim() : '';
}

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

// 붙여 넣은 목록 기호(•, ·, *, 띄어쓰기 없는 -)를 "- "로 맞춘다. 칸 화면은 "- "만 목록으로 본다.
export const tidyNote = (text) => text.replace(/^[ \t]*(?:[•·▪◦]|\*(?=\s)|-(?=[^\s-]))[ \t]*/gm, '- ');

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

// 지난 화 설정을 짧게: 채운 표 칸은 "항목: 내용", 목록은 그대로. 안내 문구와 빈칸은 뺀다.
// full이 아니면 뒤 화에도 이어지는 것(일어난 일과 정해 둔 설정 목록)만 남긴다.
const noteBrief = (num, text, full) => {
  const keep = full ? (k) => k !== '몇 화' : (k) => k === '이번 화에서 일어날 일';
  const lines = parseDoc(tidyNote(text)).flatMap((b) => {
    if (b.rows) return b.rows.filter((r) => keep(r[0]) && r.slice(1).some(Boolean)).map((r) => `- ${r[0]}: ${r.slice(1).filter(Boolean).join(' / ')}`);
    return b.text !== undefined ? b.text.split('\n').filter((l) => /^- \S/.test(l)) : [];
  });
  return lines.length ? `${num}화\n${lines.join('\n')}` : '';
};
const joinBriefs = (list, full) => list.map(({ num, text }) => noteBrief(num, text, full)).filter(Boolean).join('\n\n');

// 요약 파일 첫 줄 "# 1~12화 요약"에서 몇 화까지 요약했는지 읽는다. 없으면 0.
export const summaryUpto = (s) => Number(/^#\s*1\s*~\s*(\d+)\s*화\s*요약/m.exec(s)?.[1] ?? 0);

// Claude에게 보낼 지난 화 설정. 최근 recent화는 전부, 그 전은 Claude 요약으로.
// 요약이 아직 못 따라온 오래된 화는 규칙으로 줄여서 덧붙인다.
// notes: [{ num, text }] 번호 순
export function pastNotes(notes, recent = 10, summary = '') {
  const cut = Math.max(0, notes.length - recent);
  const now = joinBriefs(notes.slice(cut), true);
  if (!cut) return now;
  let upto = summaryUpto(summary);
  // 예전 화를 고칠 때는 요약에 그 뒤 일까지 들어 있으니 쓰지 않는다
  if (upto > notes[notes.length - 1].num) { summary = ''; upto = 0; }
  const old = [summary.trim(), joinBriefs(notes.slice(0, cut).filter((n) => n.num > upto), false)].filter(Boolean).join('\n\n');
  return `(오래된 화: 중요한 것만)\n\n${old}\n\n(최근 ${notes.length - cut}화: 전부)\n\n${now}`;
}

// 오래된 화(최근 recent화 앞) 요약을 Claude에게 부탁하는 글. 이미 요약한 화는 요약으로, 그 뒤 화만 새로 보낸다.
// 요약할 화가 없으면 null.
export function summaryPrompt({ work, memo, summary = '', notes, recent = 10 }) {
  const cut = notes.length - recent;
  if (cut <= 0) return null;
  const upto = notes[cut - 1].num, done = summaryUpto(summary);
  const add = notes.slice(0, cut).filter((n) => n.num > done);
  if (!add.length) return null;
  return [
    `[요청]\n웹소설 「${work}」의 ${upto}화까지 회차 설정을 하나로 요약해줘. 뒤 화를 쓸 때 설정이 어긋나지 않게 하려는 거야.\n`
      + '- 앞으로도 지켜야 할 것만 남겨: 인물 관계와 사실, 이미 일어난 사건, 정해 둔 규칙, 아직 안 푼 떡밥.\n'
      + '- 그 화에만 쓰인 분위기, 빼고 싶은 것 같은 부탁은 빼.\n'
      + '- 작품 설정에 이미 있는 내용은 되풀이하지 마.\n'
      + '- "- "로 시작하는 짧은 목록으로, 주제별로 묶어줘.\n'
      + `- 답은 \`\`\`수정본 블록 하나에 담고, 첫 줄은 정확히 "# 1~${upto}화 요약"으로 써줘.`,
    `[작품 설정]\n${memo.trim() || '(없음)'}`,
    done && summary.trim() && `[지금까지 요약]\n${summary.trim()}\n\n이 요약에 아래 화를 합쳐서 새로 정리해줘.`,
    `[${add[0].num}~${upto}화 설정]\n${joinBriefs(add, true)}`,
  ].filter(Boolean).join('\n\n');
}

// Claude에게 보낼 질문 한 덩어리
export function buildPrompt({ concept, request, extra, work, episode, memo, cast = '', past = '', note = '', text }) {
  const people = castBrief(cast);
  return [
    concept.trim() && `[너의 역할]\n${concept.trim()}`,
    `[요청]\n${[request, extra.trim()].filter(Boolean).join('\n')}`,
    `[작품] ${work}\n[회차] ${episode}`,
    `[설정 메모]\n${memo.trim() || '(없음)'}`,
    people && `[인물 설정]\n${people}`,
    past.trim() && `[지난 화 설정]\n${past.trim()}`,
    note.trim() && `[이번 화 설정]\n${note.trim()}`,
    `[본문]\n${text}`,
    '[답하는 방법]\n'
      + (memo.includes(SEED_HEAD) || memo.includes(SEED_OLD[0][0]) ?`- 작품 설정의 '${SEED_HEAD}'는 작가가 생각날 때마다 모아 두는 장면 목록이야. 줄마다 '나오는 때'를 지켜줘. `
        + `그때가 오기 전에는 그 장면을 미리 쓰거나 당겨 오지 말고, 그 장면에 힘이 실리도록 '그 전에 깔아 둘 것'을 조금씩 심어줘. `
        + `'나오는 때'가 비어 있으면 이야기 흐름에 자연스럽게 맞는 화에 넣되, 억지로 끼우거나 한 화에 여러 개를 몰아넣지 마. `
        + `'12화에 씀'처럼 이미 쓴 장면은 다시 쓰지 마. 목록의 장면이 나오는 화라면 그 장면을 가장 공들여 쓰고, 코드 블록 밖에 어떤 장면을 썼는지 짧게 알려줘.\n` : '')
      + (people ? "- [인물 설정]의 생김새, 몸 특이사항, 말투를 그대로 지켜줘. 인물은 '아는 것과 모르는 것', '이야기 중에 새로 알게 된 것·바뀐 것' 안에서만 말하고 판단해. "
        + '모른다고 적힌 건 아는 척하지 말고, 안다고 적힌 건 모르는 척하지 마. 적혀 있지 않은 지식은 그 나이, 직업, 관심 수준에서 자연스러운 만큼만 써. '
        + "이번 화에서 인물이 새로 알게 된 것이나 바뀐 생김새(상처, 머리 모양 등)가 있으면 코드 블록 밖에 '인물 설정에 더할 것'으로 짧게 알려줘.\n" : '')
      + '- 요청한 내용이 설정 메모, 인물 설정, 지난 화 설정과 어긋나면, 답 맨 앞에 어느 설정과 어떻게 부딪히는지 먼저 짧게 알려줘. 원고는 이미 정해진 설정을 따라.\n'
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
