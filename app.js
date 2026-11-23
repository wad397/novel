import * as drive from './drive.js';
import {
  episodeFileName, parseEpisodeName, nextEpisodeNumber, conflictFileName,
  episodeNoteName, parseNoteName, WORK_TEMPLATE, addSeedScene, castTemplate, CAST_CARD, takeCast, cardRange, castCards, addRelations, castRelations, cardPhoto, setCardPhoto, isPhotoLine, episodeTemplate, parseDoc, formatDoc, tidyNote, pastNotes, summaryPrompt,
  countText, assist, diff, extractRevision, buildPrompt, isConflict, sanitizeTitle, isConflictCopy, exportText,
} from './logic.js';

// 구글 클라우드 콘솔에서 만든 OAuth 클라이언트 ID (README 참고)
const CLIENT_ID = '420828670170-ohu8mg6mndl2msllrgnb5tenbvvierag.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ROOT_NAME = '내소설';
const SETTINGS = '설정.md';
const SUMMARY = '요약.md';
const CAST = '인물.md';
const SAVE_DELAY = 2000;
const UNITS = { chars: ['글자 수', '자'], words: ['단어 수', '단어'], sentences: ['문장 수', '문장'], bytes: ['용량', '바이트'] };
const COUNT_KEY = 'count-settings';
const COUNT_DEFAULT = { unit: 'chars', noSpaces: false, noPunct: false, noSymbols: false, noComments: true, goal: 5000, celebrate: true };
const INPUT_KEY = 'input-settings';
const INPUT_DEFAULT = { autoQuotes: true, smartQuotes: true, autoBrackets: false, smartBrackets: false, divider: true };

const $app = document.getElementById('app');
const $banner = document.getElementById('login-banner');
let tokenClient, rootId;
let editing = null; // { folderId, fileId, name, modifiedTime, dirty, timer, saving, pending }

const epLabel = (name) => { const ep = parseEpisodeName(name); return `${ep.num}화 ${ep.title}`; };
const EXPORT_BUTTONS = '<button class="link" data-export="txt">txt로 내보내기</button><button class="link" data-export="md">md로 내보내기</button>';

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name.replace(/[\\/:*?"<>|]/g, ''); // 윈도우 파일 이름에 못 쓰는 글자
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const draftKey = (id) => `draft:${id}`;
const store = {
  get(id) { try { return JSON.parse(localStorage.getItem(draftKey(id))); } catch { return null; } },
  set(id, text) { try { localStorage.setItem(draftKey(id), JSON.stringify({ text, at: Date.now() })); } catch { /* 저장 공간 없음: 드라이브 저장에만 의존 */ } },
  del(id) { try { localStorage.removeItem(draftKey(id)); } catch { /* 무시 */ } },
};
const day = (iso) => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
const LOADING = '<p class="quiet">불러오는 중</p>';
const loadSettings = (key, defaults) => {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key)) }; } catch { return { ...defaults }; }
};
const countSettings = loadSettings(COUNT_KEY, COUNT_DEFAULT);
const inputSettings = loadSettings(INPUT_KEY, INPUT_DEFAULT);
const AI_KEY = 'ai-settings';
const aiSettings = loadSettings(AI_KEY, { concept: '', project: '' });
const displayName = (name) => (name === SETTINGS ? '설정 메모' : name === SUMMARY ? '오래된 화 요약' : name === CAST ? '인물 설정' : parseNoteName(name) ? `${parseNoteName(name)}화 설정` : parseEpisodeName(name)?.title ?? name.replace(/\.md$/, ''));

// ---------- 로그인 ----------
// 구글 접근 권한(토큰)은 한 번에 1시간까지만 받을 수 있다. 서버 없이 쓰는 앱이라
// 토큰을 이 기기에 보관해 두고, 만료되면 버튼 한 번으로 계정 선택 없이 다시 받는다.
const TOKEN_KEY = 'google-token';
const REMEMBER_KEY = 'google-signed-in';
const remembered = () => { try { return localStorage.getItem(REMEMBER_KEY) === '1'; } catch { return false; } };

function savedToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY));
    return t && t.exp > Date.now() ? t.token : null;
  } catch { return null; }
}

function login() {
  return new Promise((resolve, reject) => {
    tokenClient.callback = (r) => {
      if (r.error) return reject(new Error(r.error));
      const exp = Date.now() + ((Number(r.expires_in) || 3600) - 60) * 1000; // 1분 일찍 만료로 본다
      try {
        localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: r.access_token, exp }));
        localStorage.setItem(REMEMBER_KEY, '1');
      } catch { /* 이번 방문에만 로그인 */ }
      drive.setToken(r.access_token);
      resolve();
    };
    tokenClient.error_callback = (e) => reject(new Error(e.type));
    // 한 번 들어온 적 있으면 계정 선택·동의 화면 없이 바로 받는다
    tokenClient.requestAccessToken(remembered() ? { prompt: '' } : {});
  });
}

async function logout() {
  if (!confirm('로그아웃할까요?\n다시 들어올 때 구글 계정을 다시 골라야 해요. 원고는 드라이브에 그대로 있어요.')) return;
  const token = savedToken();
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REMEMBER_KEY); } catch { /* 무시 */ }
  if (token) google.accounts.oauth2.revoke(token, () => {});
  drive.setToken(null);
  history.replaceState(null, '', location.pathname);
  showEntrance();
}

function needLogin() {
  $banner.hidden = false;
}

$banner.querySelector('button').onclick = async () => {
  try {
    await login();
    $banner.hidden = true;
    if (editing) save(); else route();
  } catch (e) { alert(`로그인 실패: ${e.message}`); }
};

function failed(e, retry) {
  if (e.status === 401) return needLogin();
  $app.innerHTML = `<p class="error">드라이브에서 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.</p><p class="quiet">${esc(e.message)}</p><button id="retry" class="act">다시 시도</button>`;
  $app.querySelector('#retry').onclick = retry;
}

// ---------- 화면 ----------
async function route() {
  if (editing) leaveEditor();
  const [, kind, a, b, c] = location.hash.split('/');
  try {
    if (kind === 'n') await showNovel(a);
    else if (kind === 'e') await showEditor(a, b, c === undefined ? null : Number(c));
    else if (kind === 'p') await showCast(a, b);
    else if (kind === 'r') await showRelations(a, b, c === undefined ? null : Number(c));
    else await showNovels();
  } catch (e) { failed(e, route); }
}

async function showNovels() {
  $app.innerHTML = LOADING;
  const items = (await drive.listChildren(rootId))
    .filter((f) => f.mimeType === 'application/vnd.google-apps.folder')
    .sort((x, y) => x.name.localeCompare(y.name, 'ko'));
  $app.innerHTML = `
    <header class="page-head"><p class="place">집필</p><h1>작품</h1><p class="head-tools"><button class="link open-settings">설정</button><button class="link" id="logout">로그아웃</button></p></header>
    <ul class="works">${items.map((f) => `<li><a href="#/n/${f.id}"><span class="work-title">${esc(f.name)}</span><span class="date">${day(f.modifiedTime)} 수정</span></a></li>`).join('') || '<li class="empty">아직 작품이 없어요. 첫 작품을 만들어 보세요.</li>'}</ul>
    <button id="add" class="act">새 작품 만들기</button>`;
  $app.querySelector('#logout').onclick = logout;
  $app.querySelector('#add').onclick = async () => {
    const title = prompt('작품 제목');
    if (title === null) return;
    try {
      const folder = await drive.createFolder(sanitizeTitle(title), rootId);
      await Promise.all([drive.createText(SETTINGS, folder.id, WORK_TEMPLATE), drive.createText(CAST, folder.id, castTemplate())]);
      location.hash = `#/n/${folder.id}`;
    } catch (e) { failed(e, showNovels); }
  };
}

