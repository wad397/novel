import * as drive from './drive.js';
import {
  episodeFileName, parseEpisodeName, nextEpisodeNumber, conflictFileName,
  episodeNoteName, parseNoteName, WORK_TEMPLATE, episodeTemplate, parseDoc, formatDoc,
  countText, assist, diff, extractRevision, buildPrompt, isConflict, sanitizeTitle,
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
const AI_KEY = 'ai-settings';
const aiSettings = loadSettings(AI_KEY, { concept: '', project: '' });
const displayName = (name) => (name === SETTINGS ? '설정 메모' : parseNoteName(name) ? `${parseNoteName(name)}화 설정` : parseEpisodeName(name)?.title ?? name.replace(/\.md$/, ''));

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
    <header class="page-head"><p class="place">집필</p><h1>작품</h1><p class="head-tools"><button class="link open-settings">설정</button><button class="link" id="logout">로그아웃</button></p></header>
    <ul class="works">${items.map((f) => `<li><a href="#/n/${f.id}"><span class="work-title">${esc(f.name)}</span><span class="date">${day(f.modifiedTime)} 수정</span></a></li>`).join('') || '<li class="empty">아직 작품이 없어요. 첫 작품을 만들어 보세요.</li>'}</ul>
    <button id="add" class="act">새 작품 만들기</button>`;
  $app.querySelector('#logout').onclick = logout;
  $app.querySelector('#add').onclick = async () => {
    const title = prompt('작품 제목');
    if (title === null) return;
    try {
      const folder = await drive.createFolder(sanitizeTitle(title), rootId);
      await drive.createText(SETTINGS, folder.id, WORK_TEMPLATE);
      location.hash = `#/n/${folder.id}`;
    } catch (e) { failed(e, showNovels); }
  };
}

