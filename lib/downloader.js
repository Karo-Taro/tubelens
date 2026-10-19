// Загрузка видео через локальный помощник (native messaging host + yt-dlp).
// Используется только в background.js — он держит соединение с помощником.
import { getData, setData } from './storage.js';

const HOST = 'com.tubelens.dl';

export const PRESETS = [
  ['best', 'Видео — лучшее качество'],
  ['1080', 'Видео — до 1080p'],
  ['720', 'Видео — до 720p'],
  ['480', 'Видео — до 480p'],
  ['audio', 'Только аудио (m4a)'],
  ['mp3', 'Аудио MP3 (нужен ffmpeg)'],
];

let port = null;
const pending = new Map(); // id -> {resolve, reject}
let seq = 0;

// Понятное объяснение + исходный текст ошибки Chrome (нужен для диагностики)
function hostError(msg) {
  if (/forbidden/i.test(msg)) return `Помощник установлен для другого ID расширения — запустите установщик ещё раз. (${msg})`;
  if (/not found/i.test(msg)) return `Chrome не нашёл помощника загрузки — запустите УСТАНОВИТЬ.bat и перезапустите Chrome. (${msg})`;
  if (/exited/i.test(msg)) return `Помощник запустился, но сразу закрылся — проверьте Python и yt-dlp (запустите установщик ещё раз). (${msg})`;
  return msg;
}

function connect() {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(() => {
    const err = hostError(chrome.runtime.lastError?.message || 'Помощник отключился');
    port = null;
    for (const [, p] of pending) p.reject(new Error(err));
    pending.clear();
    failRunning(err);
  });
  return port;
}

function request(cmd, extra = {}, timeout = 15000) {
  const id = 'r' + Date.now() + '_' + seq++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      connect().postMessage({ id, cmd, ...extra });
    } catch (e) {
      pending.delete(id);
      return reject(new Error(hostError(e.message)));
    }
    if (timeout) setTimeout(() => {
      if (pending.delete(id)) reject(new Error('Помощник не ответил'));
    }, timeout);
  });
}

// ---- список задач (хранится в storage, чтобы UI обновлялся через onChanged) ----
let jobs = null;
let jobsLoading = null; // одна загрузка на все параллельные вызовы — иначе второй перезапишет массив первого
let saveTimer = null;
async function loadJobs() {
  if (!jobs) jobs = await (jobsLoading ??= getData('downloads', []));
  return jobs;
}
function saveJobs(now = false) {
  clearTimeout(saveTimer);
  const doSave = () => setData('downloads', jobs.slice(0, 50));
  if (now) return doSave();
  saveTimer = setTimeout(doSave, 700);
}
async function updateJob(id, patch, now = false) {
  await loadJobs();
  const j = jobs.find((x) => x.id === id);
  if (j) Object.assign(j, patch);
  saveJobs(now);
}
// Отключился Native Messaging — гасим только его задачи (HTTP-загрузки идут дальше)
async function failRunning(err) {
  await loadJobs();
  jobs.filter((j) => (j.status === 'running' || j.status === 'queued') && j.via !== 'http').forEach((j) => Object.assign(j, { status: 'error', error: err }));
  saveJobs(true);
}

function onMessage(msg) {
  const id = msg.id;
  if (msg.type === 'progress') return updateJob(id, { percent: msg.percent, speed: msg.speed, eta: msg.eta, stage: '' });
  if (msg.type === 'stage') return updateJob(id, { stage: msg.stage });
  if (msg.type === 'done') {
    pending.delete(id); // заглушка из start()
    return updateJob(id, { status: 'done', percent: 100, file: msg.file, dir: msg.dir, stage: '' }, true);
  }
  if (msg.type === 'error' && id?.startsWith('j')) {
    pending.get(id)?.reject(new Error(msg.error));
    pending.delete(id);
    return updateJob(id, { status: /Отменено|cancel/i.test(msg.error) ? 'cancelled' : 'error', error: msg.error }, true);
  }
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (msg.type === 'error') p.reject(new Error(msg.error));
  else p.resolve(msg);
}

// ---- HTTP-режим: локальный помощник на 127.0.0.1 (работает в любом Chromium, в т.ч. Linken Sphere) ----
const HTTP = 'http://127.0.0.1:47321';

async function http(path, body, timeout = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(HTTP + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-TubeLens': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'HTTP ' + res.status);
    return j;
  } finally {
    clearTimeout(t);
  }
}