async function showNovel(folderId) {
  $app.innerHTML = LOADING;
  const [folder, files] = await Promise.all([drive.getMeta(folderId), drive.listChildren(folderId)]);
  const md = files.filter((f) => f.name.endsWith('.md'));
  const settings = md.find((f) => f.name === SETTINGS);
  const summaryFile = md.find((f) => f.name === SUMMARY);
  const castFile = md.find((f) => f.name === CAST);
  const copies = md.filter((f) => isConflictCopy(f.name));
  const episodes = md.filter((f) => f !== settings && f !== summaryFile && f !== castFile && !parseNoteName(f.name)).sort((x, y) =>
    (parseEpisodeName(x.name)?.num ?? Infinity) - (parseEpisodeName(y.name)?.num ?? Infinity) || x.name.replace(/\.md$/, '').localeCompare(y.name.replace(/\.md$/, ''), 'ko'));
  const row = (f) => {
    const ep = parseEpisodeName(f.name);
    return `<li><a href="#/e/${folderId}/${f.id}"><span class="no">${ep ? String(ep.num).padStart(3, '0') : ''}</span><span class="ep-title">${esc(ep ? ep.title : displayName(f.name))}</span><span class="date">${day(f.modifiedTime)}</span></a></li>`;
  };
  $app.innerHTML = `
    <header class="page-head"><a href="#/" class="place">작품</a><h1>${esc(folder.name)}</h1><p class="head-tools">${EXPORT_BUTTONS}<button class="link" id="tidy-notes">회차 설정 한 번에 정리</button>${copies.length ? `<button class="link danger" id="trash-copies">충돌 사본 ${copies.length}개 지우기</button>` : ''}<button class="link open-settings">설정</button><button class="link danger" id="delete-work">작품 휴지통으로</button></p></header>
    <nav class="shelf" aria-label="작품 자료">
      ${settings ? `<a href="#/e/${folderId}/${settings.id}"><i>작품</i><b>설정 메모</b><small>작품 정보, 세계관, 떠올린 장면</small></a>` : ''}
      <a href="${castFile ? `#/p/${folderId}/${castFile.id}` : '#'}" id="cast-link"><i>인물</i><b>인물 설정</b><small>생김새부터 아는 것까지 인물마다</small></a>
      <a href="${summaryFile ? `#/e/${folderId}/${summaryFile.id}` : '#'}" id="summary-link"><i>Claude</i><b>오래된 화 요약</b><small>최근 10화 앞을 Claude가 줄여 둔 것</small></a>
    </nav>
    <p class="list-label">회차 · ${episodes.filter((f) => parseEpisodeName(f.name)).length}</p>
    <ol class="episodes">${episodes.map(row).join('') || '<li class="empty">아직 회차가 없어요. 첫 회차를 만들어 보세요.</li>'}</ol>
    <button id="add" class="act">새 회차 만들기</button>`;
  for (const b of $app.querySelectorAll('[data-export]')) b.onclick = async () => {
    const list = episodes.filter((f) => parseEpisodeName(f.name) && !isConflictCopy(f.name));
    if (!list.length) return alert('내보낼 회차가 없어요.');
    const fmt = b.dataset.export, label = b.textContent;
    b.textContent = '내보내는 중…';
    try {
      const texts = await Promise.all(list.map((f) => drive.readText(f.id)));
      download(`${folder.name}.${fmt}`, exportText(list.map((f, i) => ({ title: epLabel(f.name), text: texts[i] })), fmt, folder.name));
    } catch (e) { e.status === 401 ? needLogin() : alert(`내보내지 못했어요. ${e.message}`); }
    b.textContent = label;
  };
  // 처음 열 때 만든다. 예전 작품 설정의 인물 카드 표가 있으면 카드로 옮기고 작품 설정에서는 뺀다.
  if (!castFile) $app.querySelector('#cast-link').onclick = async (ev) => {
    ev.preventDefault();
    try {
      const taken = settings ? takeCast(await drive.readText(settings.id)) : null;
      if (taken && !confirm(`작품 설정의 인물 카드${taken.people.length ? ` (${taken.people.length}명)` : ''}를 새 인물 설정으로 옮길까요?
옮긴 뒤 작품 설정에서는 인물 카드 칸이 빠져요. 바뀌기 전 내용은 드라이브 버전 기록에 남아요.
취소하면 빈 인물 설정만 만들어요.`)) {
        const f = await drive.createText(CAST, folderId, castTemplate());
        location.hash = `#/p/${folderId}/${f.id}`;
        return;
      }
      const f = await drive.createText(CAST, folderId, castTemplate(taken?.people));
      if (taken) await drive.updateText(settings.id, taken.memo);
      location.hash = `#/p/${folderId}/${f.id}`;
    } catch (e) { e.status === 401 ? needLogin() : alert(`인물 설정을 만들지 못했어요. ${e.message}`); }
  };
  if (!summaryFile) $app.querySelector('#summary-link').onclick = async (ev) => {
    ev.preventDefault();
    try {
      const f = await drive.createText(SUMMARY, folderId, '');
      location.hash = `#/e/${folderId}/${f.id}`;
    } catch (e) { e.status === 401 ? needLogin() : alert(`요약 파일을 만들지 못했어요. ${e.message}`); }
  };
  $app.querySelector('#trash-copies')?.addEventListener('click', async () => {
    if (!confirm(`충돌 사본 ${copies.length}개를 드라이브 휴지통으로 옮길까요?\n${copies.map((f) => `· ${f.name.replace(/\.md$/, '')}`).join('\n')}\n\n원래 파일은 그대로 있어요. 30일 안에는 드라이브 휴지통에서 되살릴 수 있어요.`)) return;
    try {
      await Promise.all(copies.map((f) => drive.trash(f.id)));
      showNovel(folderId);
    } catch (e) { e.status === 401 ? needLogin() : alert(`사본을 옮기지 못했어요. ${e.message}`); }
  });
  $app.querySelector('#tidy-notes').onclick = async (ev) => {
    const notes = md.filter((f) => parseNoteName(f.name));
    const have = new Set(notes.map((f) => parseNoteName(f.name)));
    const missing = [...new Set(episodes.filter((f) => !isConflictCopy(f.name)).map((f) => parseEpisodeName(f.name)?.num))]
      .filter((n) => n && !have.has(n));
    if (!confirm(`회차 설정 ${notes.length}개의 목록 기호(•, -글자)를 칸 화면에서 고칠 수 있게 "- "로 맞출까요?${missing.length ? `\n설정이 없는 ${missing.join(', ')}화는 빈 양식을 만들어요.` : ''}\n바뀌기 전 내용은 드라이브 버전 기록에 남아요.`)) return;
    ev.target.textContent = '정리하는 중…';
    try {
      const texts = await Promise.all(notes.map((f) => drive.readText(f.id)));
      const changed = notes.filter((f, i) => tidyNote(texts[i]) !== texts[i]);
      await Promise.all([
        ...changed.map((f) => drive.updateText(f.id, tidyNote(texts[notes.indexOf(f)]))),
        ...missing.map((n) => drive.createText(episodeNoteName(n), folderId, episodeTemplate(n))),
      ]);
      alert(`고친 설정 ${changed.length}개, 새로 만든 설정 ${missing.length}개예요.`);
      showNovel(folderId);
    } catch (e) { e.status === 401 ? needLogin() : alert(`정리하지 못했어요. ${e.message}`); ev.target.textContent = '회차 설정 한 번에 정리'; }
  };
  $app.querySelector('#delete-work').onclick = async () => {
    if (!confirm(`"${folder.name}" 작품을 회차 ${episodes.length}개와 설정 메모까지 모두 드라이브 휴지통으로 옮길까요?\n30일 안에는 드라이브 휴지통에서 되살릴 수 있어요.`)) return;
    try {
      await drive.trash(folderId);
      location.hash = '#/';
    } catch (e) { e.status === 401 ? needLogin() : alert(`작품을 옮기지 못했어요. ${e.message}`); }
  };
  $app.querySelector('#add').onclick = async () => {
    const title = prompt('회차 제목');
    if (title === null) return;
    try {
      // 다른 기기에서 그사이 회차를 추가했을 수 있어서 만들기 직전에 다시 확인한다
      const latest = await drive.listChildren(folderId);
      const num = nextEpisodeNumber(latest.map((f) => f.name));
      const [f] = await Promise.all([
        drive.createText(episodeFileName(num, sanitizeTitle(title)), folderId, ''),
        drive.createText(episodeNoteName(num), folderId, episodeTemplate(num)),
      ]);
      location.hash = `#/e/${folderId}/${f.id}`;
    } catch (e) { failed(e, () => showNovel(folderId)); }
  };
}