async function showNovel(folderId) {
  $app.innerHTML = LOADING;
  const [folder, files] = await Promise.all([drive.getMeta(folderId), drive.listChildren(folderId)]);
  const md = files.filter((f) => f.name.endsWith('.md'));
  const settings = md.find((f) => f.name === SETTINGS);
  const episodes = md.filter((f) => f !== settings && !parseNoteName(f.name)).sort((x, y) =>
    (parseEpisodeName(x.name)?.num ?? Infinity) - (parseEpisodeName(y.name)?.num ?? Infinity) || x.name.replace(/\.md$/, '').localeCompare(y.name.replace(/\.md$/, ''), 'ko'));
  const row = (f) => {
    const ep = parseEpisodeName(f.name);
    return `<li><a href="#/e/${folderId}/${f.id}"><span class="no">${ep ? String(ep.num).padStart(3, '0') : ''}</span><span class="ep-title">${esc(ep ? ep.title : displayName(f.name))}</span><span class="date">${day(f.modifiedTime)}</span></a></li>`;
  };
  $app.innerHTML = `
    <header class="page-head"><a href="#/" class="place">작품</a><h1>${esc(folder.name)}</h1><p class="head-tools"><button class="link open-settings">설정</button><button class="link danger" id="delete-work">작품 휴지통으로</button></p></header>
    ${settings ? `<p class="memo"><a href="#/e/${folderId}/${settings.id}">설정 메모</a> 인물과 세계관을 적어 두는 곳</p>` : ''}
    <ol class="episodes">${episodes.map(row).join('') || '<li class="empty">아직 회차가 없어요. 첫 회차를 만들어 보세요.</li>'}</ol>
    <button id="add" class="act">새 회차 만들기</button>`;
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

async function showEditor(folderId, fileId) {
  $app.innerHTML = LOADING;
  const [meta, remote, folder, siblings] = await Promise.all([
    drive.getMeta(fileId), drive.readText(fileId), drive.getMeta(folderId), drive.listChildren(folderId),
  ]);
  const memoFile = siblings.find((f) => f.name === SETTINGS && f.id !== fileId);
  const epNum = parseEpisodeName(meta.name)?.num;
  const noteFile = epNum ? siblings.find((f) => f.name === episodeNoteName(epNum)) : null;
  const [memo, note] = await Promise.all([memoFile, noteFile].map((f) => (f ? drive.readText(f.id) : null)));
  // 비어 있는 작품 설정을 열면 양식을 채워서 보여 준다. 고치기 전에는 저장하지 않는다.
  let text = meta.name === SETTINGS && !remote ? WORK_TEMPLATE : remote, dirty = false;
  const draft = store.get(fileId);
  if (draft && draft.text !== remote) {
    if (confirm(`이 기기에 저장되지 않은 글이 있어요 (${new Date(draft.at).toLocaleString()}).\n불러올까요? 취소하면 드라이브의 글을 엽니다.`)) {
      text = draft.text; dirty = true;
    } else store.del(fileId);
  } else store.del(fileId);

  const isEpisode = !!epNum;
  const isForm = meta.name === SETTINGS || !!parseNoteName(meta.name);
  const memoPart = memoFile ? `<p class="memo-head"><span>${isEpisode ? '작품 설정' : '설정 메모'}</span><a href="#/e/${folderId}/${memoFile.id}">고치기</a></p>${memoHtml(memo)}` : '';
  const notePart = !isEpisode ? '' : `<p class="memo-head"><span>이번 화 설정</span>${noteFile ? `<a href="#/e/${folderId}/${noteFile.id}">고치기</a>` : '<button type="button" class="link" id="add-note">만들기</button>'}</p>${noteFile ? memoHtml(note) : ''}`;
  $app.innerHTML = `
    <div class="room">
      <aside class="label"><div class="label-in">
        <div class="plaque">
          <a href="#/n/${folderId}" class="place">${esc(folder.name)}</a>
          <h1 id="title"></h1>
          <p class="status" id="status"></p>
          <p class="tools">${isEpisode ? '<button id="rename" class="link">제목 바꾸기</button><button id="delete" class="link">휴지통으로</button>' : ''}${isForm ? '<button id="raw" class="link">글자로 고치기</button>' : ''}<button class="link open-settings">설정</button></p>
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
  editing = { folderId, fileId, name: meta.name, modifiedTime: meta.modifiedTime, dirty, timer: null, saving: false, pending: false, ta, lastCount: null, work: folder.name, memo: memo ?? '', note: note ?? '', noteId: noteFile?.id };
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
    setupForm(ta, box);
    raw.onclick = () => {
      box.hidden = ta.hidden; // 글자 화면으로 가면 칸은 숨긴다
      ta.hidden = !ta.hidden;
      raw.textContent = ta.hidden ? '글자로 고치기' : '칸으로 고치기';
    };
  }
  $app.querySelector('#add-note')?.addEventListener('click', async () => {
    try {
      const f = await drive.createText(episodeNoteName(epNum), folderId, episodeTemplate(epNum));
      location.hash = `#/e/${folderId}/${f.id}`;
    } catch (e) { e.status === 401 ? needLogin() : alert(`설정 파일을 만들지 못했어요. ${e.message}`); }
  });
  $app.querySelector('#rename')?.addEventListener('click', renameEpisode);
  $app.querySelector('#delete')?.addEventListener('click', deleteEpisode);
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
function setupForm(ta, box) {
  let blocks, mine = false;
  // 빈칸에 흐리게 보여 주는 예시. 파일에는 들어가지 않는다.
  const EXAMPLES = {
    '가제': '회귀한 하급 기사', '장르': '회귀 / 판타지', '핵심 재미 (한 줄)': '실력은 그대로라 꼼수로 버티는 맛',
    '주인공이 끝까지 원하는 것': '가문 몰락을 막는 것', '참고작 / 비슷한 느낌': '○○의 템포, △△의 개그 톤',
    '회당 분량': '공백 포함 5,000자', '시점': '1인칭 주인공', '피하고 싶은 것': '하렘, 과한 사이다',
  };
  const render = () => {
    blocks = parseDoc(ta.value);
    box.innerHTML = blocks.map((b, i) => {
      if (b.head) return /^#\s/.test(b.head) ? `<h1>${esc(b.head.replace(/^#\s*/, ''))}</h1>` : `<h2>${esc(b.head.replace(/^#+\s*/, ''))}</h2>`;
      if (b.text !== undefined) {
        return /^\s*-(\s|$)/m.test(b.text)
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
    if (r === undefined) blocks[b].text = e.target.value.trim() ? e.target.value : '-'; // 다 지워도 칸이 사라지지 않게
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
  check: '설정 메모와 어긋나거나 앞뒤가 맞지 않는 부분을 찾아서, 해당 문장을 인용하고 왜 어긋나는지 알려줘.',
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
      episode: ep ? `${ep.num}화 ${ep.title}` : displayName(editing.name), memo: editing.memo, note: editing.note, text: editing.ta.value,
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
    if (editing.noteId) await drive.trash(editing.noteId).catch(() => {}); // 짝인 설정 파일도 함께
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
