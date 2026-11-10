import * as drive from './drive.js';
import {
  episodeFileName, parseEpisodeName, nextEpisodeNumber, conflictFileName,
  countText, assist, isConflict, sanitizeTitle,
} from './logic.js';

// 구글 클라우드 콘솔에서 만든 OAuth 클라이언트 ID (README 참고)
const CLIENT_ID = '420828670170-ohu8mg6mndl2msllrgnb5tenbvvierag.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ROOT_NAME = '내소설';
const SETTINGS = '설정.md';
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
const displayName = (name) => (name === SETTINGS ? '설정 메모' : parseEpisodeName(name)?.title ?? name.replace(/\.md$/, ''));

// ---------- 로그인 ----------
function login() {
  return new Promise((resolve, reject) => {
    tokenClient.callback = (r) => (r.error ? reject(new Error(r.error)) : resolve(r));
    tokenClient.error_callback = (e) => reject(new Error(e.type));
    tokenClient.requestAccessToken();
  });
}

function needLogin() {
  $banner.hidden = false;
}

$banner.querySelector('button').onclick = async () => {
  try {
    drive.setToken((await login()).access_token);
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
  const [, kind, a, b] = location.hash.split('/');
  try {
    if (kind === 'n') await showNovel(a);
    else if (kind === 'e') await showEditor(a, b);
    else await showNovels();
  } catch (e) { failed(e, route); }
}

async function showNovels() {
  $app.innerHTML = LOADING;
  const items = (await drive.listChildren(rootId))
    .filter((f) => f.mimeType === 'application/vnd.google-apps.folder')
    .sort((x, y) => x.name.localeCompare(y.name, 'ko'));
  $app.innerHTML = `
    <header class="page-head"><p class="place">집필</p><h1>작품</h1><button class="link open-settings">설정</button></header>
    <ul class="works">${items.map((f) => `<li><a href="#/n/${f.id}"><span class="work-title">${esc(f.name)}</span><span class="date">${day(f.modifiedTime)} 수정</span></a></li>`).join('') || '<li class="empty">아직 작품이 없어요. 첫 작품을 만들어 보세요.</li>'}</ul>
    <button id="add" class="act">새 작품 만들기</button>`;
  $app.querySelector('#add').onclick = async () => {
    const title = prompt('작품 제목');
    if (title === null) return;
    try {
      const folder = await drive.createFolder(sanitizeTitle(title), rootId);
      await drive.createText(SETTINGS, folder.id, '');
      location.hash = `#/n/${folder.id}`;
    } catch (e) { failed(e, showNovels); }
  };
}

async function showNovel(folderId) {
  $app.innerHTML = LOADING;
  const [folder, files] = await Promise.all([drive.getMeta(folderId), drive.listChildren(folderId)]);
  const md = files.filter((f) => f.name.endsWith('.md'));
  const settings = md.find((f) => f.name === SETTINGS);
  const episodes = md.filter((f) => f !== settings).sort((x, y) =>
    (parseEpisodeName(x.name)?.num ?? Infinity) - (parseEpisodeName(y.name)?.num ?? Infinity) || x.name.replace(/\.md$/, '').localeCompare(y.name.replace(/\.md$/, ''), 'ko'));
  const row = (f) => {
    const ep = parseEpisodeName(f.name);
    return `<li><a href="#/e/${folderId}/${f.id}"><span class="no">${ep ? String(ep.num).padStart(3, '0') : ''}</span><span class="ep-title">${esc(ep ? ep.title : displayName(f.name))}</span><span class="date">${day(f.modifiedTime)}</span></a></li>`;
  };
  $app.innerHTML = `
    <header class="page-head"><a href="#/" class="place">작품</a><h1>${esc(folder.name)}</h1><button class="link open-settings">설정</button></header>
    ${settings ? `<p class="memo"><a href="#/e/${folderId}/${settings.id}">설정 메모</a> 인물과 세계관을 적어 두는 곳</p>` : ''}
    <ol class="episodes">${episodes.map(row).join('') || '<li class="empty">아직 회차가 없어요. 첫 회차를 만들어 보세요.</li>'}</ol>
    <button id="add" class="act">새 회차 만들기</button>`;
  $app.querySelector('#add').onclick = async () => {
    const title = prompt('회차 제목');
    if (title === null) return;
    try {
      const name = episodeFileName(nextEpisodeNumber(files.map((f) => f.name)), sanitizeTitle(title));
      const f = await drive.createText(name, folderId, '');
      location.hash = `#/e/${folderId}/${f.id}`;
    } catch (e) { failed(e, () => showNovel(folderId)); }
  };
}

async function showEditor(folderId, fileId) {
  $app.innerHTML = LOADING;
  const [meta, remote, folder] = await Promise.all([drive.getMeta(fileId), drive.readText(fileId), drive.getMeta(folderId)]);
  let text = remote, dirty = false;
  const draft = store.get(fileId);
  if (draft && draft.text !== remote) {
    if (confirm(`이 기기에 저장되지 않은 글이 있어요 (${new Date(draft.at).toLocaleString()}).\n불러올까요? 취소하면 드라이브의 글을 엽니다.`)) {
      text = draft.text; dirty = true;
    } else store.del(fileId);
  } else store.del(fileId);

  const isEpisode = !!parseEpisodeName(meta.name);
  $app.innerHTML = `
    <div class="room">
      <aside class="label">
        <a href="#/n/${folderId}" class="place">${esc(folder.name)}</a>
        <p class="no" id="no"></p>
        <h1 id="title"></h1>
        <p class="status" id="status"></p>
        <p class="tools">${isEpisode ? '<button id="rename" class="link">제목 바꾸기</button><button id="delete" class="link">휴지통으로</button>' : ''}<button class="link open-settings">설정</button></p>
      </aside>
      <div class="sheet"><textarea id="text" spellcheck="false" placeholder="첫 문장을 써 보세요" aria-label="원고"></textarea></div>
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
  editing = { folderId, fileId, name: meta.name, modifiedTime: meta.modifiedTime, dirty, timer: null, saving: false, pending: false, ta, lastCount: null };
  renderHead();
  setStatus(dirty ? 'typing' : 'saved');
  if (dirty) save();

  ta.addEventListener('beforeinput', (e) => {
    if (e.isComposing) return;
    const key = e.inputType === 'insertText' ? e.data : /^insert(LineBreak|Paragraph)$/.test(e.inputType) ? 'Enter' : null;
    const r = key && assist(ta.value, ta.selectionStart, ta.selectionEnd, key, inputSettings);
    if (!r) return;
    e.preventDefault();
    ta.setSelectionRange(r.from, r.to);
    // execCommand는 되돌리기(Ctrl+Z) 기록을 남긴다. 안 되는 브라우저에서는 직접 바꾼다.
    if (r.insert && !document.execCommand('insertText', false, r.insert)) {
      ta.setRangeText(r.insert, r.from, r.to, 'end');
      ta.dispatchEvent(new Event('input'));
    }
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
  $app.querySelector('#rename')?.addEventListener('click', renameEpisode);
  $app.querySelector('#delete')?.addEventListener('click', deleteEpisode);
}

function renderHead() {
  const ep = parseEpisodeName(editing.name);
  $app.querySelector('#no').textContent = ep ? `${ep.num}화` : '';
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
  f.oninput = () => {
    Object.assign(countSettings, {
      unit: f.unit.value, noSpaces: f.noSpaces.checked, noPunct: f.noPunct.checked, noSymbols: f.noSymbols.checked,
      noComments: f.noComments.checked, celebrate: f.celebrate.checked, goal: Math.max(0, Math.floor(Number(f.goal.value) || 0)),
    });
    for (const k of Object.keys(INPUT_DEFAULT)) inputSettings[k] = f[k].checked;
    try {
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
    if (isConflict(ed.modifiedTime, current.modifiedTime)) {
      // 다른 기기에서 먼저 고쳤다: 원본은 그대로 두고 지금 글은 사본으로
      const copy = await drive.createText(conflictFileName(ed.name, new Date()), ed.folderId, text);
      store.del(ed.fileId);
      Object.assign(ed, { fileId: copy.id, name: copy.name, modifiedTime: copy.modifiedTime });
      if (editing === ed) {
        history.replaceState(null, '', `#/e/${ed.folderId}/${copy.id}`);
        renderHead();
      }
      alert(`다른 기기에서 이 회차가 먼저 수정됐어요.\n덮어쓰지 않고 지금 글을 "${copy.name}" 파일로 따로 저장했어요.\n이제부터 이 사본에 저장돼요.`);
    } else {
      ed.modifiedTime = (await drive.updateText(ed.fileId, text)).modifiedTime;
    }
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
  if (!confirm(`"${displayName(editing.name)}" 회차를 드라이브 휴지통으로 옮길까요?\n(30일 안에 드라이브 휴지통에서 되살릴 수 있어요)`)) return;
  try {
    await drive.trash(editing.fileId);
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
  tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: () => {} });
  $app.innerHTML = `
    <div class="entrance">
      <h1>집필</h1>
      <p>쓰는 글은 내 구글 드라이브의 내소설 폴더에 회차별로 보관돼요. 집 컴퓨터와 휴대폰 어디서 열어도 같은 원고가 이어져요.</p>
      <button id="go" class="act">구글 계정으로 들어가기</button>
    </div>`;
  $app.querySelector('#go').onclick = async () => {
    try {
      drive.setToken((await login()).access_token);
      rootId = await drive.findOrCreateFolder(ROOT_NAME);
      window.onhashchange = route;
      route();
    } catch (e) { e.status ? failed(e, start) : alert(`로그인 실패: ${e.message}`); }
  };
}

start();