// 인물 설정 목록: 카드 제목을 누르면 그 카드만 고치는 화면으로
async function showCast(folderId, fileId) {
  $app.innerHTML = LOADING;
  const [folder, text] = await Promise.all([drive.getMeta(folderId), drive.readText(fileId)]);
  const cards = castCards(parseDoc(text));
  $app.innerHTML = `
    <header class="page-head"><a href="#/n/${folderId}" class="place">${esc(folder.name)}</a><h1>인물 설정</h1><p class="head-tools"><a class="link" href="#/r/${folderId}/${fileId}">관계도 보기</a><a class="link" href="#/e/${folderId}/${fileId}">한 화면에서 모두 고치기</a></p></header>
    <ol class="episodes">${cards.map((c, k) => `<li><a href="#/e/${folderId}/${fileId}/${k}"><span class="no">${String(k + 1).padStart(2, '0')}</span><span class="ep-title">${esc(c.title)}</span><span class="date">${esc([c.name !== c.title && c.name, c.role].filter(Boolean).join(' · '))}</span></a></li>`).join('') || '<li class="empty">아직 인물이 없어요. 첫 인물을 만들어 보세요.</li>'}</ol>
    <button id="add" class="act">새 인물 만들기</button>`;
  $app.querySelector('#add').onclick = async () => {
    const title = prompt('카드 제목 (예: 서윤 - 주인공)');
    if (title === null) return;
    try {
      const now = await drive.readText(fileId); // 다른 기기에서 고친 것까지 살려서 붙인다
      await drive.updateText(fileId, `${now.replace(/\s*$/, '\n\n')}${CAST_CARD.replace(/^## 인물/, `## ${title.replace(/\s+/g, ' ').trim() || '인물'}`)}`);
      location.hash = `#/e/${folderId}/${fileId}/${castCards(parseDoc(now)).length}`;
    } catch (e) { e.status === 401 ? needLogin() : alert(`인물을 만들지 못했어요. ${e.message}`); }
  };
}

// 관계도. card가 있으면 그 인물을 가운데 두고 이어진 인물만, 없으면 모든 인물을 둥글게 놓는다.
async function showRelations(folderId, fileId, card) {
  $app.innerHTML = LOADING;
  const [folder, text] = await Promise.all([drive.getMeta(folderId), drive.readText(fileId)]);
  const { nodes, edges } = castRelations(parseDoc(addRelations(text)));
  const center = card === null ? null : nodes.find((n) => n.card === card) ?? null;
  const shown = center ? edges.filter((e) => e.from === center.key || e.to === center.key) : edges;
  const keep = new Set(center ? [center.key, ...shown.flatMap((e) => [e.from, e.to])] : nodes.map((n) => n.key));
  const ring = nodes.filter((n) => keep.has(n.key) && n !== center);
  const R = ring.length < 2 ? 230 : Math.max(280, ring.length * 52);
  const pos = new Map(ring.map((n, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / ring.length;
    return [n.key, { x: Math.cos(a) * R, y: Math.sin(a) * R }];
  }));
  if (center) pos.set(center.key, { x: 0, y: 0 });
  const rad = (key) => (key === center?.key ? 44 : 32);
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
  const toward = (p, q, d) => { const l = Math.hypot(q.x - p.x, q.y - p.y) || 1; return { x: p.x + ((q.x - p.x) / l) * d, y: p.y + ((q.y - p.y) / l) * d }; };
  const f = (v) => v.toFixed(1);

  // 서로 가리키는 두 관계는 양쪽 화살표 선 하나로 묶고, 이름표를 두 줄로 단다
  const short = (key) => cut(byKey.get(key).name || byKey.get(key).title, 6);
  const edgeSvg = shown.filter((e, i) => !shown.slice(0, i).some((g) => g.from === e.to && g.to === e.from)).map((e) => {
    const back = shown.find((g) => g.from === e.to && g.to === e.from);
    const a = pos.get(e.from), b = pos.get(e.to);
    const s = toward(a, b, rad(e.from) + (back ? 5 : 0)), t = toward(b, a, rad(e.to) + 5);
    const m = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
    const lines = back ? [[e.from, e.label], [back.from, back.label]].filter(([, l]) => l).map(([k, l]) => `${short(k)}: ${l}`) : [e.label].filter(Boolean);
    const tip = [e, back].filter(Boolean).map((x) => `${byKey.get(x.from).title} → ${byKey.get(x.to).title}${x.label ? `: ${x.label}` : ''}`).join('\n');
    const label = lines.length ? `<text class="rel-label" x="${f(m.x)}" y="${f(m.y)}">${lines.map((l, k) => `<tspan x="${f(m.x)}" dy="${k ? '1.25em' : lines.length > 1 ? '-0.2em' : '0.35em'}">${esc(cut(l, 16))}</tspan>`).join('')}</text>` : '';
    return `<g><title>${esc(tip)}</title><path class="rel-edge" d="M${f(s.x)} ${f(s.y)} L${f(t.x)} ${f(t.y)}" marker-end="url(#rel-arrow)"${back ? ' marker-start="url(#rel-arrow)"' : ''}/>${label}</g>`;
  }).join('');
  const nodeSvg = [...pos].map(([key, p]) => {
    const n = byKey.get(key), r = rad(key);
    const up = p.y < -1; // 위쪽 인물은 이름을 원 위에 적어서 가운데로 가는 선과 겹치지 않게
    // 가운데 인물은 선이 사방으로 나가니 이름을 원 안에 적는다
    const inner = key === center?.key ? `<text class="rel-initial">${esc(cut(n.name || n.title, 4))}</text>`
      : `<text class="rel-initial">${esc((n.name || n.title).slice(0, 1))}</text>
      <text class="rel-name" y="${up ? -(r + (n.role ? 32 : 12)) : r + 25}">${esc(cut(n.title, 12))}</text>${n.role ? `<text class="rel-role" y="${up ? -(r + 10) : r + 45}">${esc(cut(n.role, 14))}</text>` : ''}`;
    const g = `<g class="rel-node${key === center?.key ? ' center' : ''}${n.card === null ? ' outside' : ''}" transform="translate(${f(p.x)} ${f(p.y)})">
      <title>${esc(n.title)}${n.card === null ? ' (인물 카드 없음)' : ''}</title>
      <circle r="${r}"/>${inner}</g>`;
    if (n.card === null) return g;
    // 가운데 인물은 카드로, 다른 인물은 그 인물의 관계도로
    return `<a href="#/${key === center?.key ? 'e' : 'r'}/${folderId}/${fileId}/${n.card}">${g}</a>`;
  }).join('');
  const xs = [...pos.values()].map((p) => p.x), ys = [...pos.values()].map((p) => p.y);
  const box = xs.length ? [Math.min(...xs) - 110, Math.min(...ys) - 100, Math.max(...xs) - Math.min(...xs) + 220, Math.max(...ys) - Math.min(...ys) + 190] : [0, 0, 1, 1];
  const listItems = shown.map((e) => `<li><b>${esc(byKey.get(e.from).title)}</b> → <b>${esc(byKey.get(e.to).title)}</b>${e.label ? ` <span>${esc(e.label)}</span>` : ''}</li>`).join('');

  $app.innerHTML = `
    <header class="page-head"><a href="#/p/${folderId}/${fileId}" class="place">${esc(folder.name)} · 인물 설정</a><h1>${center ? `${esc(center.title)}의 관계` : '관계도'}</h1>
      <p class="head-tools">${center ? `<a class="link" href="#/e/${folderId}/${fileId}/${center.card}">카드 열기</a><a class="link" href="#/r/${folderId}/${fileId}">전체 관계도</a>` : ''}<a class="link" href="#/p/${folderId}/${fileId}">인물 목록</a></p></header>
    ${shown.length ? `<figure class="rel-map">
      <svg viewBox="${box.map(f).join(' ')}" role="img" aria-label="${center ? `${esc(center.title)}의 관계도` : '인물 관계도'}">
        <defs><marker id="rel-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="rel-tip"/></marker></defs>
        ${edgeSvg}${nodeSvg}
      </svg>
      <figcaption class="quiet">${center ? '다른 인물을 누르면 그 인물의 관계도로, 가운데 인물을 누르면 카드로 가요.' : '인물을 누르면 그 인물을 가운데 둔 관계도로 가요.'} 점선은 아직 카드가 없는 인물이에요.</figcaption>
    </figure>
    <ul class="rel-list">${listItems}</ul>`
    : `<p class="empty">아직 이어진 관계가 없어요. 인물 카드의 "다른 인물과의 관계"에서 상대 칸에 다른 인물의 이름을 적어 주세요.</p>`}`;
}

async function showEditor(folderId, fileId, card = null) {
  $app.innerHTML = LOADING;
  const [meta, remote, folder, siblings] = await Promise.all([
    drive.getMeta(fileId), drive.readText(fileId), drive.getMeta(folderId), drive.listChildren(folderId),
  ]);
  const memoFile = siblings.find((f) => f.name === SETTINGS && f.id !== fileId);
  const epNum = parseEpisodeName(meta.name)?.num;
  const noteFile = epNum ? siblings.find((f) => f.name === episodeNoteName(epNum)) : null;
  const castFile = siblings.find((f) => f.name === CAST && f.id !== fileId);
  const [memo, note, cast] = await Promise.all([memoFile, noteFile, castFile].map((f) => (f ? drive.readText(f.id) : null)));
  // 비어 있는 작품 설정을 열면 양식을 채워서 보여 준다. 고치기 전에는 저장하지 않는다.
  // 예전 작품 설정에는 "처음 떠올린 장면" 칸을 끼워서 보여 준다. 이것도 고치기 전에는 저장하지 않는다.
  let text = meta.name === SETTINGS ? (remote ? addSeedScene(remote) : WORK_TEMPLATE) : meta.name === CAST ? addRelations(remote) : remote, dirty = false;
  const draft = store.get(fileId);
  if (draft && draft.text !== remote) {
    if (confirm(`이 기기에 저장되지 않은 글이 있어요 (${new Date(draft.at).toLocaleString()}).\n불러올까요? 취소하면 드라이브의 글을 엽니다.`)) {
      text = draft.text; dirty = true;
    } else store.del(fileId);
  } else store.del(fileId);

  const isEpisode = !!epNum;
  const isForm = meta.name === SETTINGS || meta.name === CAST || !!parseNoteName(meta.name);
  if (meta.name !== CAST) card = null;
  const cardTitle = card === null ? null : castCards(parseDoc(text))[card]?.title ?? '없는 인물';
  const memoPart = memoFile ? `<p class="memo-head"><span>${isEpisode ? '작품 설정' : '설정 메모'}</span><a href="#/e/${folderId}/${memoFile.id}">고치기</a></p>${memoHtml(memo)}` : '';
  const notePart = !isEpisode ? '' : `<p class="memo-head"><span>이번 화 설정</span>${noteFile ? `<a href="#/e/${folderId}/${noteFile.id}">고치기</a>` : '<button type="button" class="link" id="add-note">만들기</button>'}</p>${noteFile ? memoHtml(note) : ''}`;
  $app.innerHTML = `
    <div class="room">
      <aside class="label"><div class="label-in">
        <div class="plaque">
          ${card === null ? `<a href="#/n/${folderId}" class="place">${esc(folder.name)}</a>` : `<a href="#/p/${folderId}/${fileId}" class="place">${esc(folder.name)} · 인물 설정</a>`}
          <h1 id="title"></h1>
          ${card === null ? '' : '<figure class="portrait empty" id="portrait"><button type="button" class="frame" id="photo-pick" aria-label="사진 넣기"><img alt="" hidden><span>사진 넣기</span></button><figcaption><button type="button" class="link" id="photo-change" hidden>사진 바꾸기</button><button type="button" class="link danger" id="photo-del" hidden>사진 빼기</button></figcaption><input type="file" accept="image/*" id="photo-file" hidden></figure>'}
          <p class="status" id="status"></p>
          <p class="tools">${isEpisode ? '<button id="rename" class="link">제목 바꾸기</button><button id="delete" class="link">휴지통으로</button>' + EXPORT_BUTTONS : isConflictCopy(meta.name) ? '<button id="delete" class="link">휴지통으로</button>' : ''}${card !== null ? `<a class="link" href="#/r/${folderId}/${fileId}/${card}">관계도 보기</a><button id="del-card" class="link danger">이 인물 지우기</button>` : isForm ? '<button id="raw" class="link">글자로 고치기</button>' : ''}<button class="link open-settings">설정</button></p>
          ${meta.name === SUMMARY ? '<p class="ai-tools"><button type="button" id="ask-summary">Claude에게 요약 부탁 복사</button></p><p class="quiet" id="summary-msg" aria-live="polite">새 화가 쌓이면 다시 눌러 주세요. 요약 안 된 화만 더해서 부탁해요.</p>' : ''}
          <p class="ai-tools"><button type="button" class="open-ask">Claude에게 묻기</button><button type="button" class="open-apply">수정본 반영</button></p>
          <p class="no" id="no"></p>
        </div>
        ${notePart || memoPart ? `<div class="plaque memo-card"><div class="memo-body">${notePart}${memoPart}</div></div>` : ''}
      </div></aside>
      <div class="sheet">${isForm ? '<div class="form" id="form"></div>' : ''}<textarea id="text" spellcheck="false" placeholder="첫 문장을 써 보세요" aria-label="원고"></textarea></div>
    </div>
    <div class="counter" id="counter">
      <p class="counter-cheer" id="counter-cheer" aria-live="polite"></p>
      <button type="button" class="counter-face open-settings" id="counter-face" title="분량 계산 설정 열기">
        <span id="counter-num"></span>
        <span class="counter-bar"><i id="counter-fill"></i></span>
      </button>
    </div>`;
  const ta = $app.querySelector('#text');
  ta.value = text;
  editing = { folderId, fileId, name: meta.name, modifiedTime: meta.modifiedTime, base: remote, dirty, timer: null, saving: false, pending: false, ta, lastCount: null, work: folder.name, memo: memo ?? '', cast: cast ?? '', note: note ?? '', noteId: noteFile?.id };
  // 지난 화 설정은 미리 읽어 둔다. 복사 버튼을 누른 뒤에 읽으면 휴대폰에서 클립보드 복사가 막힐 수 있다.
  const isSummary = meta.name === SUMMARY;
  const summaryFile = siblings.find((f) => f.name === SUMMARY && f.id !== fileId);
  const noteFiles = siblings.map((f) => ({ f, num: parseNoteName(f.name) })).filter((x) => x.num && (isSummary || x.num < epNum)).sort((a, b) => a.num - b.num);
  const readNotes = (epNum || isSummary) ? Promise.all(noteFiles.map(({ f }) => drive.readText(f.id))).then((texts) => noteFiles.map(({ num }, i) => ({ num, text: texts[i] }))) : Promise.resolve([]);
  editing.past = Promise.all([readNotes, summaryFile ? drive.readText(summaryFile.id) : ''])
    .then(([notes, summary]) => pastNotes(notes, 10, summary))
    .catch(() => '');
  if (isSummary) {
    const btn = $app.querySelector('#ask-summary'), msg = $app.querySelector('#summary-msg');
    const notesP = readNotes.catch(() => null);
    btn.onclick = async () => {
      const notes = await notesP;
      if (!notes) { msg.textContent = '회차 설정을 읽지 못했어요. 새로 고침해 주세요.'; return; }
      const p = summaryPrompt({ work: folder.name, memo: memo ?? '', summary: ta.value, notes });
      if (p === null) { msg.textContent = '지금은 요약할 화가 없어요. 회차가 11화를 넘으면, 최근 10화보다 앞 화부터 요약해요.'; return; }
      msg.textContent = (await copyText(p, $app))
        ? '복사했어요. Claude에 붙여 넣어 보내고, 받은 답 전체를 "수정본 반영"에 붙여 넣으세요.'
        : '복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.';
    };
  }
  renderHead();
  setStatus(dirty ? 'typing' : 'saved');
  if (dirty) save();

  ta.addEventListener('beforeinput', (e) => {
    if (e.isComposing) return;
    const key = e.inputType === 'insertText' ? e.data : /^insert(LineBreak|Paragraph)$/.test(e.inputType) ? 'Enter' : null;
    const r = key && assist(ta.value, ta.selectionStart, ta.selectionEnd, key, inputSettings);
    if (!r) return;
    e.preventDefault();
    if (r.insert) replaceText(ta, r.from, r.to, r.insert);
    ta.setSelectionRange(r.cursor, r.cursor);
  });
  ta.oninput = () => {
    editing.dirty = true;
    store.set(editing.fileId, ta.value);
    updateCount();
    setStatus('typing');
    clearTimeout(editing.timer);
    editing.timer = setTimeout(save, SAVE_DELAY);
  };
  if (isForm) {
    const box = $app.querySelector('#form');
    const raw = $app.querySelector('#raw');
    ta.hidden = true;
    setupForm(ta, box, meta.name === CAST, card);
    if (raw) raw.onclick = () => {
      box.hidden = ta.hidden; // 글자 화면으로 가면 칸은 숨긴다
      ta.hidden = !ta.hidden;
      raw.textContent = ta.hidden ? '글자로 고치기' : '칸으로 고치기';
    };
  }
  if (card !== null) {
    const title = $app.querySelector('#title');
    title.textContent = cardTitle;
    document.title = `${cardTitle} - 집필`;
    $app.querySelector('#form').addEventListener('input', (e) => { if (e.target.dataset.h !== undefined) title.textContent = e.target.value; });
    setupPortrait(folderId, card, title);
    $app.querySelector('#del-card').onclick = async () => {
      const blocks = parseDoc(ta.value), [from, to] = cardRange(blocks, card);
      if (from === to || !confirm(`"${title.textContent}" 카드를 지울까요?\n바뀌기 전 내용은 드라이브 버전 기록에 남아요.`)) return;
      const photo = cardPhoto(blocks, card);
      if (photo) drive.trash(photo).catch(() => {});
      blocks.splice(from, to - from);
      ta.value = formatDoc(blocks);
      ta.dispatchEvent(new Event('input'));
      // 목록이 지운 뒤의 파일을 읽도록 저장이 끝날 때까지 기다린다
      const ed = editing;
      await save(ed);
      for (let n = 0; (ed.saving || ed.dirty) && n < 50; n++) await new Promise((r) => setTimeout(r, 100));
      location.hash = `#/p/${folderId}/${fileId}`;
    };
  }
  $app.querySelector('#add-note')?.addEventListener('click', async () => {
    try {
      const f = await drive.createText(episodeNoteName(epNum), folderId, episodeTemplate(epNum));
      location.hash = `#/e/${folderId}/${f.id}`;
    } catch (e) { e.status === 401 ? needLogin() : alert(`설정 파일을 만들지 못했어요. ${e.message}`); }
  });
  for (const b of $app.querySelectorAll('[data-export]')) b.onclick = () => {
    const fmt = b.dataset.export, t = epLabel(editing.name);
    download(`${editing.work} ${t}.${fmt}`, exportText([{ title: t, text: ta.value }], fmt));
  };
  $app.querySelector('#rename')?.addEventListener('click', renameEpisode);
  $app.querySelector('#delete')?.addEventListener('click', deleteEpisode);
}

// 인물 카드 사진. 올릴 때 긴 변 1200px JPEG로 줄여서 작품 폴더에 넣고, 카드에는 파일 id만 적는다.
function setupPortrait(folderId, card, title) {
  const ta = editing.ta, box = $app.querySelector('#portrait'), img = box.querySelector('img'), file = box.querySelector('#photo-file');
  const pick = box.querySelector('#photo-pick'), change = box.querySelector('#photo-change'), del = box.querySelector('#photo-del'), label = pick.querySelector('span');
  let shown, url;
  const current = () => cardPhoto(parseDoc(ta.value), card);
  const show = async (id) => {
    if (id === shown) return;
    shown = id;
    if (url) URL.revokeObjectURL(url);
    url = null; img.hidden = true;
    box.classList.toggle('empty', !id);
    change.hidden = del.hidden = !id;
    label.textContent = id ? '불러오는 중…' : '사진 넣기';
    if (!id) return;
    try {
      const u = URL.createObjectURL(await drive.readBlob(id));
      if (shown !== id) return URL.revokeObjectURL(u);
      url = img.src = u; img.hidden = false;
    } catch (e) { if (e.status === 401) needLogin(); label.textContent = '사진을 불러오지 못했어요'; }
  };
  const set = (id) => { ta.value = setCardPhoto(ta.value, card, id); ta.dispatchEvent(new Event('input')); show(id); };
  pick.onclick = () => { if (!current()) file.click(); };
  change.onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    const old = current();
    label.textContent = '올리는 중…'; box.classList.add('empty'); img.hidden = true; shown = undefined;
    try {
      const up = await drive.createFile(`인물 사진 - ${title.textContent}.jpg`, folderId, await shrink(f));
      set(up.id);
      if (old) drive.trash(old).catch(() => {}); // 예전 사진은 드라이브 휴지통으로
    } catch (e) { e.status === 401 ? needLogin() : alert(`사진을 올리지 못했어요. ${e.message}`); show(old); }
  };
  del.onclick = () => {
    const old = current();
    if (!old || !confirm('이 사진을 뺄까요? 사진 파일은 드라이브 휴지통으로 가요.')) return;
    set(null);
    drive.trash(old).catch(() => {});
  };
  ta.addEventListener('input', () => show(current())); // 수정본 반영으로 사진 줄이 바뀐 경우
  show(current());
}

