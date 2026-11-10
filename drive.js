// Google Drive v3 REST 호출. 토큰은 app.js가 setToken으로 넣는다.
import { escapeQuery } from './logic.js';

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,modifiedTime';
let token = null;

export const setToken = (t) => { token = t; };

async function call(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers } });
  if (!res.ok) {
    const err = new Error(`Drive ${res.status}: ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

const json = (url, opts) => call(url, opts).then((r) => r.json());
const jsonBody = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function listChildren(folderId) {
  const q = encodeURIComponent(`'${escapeQuery(folderId)}' in parents and trashed=false`);
  let files = [], pageToken = '';
  do {
    const r = await json(`${API}?q=${q}&fields=nextPageToken,files(${FIELDS})&pageSize=1000${pageToken && `&pageToken=${pageToken}`}`);
    files = files.concat(r.files);
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  return files;
}

export async function findOrCreateFolder(name, parentId = 'root') {
  const q = encodeURIComponent(`name='${escapeQuery(name)}' and mimeType='${FOLDER}' and '${parentId}' in parents and trashed=false`);
  const r = await json(`${API}?q=${q}&fields=files(${FIELDS})`);
  if (r.files.length) return r.files[0].id;
  return createFolder(name, parentId).then((f) => f.id);
}

export const createFolder = (name, parentId) =>
  json(`${API}?fields=${FIELDS}`, jsonBody('POST', { name, mimeType: FOLDER, parents: [parentId] }));

export const readText = (id) => call(`${API}/${id}?alt=media`).then((r) => r.text());

export const getMeta = (id) => json(`${API}/${id}?fields=${FIELDS}`);

export function createText(name, parentId, text) {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name, parents: [parentId], mimeType: 'text/markdown' })], { type: 'application/json' }));
  form.append('file', new Blob([text], { type: 'text/markdown;charset=UTF-8' }));
  return json(`${UPLOAD}?uploadType=multipart&fields=${FIELDS}`, { method: 'POST', body: form });
}

export const updateText = (id, text) =>
  json(`${UPLOAD}/${id}?uploadType=media&fields=${FIELDS}`, {
    method: 'PATCH', headers: { 'Content-Type': 'text/markdown;charset=UTF-8' }, body: text,
  });

export const rename = (id, name) => json(`${API}/${id}?fields=${FIELDS}`, jsonBody('PATCH', { name }));

export const trash = (id) => json(`${API}/${id}?fields=id`, jsonBody('PATCH', { trashed: true }));