let mode = null; // 'http' | 'native'
async function detectMode() {
  try {
    await http('/ping', null, 1500);
    return (mode = 'http');
  } catch { /* пробуем Native Messaging */ }
  await request('ping', {}, 5000);
  return (mode = 'native');
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    while (true) {
      await loadJobs();
      if (!jobs.some((j) => j.status === 'running' && j.via === 'http')) break;
      try {
        const { jobs: remote } = await http('/jobs');
        for (const r of remote) {
          const j = jobs.find((x) => x.id === r.id);
          if (j) Object.assign(j, { status: r.status, percent: r.percent, speed: r.speed, eta: r.eta, stage: r.stage, file: r.file, dir: r.dir, error: r.error });
        }
        // помощник перезапускался и не знает задачу — иначе опрос крутился бы вечно
        jobs.filter((j) => j.status === 'running' && j.via === 'http' && !remote.some((r) => r.id === j.id))
          .forEach((j) => Object.assign(j, { status: 'error', error: 'Помощник загрузки был перезапущен — загрузка прервана' }));
        saveJobs(true);
      } catch {
        jobs.filter((j) => j.status === 'running' && j.via === 'http').forEach((j) => Object.assign(j, { status: 'error', error: 'Помощник загрузки перестал отвечать' }));
        saveJobs(true);
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    polling = false;
  }
}

export async function status() {
  try {
    await detectMode();
  } catch (e) {
    throw new Error('Помощник загрузки не найден ни на 127.0.0.1:47321, ни через Native Messaging. ' + hostError(e.message));
  }
  return mode === 'http' ? { ...(await http('/ping')), mode } : { ...(await request('ping')), mode };
}

export async function start({ url, preset = 'best', title = '' }) {
  await loadJobs();
  const id = 'j' + Date.now() + '_' + seq++;
  const m = mode || (await detectMode().catch(() => null));
  jobs.unshift({ id, url, preset, title, status: 'running', percent: 0, at: Date.now(), via: m });
  saveJobs(true);
  try {
    if (!m) throw new Error('Помощник загрузки не запущен. Откройте раздел «Загрузки» — там инструкция.');
    if (m === 'http') {
      await http('/download', { id, url, preset });
      poll();
    } else {
      pending.set(id, { resolve: () => {}, reject: () => {} });
      connect().postMessage({ id, cmd: 'download', url, preset });
    }
  } catch (e) {
    await updateJob(id, { status: 'error', error: hostError(e.message) }, true);
  }
  return id;
}

const viaMode = async (httpPath, body, nativeCmd, extra, timeout) =>
  ((mode || (await detectMode())) === 'http' ? http(httpPath, body, timeout) : request(nativeCmd, extra, timeout));

export const cancel = (job) => viaMode('/cancel', { job }, 'cancel', { job });
export const openFolder = (path) => viaMode('/open', { path }, 'open', { path });
export const updateYtdlp = () => viaMode('/update', {}, 'update', {}, 180000);

// Возобновить опрос после перезапуска service worker
export async function resume() {
  await loadJobs();
  // Native-загрузки не переживают перезапуск: порт закрыт, процесс помощника завершён
  const lost = jobs.filter((j) => j.status === 'running' && j.via === 'native' && !port);
  if (lost.length) {
    lost.forEach((j) => Object.assign(j, { status: 'error', error: 'Загрузка прервана перезапуском расширения' }));
    saveJobs(true);
  }
  if (jobs.some((j) => j.status === 'running' && j.via === 'http')) poll();
}

export async function clearFinished() {
  await loadJobs();
  jobs = jobs.filter((j) => j.status === 'running');
  saveJobs(true);
}

// Обложка — без помощника, через chrome.downloads
export async function downloadThumbnail(videoId, title = '') {
  // Chrome отклоняет имена с управляющими символами, точкой/пробелом по краям и разорванными суррогатами (эмодзи)
  const safe = Array.from((title || videoId).replace(/[\\/:*?"<>|\u0000-\u001f~]+/g, '_').trim()).slice(0, 100).join('')
    .replace(/^[\s.]+|[\s.]+$/g, '') || videoId;
  for (const q of ['maxresdefault', 'sddefault', 'hqdefault']) {
    const url = `https://i.ytimg.com/vi/${videoId}/${q}.jpg`;
    const r = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (r?.ok) return chrome.downloads.download({ url, filename: `TubeLens/${safe} [${videoId}].jpg` });
  }
  throw new Error('Обложка не найдена');
}