async function shrink(file, max = 1200) {
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('그림 파일이 아니거나 열 수 없는 형식이에요.'); });
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; // 투명한 PNG가 까맣게 되지 않게
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.88));
}

// 설정 메모를 설명 카드용으로. "# 제목"은 소제목, 표는 항목·내용 짝으로 그린다.
function memoHtml(text) {
  if (!text.trim()) return '<p class="quiet">아직 비어 있어요. 인물과 세계관을 적어 두면 여기에 보여요.</p>';
  const val = (v) => (v ? esc(v) : '<span class="quiet">—</span>');
  return parseDoc(text).map((b) => {
    if (b.head) return `<h4>${esc(b.head.replace(/^#+\s*/, ''))}</h4>`;
    if (b.text) return `<p>${b.text.split('\n').map(esc).join('<br>')}</p>`;
    if (b.cols.length === 2) return `<dl>${b.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${val(v)}</dd>`).join('')}</dl>`;
    // 칸이 많은 표(인물 카드)는 좁은 설명판에 맞게 한 줄을 카드 하나로
    const filled = b.rows.filter((r) => r.some(Boolean));
    return filled.length
      ? filled.map(([name, ...rest]) => `<dl class="card"><dt class="name">${val(name)}</dt>${rest.map((v, k) => (v ? `<dt>${esc(b.cols[k + 1])}</dt><dd>${esc(v)}</dd>` : '')).join('')}</dl>`).join('')
      : '<p class="quiet">—</p>';
  }).join('');
}

// 설정 파일을 칸으로 적는 화면. 원고 칸(ta)이 그대로 원본이고, 칸을 고칠 때마다 표 글자로 되돌려 넣는다.
// titles: "## " 제목을 고칠 수 있게 (인물 카드 이름). card: 그 카드만 보여 준다.
function setupForm(ta, box, titles = false, card = null) {
  let blocks, mine = false;
  // 빈칸에 흐리게 보여 주는 예시. 파일에는 들어가지 않는다.
  const EXAMPLES = {
    '가제': '회귀한 하급 기사', '장르': '회귀 / 판타지', '핵심 재미 (한 줄)': '실력은 그대로라 꼼수로 버티는 맛',
    '주인공이 끝까지 원하는 것': '가문 몰락을 막는 것', '참고작 / 비슷한 느낌': '○○의 템포, △△의 개그 톤',
    '회당 분량': '공백 포함 5,000자', '시점': '1인칭 주인공', '피하고 싶은 것': '하렘, 과한 사이다',
    '나이 / 학년·직업': '17살, 고2', '키 / 체격': '172cm, 마른 편, 어깨가 좁음', '얼굴형 / 피부': '갸름한 얼굴, 하얀 편, 볼에 주근깨',
    '눈 (모양·색·인상)': '쌍꺼풀 없는 가는 눈, 짙은 갈색, 졸려 보임', '머리 (색·길이·모양)': '검은 머리, 눈썹을 덮는 앞머리, 뒷머리 뻗침',
    '평소 옷차림': '교복 위에 회색 후드, 운동화 뒤축을 꺾어 신음', '흉터·점·문신 (위치까지)': '왼쪽 눈썹 끝에 3cm 흉터, 오른쪽 목에 점',
    '관심 분야와 수준': '심리학 / 교양서·유튜브로 독학, 전공 수준 아님', '잘 아는 것': '인지부조화, 방관자 효과, 확증 편향, 애착 유형',
    '모르는 것 / 틀리게 아는 것': '진단 기준(DSM), 상담 기법, 통계·연구 방법', '아는 걸 쓰는 버릇': '친구 행동을 용어로 분석하다 가끔 틀림',
  };
  const render = () => {
    blocks = parseDoc(ta.value);
    const [from, to] = card === null ? [0, blocks.length] : cardRange(blocks, card);
    if (from === to) { box.innerHTML = '<p class="hint">이 인물 카드를 찾지 못했어요. 인물 설정 목록에서 다시 골라 주세요.</p>'; return; }
    box.innerHTML = blocks.map((b, i) => {
      if (i < from || i >= to) return '';
      if (b.head && titles && /^##\s/.test(b.head)) return `<input class="card-title" data-b="${i}" data-h value="${esc(b.head.replace(/^##\s*/, ''))}" aria-label="카드 제목" placeholder="카드 제목 (예: 서윤 - 주인공)">`;
      if (b.head) return /^#\s/.test(b.head) ? `<h1>${esc(b.head.replace(/^#\s*/, ''))}</h1>` : `<h2>${esc(b.head.replace(/^#+\s*/, ''))}</h2>`;
      if (b.text !== undefined) {
        if (isPhotoLine(b.text)) return ''; // 사진은 설명판에서 보여 준다
        return /^\s*(-(\s|$)|[-•·]\S|[•·*]\s)/m.test(b.text)
          ? `<textarea class="free" rows="2" data-b="${i}" aria-label="내용">${esc(b.text)}</textarea>`
          : `<p class="hint">${b.text.split('\n').map(esc).join('<br>')}</p>`;
      }
      // "항목 | 내용" 표는 첫 칸이 이름표라 고치지 못하고, 그 밖의 표는 줄을 늘리고 지울 수 있다
      const fixed = b.cols[0] === '항목';
      const cell = (r, k) => (v, c) => (fixed && c === 0 ? `<th scope="row">${esc(v)}</th>`
        : `<td><textarea rows="1" data-b="${i}" data-r="${k}" data-c="${c}" aria-label="${esc(fixed ? `${r[0]} ${b.cols[c]}` : b.cols[c])}"${fixed && EXAMPLES[r[0]] ? ` placeholder="예: ${esc(EXAMPLES[r[0]])}"` : ''}>${esc(v)}</textarea></td>`);
      return `<div class="tbl"><table${b.cols.length > 3 ? ` style="min-width:${b.cols.length * 5.5}rem"` : ''}>
        <thead><tr>${b.cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}${fixed ? '' : '<td></td>'}</tr></thead>
        <tbody>${b.rows.map((r, k) => `<tr>${r.map(cell(r, k)).join('')}${fixed ? '' : `<td class="del"><button type="button" data-del="${i}" data-r="${k}" aria-label="이 줄 지우기">×</button></td>`}</tr>`).join('')}</tbody>
      </table></div>${fixed ? '' : `<button type="button" class="link add" data-add="${i}">+ 줄 추가</button>`}`;
    }).join('');
  };
  const commit = () => {
    mine = true;
    ta.value = formatDoc(blocks);
    ta.dispatchEvent(new Event('input'));
    mine = false;
  };
  box.addEventListener('input', (e) => {
    const { b, r, c } = e.target.dataset;
    if (b === undefined) return;
    if (e.target.dataset.h !== undefined) blocks[b].head = `## ${e.target.value.replace(/\s+/g, ' ').trim() || '인물'}`;
    else if (r === undefined) blocks[b].text = e.target.value.trim() ? e.target.value : '-'; // 다 지워도 칸이 사라지지 않게
    else blocks[b].rows[r][c] = e.target.value;
    commit();
  });
  box.addEventListener('click', (e) => {
    const { add, del, r } = e.target.dataset;
    if (add !== undefined) {
      blocks[add].rows.push(blocks[add].cols.map(() => ''));
      commit(); render();
      box.querySelector(`[data-b="${add}"][data-r="${blocks[add].rows.length - 1}"]`).focus();
    } else if (del !== undefined) {
      if (blocks[del].rows[r].some(Boolean) && !confirm('이 줄을 지울까요?')) return;
      blocks[del].rows.splice(r, 1);
      commit(); render();
    }
  });
  // 수정본 반영이나 글자로 고치기처럼 밖에서 원본이 바뀌면 칸을 다시 그린다
  ta.addEventListener('input', () => { if (!mine) render(); });
  render();
}

