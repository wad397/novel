import * as drive from './drive.js';
import {
  episodeFileName, parseEpisodeName, nextEpisodeNumber, conflictFileName,
  countChars, isConflict, sanitizeTitle,
} from './logic.js';

// 구글 클라우드 콘솔에서 만든 OAuth 클라이언트 ID (README 참고)
const CLIENT_ID = '';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ROOT_NAME = '내소설';
const SETTINGS = '설정.md';
const SAVE_DELAY = 2000;

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
  $app.innerHTML = `<p class="error">불러오지 못했어요. ${esc(e.message)}</p><button id="retry">다시 시도</button>`;
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
  $app.innerHTML = '<p class="muted">불러오는 중…</p>';
  const items = (await drive.listChildren(rootId))
    .filter((f) => f.mimeType === 'application/vnd.google-apps.folder')
    .sort((x, y) => x.name.localeCompare(y.name, 'ko'));
  $app.innerHTML = `
    <header><h1>내 작품</h1></header>
    <ul class="list">${items.map((f) => `<li><a href="#/n/${f.id}">${esc(f.name)}</a></li>`).join('') || '<li class="muted">아직 작품이 없어요.</li>'}</ul>
    <button id="add">+ 새 작품</button>`;
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
  $app.innerHTML = '<p class="muted">불러오는 중…</p>';
  const [folder, files] = await Promise.all([drive.getMeta(folderId), drive.listChildren(folderId)]);
  const md = files.filter((f) => f.name.endsWith('.md'));
  const settings = md.find((f) => f.name === SETTINGS);
  const episodes = md.filter((f) => f !== settings).sort((x, y) =>
    (parseEpisodeName(x.name)?.num ?? Infinity) - (parseEpisodeName(y.name)?.num ?? Infinity) || x.name.replace(/\.md$/, '').localeCompare(y.name.replace(/\.md$/, ''), 'ko'));
  const link = (f) => `<a href="#/e/${folderId}/${f.id}">${esc(parseEpisodeName(f.name) ? f.name.replace(/\.md$/, '') : displayName(f.name))}</a>`;
  $app.innerHTML = `
    <header><a href="#/" class="back">← 작품 목록</a><h1>${esc(folder.name)}</h1></header>
    ${settings ? `<p class="settings">${link(settings)}</p>` : ''}
    <ul class="list">${episodes.map((f) => `<li>${link(f)}</li>`).join('') || '<li class="muted">아직 회차가 없어요.</li>'}</ul>
    <button id="add">+ 새 회차</button>`;
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
  $app.innerHTML = '<p class="muted">불러오는 중…</p>';
  const [meta, remote] = await Promise.all([drive.getMeta(fileId), drive.readText(fileId)]);
  let text = remote, dirty = false;
  const draft = store.get(fileId);
  if (draft && draft.text !== remote) {
    if (confirm(`이 기기에 저장되지 않은 글이 있어요 (${new Date(draft.at).toLocaleString()}).\n불러올까요? 취소하면 드라이브의 글을 엽니다.`)) {
      text = draft.text; dirty = true;
    } else store.del(fileId);
  } else store.del(fileId);

  const isEpisode = !!parseEpisodeName(meta.name);
  $app.innerHTML = `
    <header class="editor-head">
      <a href="#/n/${folderId}" class="back">← 회차 목록</a>
      <h1 id="title"></h1>
      <div class="tools">
        ${isEpisode ? '<button id="rename">제목 변경</button><button id="delete">삭제</button>' : ''}
      </div>
      <div class="meta"><span id="status"></span> · <span id="count"></span></div>
    </header>
    <textarea id="text" spellcheck="false" placeholder="여기에 쓰세요"></textarea>`;
  const ta = $app.querySelector('#text');
  ta.value = text;
  editing = { folderId, fileId, name: meta.name, modifiedTime: meta.modifiedTime, dirty, timer: null, saving: false, pending: false, ta };
  renderHead();
  setStatus(dirty ? '저장 안 됨' : '저장됨');
  if (dirty) save();

  ta.oninput = () => {
    editing.dirty = true;
    store.set(editing.fileId, ta.value);
    updateCount();
    setStatus('입력 중');
    clearTimeout(editing.timer);
    editing.timer = setTimeout(save, SAVE_DELAY);
  };
  $app.querySelector('#rename')?.addEventListener('click', renameEpisode);
  $app.querySelector('#delete')?.addEventListener('click', deleteEpisode);
}

function renderHead() {
  $app.querySelector('#title').textContent = displayName(editing.name);
  document.title = `${displayName(editing.name)} - 집필`;
  updateCount();
}

function updateCount() {
  const c = countChars(editing.ta.value);
  $app.querySelector('#count').textContent = `${c.withSpaces.toLocaleString()}자 (공백 제외 ${c.withoutSpaces.toLocaleString()}자)`;
}

const setStatus = (s) => { const el = $app.querySelector('#status'); if (el) el.textContent = s; };

// ---------- 저장 ----------
async function save(ed = editing) {
  if (!ed || !ed.dirty) return;
  clearTimeout(ed.timer);
  if (ed.saving) { ed.pending = true; return; }
  ed.saving = true;
  const text = ed.ta.value;
  if (editing === ed) setStatus('저장 중…');
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
    if (editing === ed) setStatus(ed.dirty ? '입력 중' : '저장됨');
  } catch (e) {
    store.set(ed.fileId, ed.ta.value);
    if (editing === ed) setStatus('저장 안 됨 (이 기기에 보관 중)');
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
  tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: () => {} });
  $app.innerHTML = '<div class="welcome"><h1>집필</h1><p>원고는 내 구글 드라이브의 "내소설" 폴더에 저장돼요.</p><button id="go">구글로 로그인</button></div>';
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