// execCommand는 되돌리기(Ctrl+Z) 기록을 남긴다. 안 되는 브라우저에서는 직접 바꾼다.
function replaceText(ta, from, to, text) {
  ta.setSelectionRange(from, to);
  if (!document.execCommand('insertText', false, text)) {
    ta.setRangeText(text, from, to, 'end');
    ta.dispatchEvent(new Event('input'));
  }
}

function renderHead() {
  const ep = parseEpisodeName(editing.name);
  const no = $app.querySelector('#no');
  no.textContent = ep ? ep.num : '';
  no.setAttribute('aria-label', ep ? `${ep.num}화` : '');
  $app.querySelector('#title').textContent = displayName(editing.name);
  document.title = `${displayName(editing.name)} - 집필`;
  updateCount();
}

// ---------- 설정창 ----------
const $settings = document.getElementById('settings');
const $form = document.getElementById('settings-form');

function setupSettings() {
  const f = $form;
  f.unit.value = countSettings.unit;
  for (const k of ['noSpaces', 'noPunct', 'noSymbols', 'noComments', 'celebrate']) f[k].checked = countSettings[k];
  f.goal.value = countSettings.goal;
  for (const k of Object.keys(INPUT_DEFAULT)) f[k].checked = inputSettings[k];
  f.aiConcept.value = aiSettings.concept;
  f.aiProject.value = aiSettings.project;
  f.oninput = () => {
    Object.assign(countSettings, {
      unit: f.unit.value, noSpaces: f.noSpaces.checked, noPunct: f.noPunct.checked, noSymbols: f.noSymbols.checked,
      noComments: f.noComments.checked, celebrate: f.celebrate.checked, goal: Math.max(0, Math.floor(Number(f.goal.value) || 0)),
    });
    for (const k of Object.keys(INPUT_DEFAULT)) inputSettings[k] = f[k].checked;
    aiSettings.concept = f.aiConcept.value;
    aiSettings.project = f.aiProject.value.trim();
    try {
      localStorage.setItem(AI_KEY, JSON.stringify(aiSettings));
      localStorage.setItem(COUNT_KEY, JSON.stringify(countSettings));
      localStorage.setItem(INPUT_KEY, JSON.stringify(inputSettings));
    } catch { /* 이번 방문에만 적용 */ }
    showGoalUnit();
    if (editing) { editing.lastCount = null; updateCount(); } // 설정을 바꾼 것만으로는 축하하지 않는다
  };
  showGoalUnit();
  // 바깥(어두운 부분)을 누르면 닫기
  $settings.addEventListener('click', (e) => { if (e.target === $settings) $settings.close(); });
  document.addEventListener('click', (e) => { if (e.target.closest('.open-settings')) $settings.showModal(); });
}

// ---------- Claude에게 묻기 ----------
const PRESETS = {
  write: '작품 설정과 이번 화 설정(회차 요청서)을 그대로 지켜서 이번 화 원고를 처음부터 끝까지 써줘. '
    + '회당 분량, 시점, 피하고 싶은 것, 인물의 말버릇과 절대 안 하는 행동, 마지막 장면, 받은 원고 피드백을 모두 반영해. '
    + '본문에 이미 쓴 글이 있으면 살려서 이어 가. 빈칸은 네가 정하고, 뭘 정했는지 코드 블록 밖에 짧게 적어줘. '
    + '너의 역할에 적힌 말투는 설명할 때만 쓰고 원고 문체에는 섞지 마. 완성한 원고 전체를 ```수정본 블록 하나에 담아줘.',
  feedback: '이 회차를 읽고 좋은 점과 고칠 점을 구체적으로 알려줘. 원고는 고치지 말고 의견만 줘.',
  check: '설정 메모, 인물 설정, 지난 화 설정과 어긋나거나 앞뒤가 맞지 않는 부분을 찾아서, 해당 문장을 인용하고 왜 어긋나는지 알려줘.',
  polish: '문체와 내용은 그대로 두고 어색한 문장, 맞춤법, 띄어쓰기를 고쳐줘.',
  continue: '이 회차 마지막 장면에서 자연스럽게 이어지는 다음 장면 초안을 써줘.',
  free: '',
};
const $ask = document.getElementById('ask');
const $apply = document.getElementById('apply');

function setupAi() {
  const af = document.getElementById('ask-form');
  const done = document.getElementById('ask-done');
  const open = document.getElementById('ask-open');
  document.getElementById('ask-copy').onclick = async () => {
    if (af.preset.value === 'free' && !af.extra.value.trim()) {
      done.textContent = '덧붙일 말에 부탁할 내용을 적어 주세요.';
      return;
    }
    const ep = parseEpisodeName(editing.name);
    const text = buildPrompt({
      concept: aiSettings.concept, request: PRESETS[af.preset.value], extra: af.extra.value, work: editing.work,
      episode: ep ? `${ep.num}화 ${ep.title}` : displayName(editing.name), memo: editing.memo, cast: editing.cast, note: editing.note, text: editing.ta.value,
      past: af.past.checked ? await editing.past : '',
    });
    done.textContent = (await copyText(text, $ask))
      ? '복사했어요. Claude를 열고 입력칸에 붙여 넣어 보내세요.'
      : '복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.';
    open.href = aiSettings.project.startsWith('https://claude.ai/') ? aiSettings.project : 'https://claude.ai/new';
    open.hidden = false;
  };

  const pf = document.getElementById('apply-form');
  const summary = document.getElementById('apply-summary');
  const preview = document.getElementById('apply-preview');
  const ok = document.getElementById('apply-ok');
  const show = () => {
    const { body } = extractRevision(pf.pasted.value);
    preview.hidden = !body;
    ok.disabled = !body;
    if (!body) { summary.textContent = ''; return; }
    if (pf.mode.value === 'append') {
      preview.innerHTML = `<p class="add">${esc(body).replace(/\n/g, '<br>')}</p>`;
      summary.textContent = `원고 끝에 ${countText(body).toLocaleString()}자를 붙여요.`;
      return;
    }
    const { html, changes } = renderDiff(editing.ta.value, body);
    preview.innerHTML = html;
    ok.disabled = changes === 0;
    summary.textContent = changes ? `바뀐 곳 ${changes}군데. 지운 글은 줄을 긋고, 새 글은 색을 칠해 보여 줘요.` : '지금 원고와 같아요.';
  };
  pf.pasted.oninput = () => {
    const { mode } = extractRevision(pf.pasted.value);
    if (mode) pf.mode.value = mode; // 답 속 블록 종류에 맞춰 자동 선택
    show();
  };
  for (const r of pf.mode) r.onchange = show;
  ok.onclick = () => {
    const { body } = extractRevision(pf.pasted.value);
    const ta = editing.ta;
    $apply.close(); // 창이 열려 있으면 원고에 입력할 수 없다
    ta.focus();
    if (pf.mode.value === 'replace') replaceText(ta, 0, ta.value.length, body);
    else {
      const v = ta.value;
      const sep = !v.trim() ? '' : v.endsWith('\n\n') ? '' : v.endsWith('\n') ? '\n' : '\n\n';
      replaceText(ta, v.length, v.length, sep + body);
    }
    pf.pasted.value = '';
  };

  document.addEventListener('click', (e) => {
    if (!editing) return;
    if (e.target.closest('.open-ask')) {
      done.textContent = '';
      open.hidden = true;
      $ask.showModal();
    } else if (e.target.closest('.open-apply')) {
      show();
      $apply.showModal();
    }
  });
  for (const d of [$ask, $apply]) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}

async function copyText(text, container) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 아래 방법으로 */ }
  const t = document.createElement('textarea');
  t.value = text;
  t.setAttribute('readonly', '');
  t.style.cssText = 'position:fixed;opacity:0';
  container.append(t); // 열린 창 안에 있어야 선택된다
  t.select();
  const ok = document.execCommand('copy');
  t.remove();
  return ok;
}

// 원고와 수정본의 바뀐 문단만 보여 준다. 짝이 맞는 문단은 낱말 단위로 표시.
function renderDiff(before, after) {
  const ops = diff(before.split('\n'), after.split('\n'));
  const words = (s) => s.split(/(\s+)/).filter(Boolean);
  const out = [];
  let changes = 0;
  for (let i = 0; i < ops.length;) {
    if (ops[i].t === '=') {
      let n = 0;
      while (i < ops.length && ops[i].t === '=') { if (ops[i].v.trim()) n++; i++; }
      if (n) out.push(`<p class="gap">바뀌지 않은 문단 ${n}개</p>`);
      continue;
    }
    const del = [], add = [];
    while (i < ops.length && ops[i].t !== '=') { (ops[i].t === '-' ? del : add).push(ops[i].v); i++; }
    const d = del.filter((v) => v.trim()), a = add.filter((v) => v.trim());
    if (!d.length && !a.length) continue; // 빈 줄만 바뀜
    changes++;
    for (let k = 0; k < Math.max(d.length, a.length); k++) {
      if (k < d.length && k < a.length) {
        out.push(`<p>${diff(words(d[k]), words(a[k])).map((o) =>
          o.t === '=' ? esc(o.v) : o.t === '-' ? `<del>${esc(o.v)}</del>` : `<ins>${esc(o.v)}</ins>`).join('')}</p>`);
      } else if (k < d.length) out.push(`<p class="del">${esc(d[k])}</p>`);
      else out.push(`<p class="add">${esc(a[k])}</p>`);
    }
  }
  return { html: out.join(''), changes };
}

const showGoalUnit = () => { document.getElementById('goal-unit').textContent = UNITS[countSettings.unit][1]; };

function updateCount() {
  const cs = countSettings;
  const n = countText(editing.ta.value, cs);
  const unit = UNITS[cs.unit][1];
  $app.querySelector('#counter-num').textContent = cs.goal > 0
    ? `${n.toLocaleString()} / ${cs.goal.toLocaleString()}${unit}` : `${n.toLocaleString()}${unit}`;
  $app.querySelector('#counter-fill').style.width = cs.goal > 0 ? `${Math.min(100, (n / cs.goal) * 100)}%` : '0';
  $app.querySelector('#counter-face').classList.toggle('reached', cs.goal > 0 && n >= cs.goal);
  if (cs.celebrate && cs.goal > 0 && editing.lastCount !== null && editing.lastCount < cs.goal && n >= cs.goal) celebrate();
  editing.lastCount = n;
}

function celebrate() {
  const counter = $app.querySelector('#counter');
  const cheer = $app.querySelector('#counter-cheer');
  cheer.textContent = '목표 분량을 채웠어요';
  setTimeout(() => { cheer.textContent = ''; }, 3000);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const burst = document.createElement('div');
  burst.className = 'confetti';
  for (let i = 0; i < 22; i++) {
    const bit = document.createElement('span');
    const angle = Math.PI * (0.55 + Math.random() * 0.9); // 위쪽과 왼쪽으로 흩어지게
    const dist = 70 + Math.random() * 90;
    bit.style.cssText = `--x:${Math.cos(angle) * dist}px;--y:${-Math.abs(Math.sin(angle)) * dist}px;--r:${Math.random() * 540 - 270}deg;animation-delay:${Math.random() * 120}ms`;
    burst.append(bit);
  }
  counter.append(burst);
  setTimeout(() => burst.remove(), 1600);
}

const STATUS = { saved: '저장됨', typing: '쓰는 중', saving: '저장하는 중', failed: '저장 안 됨, 이 기기에 보관 중' };
const setStatus = (state) => {
  const el = $app.querySelector('#status');
  if (el) { el.dataset.state = state; el.textContent = STATUS[state]; }
};

// ---------- 저장 ----------
async function save(ed = editing) {
  if (!ed || !ed.dirty) return;
  clearTimeout(ed.timer);
  if (ed.saving) { ed.pending = true; return; }
  ed.saving = true;
  const text = ed.ta.value;
  if (editing === ed) setStatus('saving');
  try {
    const current = await drive.getMeta(ed.fileId);
    // 저장 시각만 다르고 내용은 내가 받은 그대로면 아무도 안 고친 것이다
    // (화면을 빨리 오가서 앞 저장이 덜 끝났을 때 이렇게 된다). 그때는 충돌로 보지 않는다.
    const theirs = isConflict(ed.modifiedTime, current.modifiedTime) ? await drive.readText(ed.fileId) : null;
    if (theirs !== null && theirs !== ed.base && theirs !== text) {
      // 다른 기기에서 먼저 고쳤다: 원본은 그대로 두고 지금 글은 사본으로
      const copy = await drive.createText(conflictFileName(ed.name, new Date()), ed.folderId, text);
      store.del(ed.fileId);
      Object.assign(ed, { fileId: copy.id, name: copy.name, modifiedTime: copy.modifiedTime });
      if (editing === ed) {
        history.replaceState(null, '', `#/e/${ed.folderId}/${copy.id}`);
        renderHead();
      }
      alert(`다른 기기에서 이 글이 먼저 수정됐어요.\n덮어쓰지 않고 지금 글을 "${copy.name}" 파일로 따로 저장했어요.\n이제부터 이 사본에 저장돼요.`);
    } else {
      ed.modifiedTime = theirs === text ? current.modifiedTime : (await drive.updateText(ed.fileId, text)).modifiedTime;
    }
    ed.base = text;
    if (ed.ta.value === text) { ed.dirty = false; store.del(ed.fileId); }
    if (editing === ed) setStatus(ed.dirty ? 'typing' : 'saved');
  } catch (e) {
    store.set(ed.fileId, ed.ta.value);
    if (editing === ed) setStatus('failed');
    if (e.status === 401) needLogin();
    else ed.timer = setTimeout(() => save(ed), 10000);
  } finally {
    ed.saving = false;
    if (ed.pending) { ed.pending = false; save(ed); }
  }
}

function leaveEditor() {
  const ed = editing;
  editing = null;
  document.title = '집필';
  if (ed.dirty) save(ed); // 떠나는 화면의 글도 끝까지 저장
}

async function renameEpisode() {
  const ep = parseEpisodeName(editing.name);
  const title = prompt('새 회차 제목', ep.title);
  if (title === null) return;
  try {
    const m = await drive.rename(editing.fileId, episodeFileName(ep.num, sanitizeTitle(title)));
    Object.assign(editing, { name: m.name, modifiedTime: m.modifiedTime });
    renderHead();
  } catch (e) { e.status === 401 ? needLogin() : alert(`제목을 바꾸지 못했어요. ${e.message}`); }
}

async function deleteEpisode() {
  const copy = isConflictCopy(editing.name);
  if (!confirm(`"${displayName(editing.name)}" ${copy ? '충돌 사본' : '회차'}을 드라이브 휴지통으로 옮길까요?\n(30일 안에 드라이브 휴지통에서 되살릴 수 있어요)`)) return;
  try {
    await drive.trash(editing.fileId);
    // 사본을 지울 때는 원래 회차의 설정 파일을 건드리지 않는다
    if (editing.noteId && !copy) await drive.trash(editing.noteId).catch(() => {}); // 짝인 설정 파일도 함께
    store.del(editing.fileId);
    const { folderId } = editing;
    editing = null;
    location.hash = `#/n/${folderId}`;
  } catch (e) { e.status === 401 ? needLogin() : alert(`삭제하지 못했어요. ${e.message}`); }
}

document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('beforeunload', (e) => { if (editing?.dirty) e.preventDefault(); });

// ---------- 시작 ----------
async function start() {
  if (!CLIENT_ID) {
    $app.innerHTML = '<p class="error">app.js 맨 위의 CLIENT_ID가 비어 있어요. README의 "구글 설정" 단계를 따라 넣어 주세요.</p>';
    return;
  }
  await new Promise((r) => { const t = setInterval(() => { if (window.google?.accounts?.oauth2) { clearInterval(t); r(); } }, 50); });
  setupSettings();
  setupAi();
  tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: () => {} });
  window.onhashchange = () => { if (rootId) route(); };
  const token = savedToken();
  if (token) {
    drive.setToken(token);
    try { await enter(); return; } catch { /* 토큰이 취소됐거나 만료: 입구로 */ }
  }
  showEntrance();
}

async function enter() {
  $app.innerHTML = LOADING;
  rootId = await drive.findOrCreateFolder(ROOT_NAME);
  route();
}

function showEntrance() {
  rootId = null;
  const back = remembered();
  $app.innerHTML = `
    <div class="entrance">
      <h1>집필</h1>
      <p>쓰는 글은 내 구글 드라이브의 내소설 폴더에 회차별로 보관돼요. 집 컴퓨터와 휴대폰 어디서 열어도 같은 원고가 이어져요.</p>
      <button id="go" class="act">${back ? '이어서 쓰기' : '구글 계정으로 들어가기'}</button>
    </div>`;
  $app.querySelector('#go').onclick = async () => {
    try {
      await login();
      await enter();
    } catch (e) { e.status ? failed(e, showEntrance) : alert(`로그인하지 못했어요. ${e.message}`); }
  };
}

start();
