// 담다 app.js — 기능별 구역으로 나뉘어 있습니다. 새 기능은 "main" 구역 위에 구역을 추가하세요.
(() => {

/* ========== config ========== */
// 사이트 전역 설정 — 이름/엔드포인트 변경 시 여기만 수정
const CONFIG = {
  siteName: '담다',
  proxyEndpoint: '/api/fetch',   // functions/api/fetch.js
  maxBytes: 5 * 1024 * 1024,
};

/* ========== ui ========== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function setStatus(el, msg, type = '') { el.textContent = msg; el.dataset.type = type; }

let timer;
function toast(msg) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(timer); timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function initTabs(root) {
  const tabs = $$('[role=tab]', root);
  tabs.forEach(tab => tab.addEventListener('click', () => tabs.forEach(t => {
    const on = t === tab;
    t.setAttribute('aria-selected', on);
    $('#' + t.getAttribute('aria-controls')).hidden = !on;
  })));
}

const formatBytes = n =>
  n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';

/* ========== download ========== */
function safeFilename(name) {
  const base = String(name).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'page';
  return /\.html?$/i.test(base) ? base : base + '.html';
}
const toBlobUrl = html => URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));

// Claude 미리보기 안에서는 플랫폼 저장 기능 사용, 일반 사이트에서는 <a download>
async function hostDownloads() {
  if (!window.claude?.use) return null;
  try { return await window.claude.use('downloads'); } catch { return null; }
}

// 반환: 'saved' | 'declined'
async function downloadHtml(html, name) {
  const filename = safeFilename(name);
  const dl = await hostDownloads();
  if (dl) {
    try { await dl.save({ filename, data: new Blob([html]) }); return 'saved'; }
    catch (e) { if (e?.code === 'declined') return 'declined'; throw new Error('저장하지 못했습니다: ' + (e?.message || e)); }
  }
  const url = toBlobUrl(html);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);
  return 'saved';
}

/* ========== fetcher ========== */

function normalizeUrl(input) {
  let v = input.trim();
  if (!v) throw new Error('주소를 입력하세요.');
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try { return new URL(v).href; } catch { throw new Error('주소 형식이 올바르지 않습니다.'); }
}

// 서버 함수로 원본을 받고, 브라우저에서 문자셋(EUC-KR 등)에 맞게 디코딩
async function fetchPage(url) {
  const res = await fetch(`${CONFIG.proxyEndpoint}?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    let msg = `불러오지 못했습니다 (${res.status}).`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  const buf = await res.arrayBuffer();
  let cs = res.headers.get('x-charset');
  if (!cs) {
    const head = new TextDecoder('ascii').decode(buf.slice(0, 4096));
    cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
  }
  let html;
  try { html = new TextDecoder(cs).decode(buf); } catch { html = new TextDecoder().decode(buf); }
  return { html, finalUrl: res.headers.get('x-final-url') || url };
}

/* ========== converter ========== */
// HTML 정리·변환 — 새 옵션은 단계만 추가하면 됩니다.
const URL_ATTRS = ['src', 'href', 'poster', 'action', 'background'];

function convertHtml(raw, { baseUrl = '', stripScripts = true, absolutize = true, printStyle = false } = {}) {
  const doc = new DOMParser().parseFromString(raw, 'text/html');

  if (stripScripts) {
    doc.querySelectorAll('script, meta[http-equiv="refresh" i]').forEach(n => n.remove());
    doc.querySelectorAll('*').forEach(el => {
      for (const a of [...el.attributes])
        if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    });
  }

  if (absolutize && baseUrl) {
    const abs = u => { try { return new URL(u, baseUrl).href; } catch { return u; } };
    doc.querySelectorAll(URL_ATTRS.map(a => `[${a}]`).join(',')).forEach(el => URL_ATTRS.forEach(a => {
      const v = el.getAttribute(a);
      if (v && !/^(data:|blob:|#|mailto:|tel:)/i.test(v)) el.setAttribute(a, abs(v));
    }));
    doc.querySelectorAll('[srcset]').forEach(el => el.setAttribute('srcset',
      el.getAttribute('srcset').split(',').map(p => { const [u, d] = p.trim().split(/\s+/); return abs(u) + (d ? ' ' + d : ''); }).join(', ')));
    doc.querySelectorAll('base').forEach(b => b.remove());
  }

  // 결과는 항상 UTF-8
  doc.querySelectorAll('meta[charset], meta[http-equiv="content-type" i]').forEach(m => m.remove());
  const meta = doc.createElement('meta'); meta.setAttribute('charset', 'utf-8'); doc.head.prepend(meta);

  if (printStyle) {
    const st = doc.createElement('style');
    st.textContent = '@page{size:A4;margin:12mm}@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';
    doc.head.appendChild(st);
  }
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

function guessTitle(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return (m && m[1].trim()) || 'page';
}

/* ========== preview ========== */
// 스크립트가 실행되지 않는 샌드박스 iframe
function renderPreview(iframe, html) { iframe.srcdoc = html; }

function printPreview(iframe) {
  try { iframe.contentWindow.focus(); iframe.contentWindow.print(); return true; } catch { return false; }
}

// 미리보기 전체 화면 전환 (모바일에서 새 탭 대신)
function setExpanded(box, on) {
  box.classList.toggle('is-full', on);
  document.body.style.overflow = on ? 'hidden' : '';
}

/* ========== bookmarklet ========== */
// 로그인된 페이지(예: 학생부 조회 화면)에서 직접 실행되는 저장 스크립트.
// toString()으로 북마클릿이 되므로 외부 변수 참조·한 줄 주석 금지.
function saveThisPage() {
  try {
    const d = document;
    d.querySelectorAll('input,textarea,select').forEach(e => {
      if (e.tagName === 'TEXTAREA') e.textContent = e.value;
      else if (e.tagName === 'SELECT') [...e.options].forEach(o => o.selected ? o.setAttribute('selected', '') : o.removeAttribute('selected'));
      else if (e.type === 'checkbox' || e.type === 'radio') e.checked ? e.setAttribute('checked', '') : e.removeAttribute('checked');
      else if (e.type !== 'password') e.setAttribute('value', e.value);
    });
    const frames = [...d.querySelectorAll('iframe')].map(f => {
      try { const x = f.contentDocument; return x ? '<!DOCTYPE html>' + x.documentElement.outerHTML : null; } catch (e) { return null; }
    });
    let css = ''; const used = new Set();
    [...d.styleSheets].forEach(s => {
      try {
        if (!s.ownerNode || s.ownerNode.tagName !== 'LINK') return;
        css += [...s.cssRules].map(r => r.cssText.replace(/url\((['"]?)(?!data:|https?:|\/\/)([^'")]+)\1\)/g, (m, q, u) => 'url("' + new URL(u, s.href).href + '")')).join('\n') + '\n';
        used.add(s.ownerNode.href);
      } catch (e) {}
    });
    const c = d.documentElement.cloneNode(true);
    c.querySelectorAll('script').forEach(e => e.remove());
    c.querySelectorAll('link[rel~="stylesheet"]').forEach(l => { if (used.has(l.href)) l.remove(); });
    c.querySelectorAll('iframe').forEach((f, i) => { if (frames[i]) { f.removeAttribute('src'); f.setAttribute('srcdoc', frames[i]); } });
    const h = c.querySelector('head');
    if (!h.querySelector('base')) { const b = d.createElement('base'); b.href = location.href; h.prepend(b); }
    if (css) { const st = d.createElement('style'); st.textContent = css; h.appendChild(st); }
    const m = d.createElement('meta'); m.setAttribute('charset', 'utf-8'); h.prepend(m);
    const html = '<!DOCTYPE html>\n' + c.outerHTML;
    const name = (d.title || 'page').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) + '.html';
    const u = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const a = d.createElement('a'); a.href = u; a.download = name; d.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(u); a.remove(); }, 5000);
  } catch (e) { alert('저장하지 못했습니다: ' + e.message); }
}

const BOOKMARKLET = 'javascript:' + encodeURIComponent('(' + saveThisPage.toString() + ')()');

/* ========== samples ========== */
// 처음 온 사용자가 바로 결과를 볼 수 있는 예시 문서
const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>예시_성적통지표</title>
<style>body{font-family:sans-serif;padding:24px;color:#222}h1{font-size:20px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:6px 8px;text-align:center}th{background:#eee}</style>
<script>alert('이 스크립트는 변환 시 제거됩니다')<\/script></head>
<body><h1>2026학년도 1학기 성적통지표 (예시)</h1>
<p>학년/반/번호: 3학년 2반 15번 · 성명: 홍길동</p>
<table><tr><th>과목</th><th>단위수</th><th>원점수</th><th>석차등급</th></tr>
<tr><td>국어</td><td>4</td><td>92</td><td>2</td></tr>
<tr><td>수학</td><td>4</td><td>88</td><td>2</td></tr>
<tr><td>영어</td><td>4</td><td>95</td><td>1</td></tr></table>
<p onclick="alert(1)">※ 이 문서는 담다 사용법을 보여주기 위한 가상 예시입니다.</p></body></html>`;

/* ========== main ========== */

const state = { raw: '', baseUrl: '', html: '' };
const el = {
  tool: $('#tool'), urlForm: $('#url-form'), url: $('#url-input'), urlBtn: $('#url-btn'),
  pasteForm: $('#paste-form'), paste: $('#paste-input'), file: $('#file-input'), pasteBase: $('#paste-base'),
  status: $('#status'), result: $('#result'), frame: $('#preview'), frameBox: $('#preview-box'),
  name: $('#filename'), meta: $('#result-meta'),
  opts: ['#opt-scripts', '#opt-abs', '#opt-print'].map(s => $(s)),
};

const options = () => ({
  baseUrl: state.baseUrl, stripScripts: el.opts[0].checked, absolutize: el.opts[1].checked, printStyle: el.opts[2].checked,
});

function build() {
  if (!state.raw) return;
  state.html = convertHtml(state.raw, options());
  renderPreview(el.frame, state.html);
  el.meta.textContent = `결과 ${formatBytes(new Blob([state.html]).size)}${state.baseUrl ? ' · 원본 ' + state.baseUrl : ''}`;
  el.result.hidden = false;
}

function load(raw, baseUrl) {
  if (new Blob([raw]).size > CONFIG.maxBytes) throw new Error('5MB 이하의 HTML만 변환할 수 있습니다.');
  Object.assign(state, { raw, baseUrl });
  el.name.value = guessTitle(raw);
  build();
  setStatus(el.status, '변환했습니다. 미리보기를 확인하고 저장하세요.', 'ok');
  el.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

initTabs(el.tool);

el.urlForm.addEventListener('submit', async e => {
  e.preventDefault();
  el.urlBtn.disabled = true;
  try {
    const url = normalizeUrl(el.url.value);
    setStatus(el.status, '페이지를 가져오는 중…');
    const { html, finalUrl } = await fetchPage(url);
    load(html, finalUrl);
  } catch (err) {
    setStatus(el.status, err.message + ' 로그인이 필요한 페이지는 아래 "저장 버튼"을 사용하세요.', 'error');
  } finally { el.urlBtn.disabled = false; }
});

el.pasteForm.addEventListener('submit', e => {
  e.preventDefault();
  try {
    if (!el.paste.value.trim()) throw new Error('HTML을 붙여넣거나 파일을 선택하세요.');
    const base = el.pasteBase.value.trim();
    load(el.paste.value, base ? normalizeUrl(base) : '');
  } catch (err) { setStatus(el.status, err.message, 'error'); }
});

$('#btn-sample').addEventListener('click', () => {
  el.paste.value = SAMPLE_HTML;
  el.pasteBase.value = '';
  load(SAMPLE_HTML, '');
});

el.file.addEventListener('change', async () => {
  const f = el.file.files[0]; if (!f) return;
  el.paste.value = await f.text();
  toast(`${f.name} 불러옴`);
});

el.opts.forEach(o => o.addEventListener('change', build));

const btnDl = $('#btn-download');
btnDl.addEventListener('click', async () => {
  btnDl.disabled = true;
  try {
    const r = await downloadHtml(state.html, el.name.value);
    toast(r === 'saved' ? '파일을 저장했습니다' : '저장을 취소했습니다');
  } catch (err) { setStatus(el.status, err.message, 'error'); }
  finally { btnDl.disabled = false; }
});
$('#btn-expand').addEventListener('click', () => setExpanded(el.frameBox, true));
$('#btn-close').addEventListener('click', () => setExpanded(el.frameBox, false));
addEventListener('keydown', e => { if (e.key === 'Escape') setExpanded(el.frameBox, false); });
$('#btn-print').addEventListener('click', () => { if (!printPreview(el.frame)) toast('이 화면에서는 인쇄할 수 없습니다. 저장한 파일을 열어 인쇄하세요'); });

// 저장 버튼(북마클릿)
const bm = $('#bm-link');
bm.href = BOOKMARKLET;
bm.addEventListener('click', e => { e.preventDefault(); toast('즐겨찾기에 추가한 뒤, 저장할 페이지에서 누르세요'); });
$('#bm-copy').addEventListener('click', async () => {
  const box = $('#bm-code');
  try { await navigator.clipboard.writeText(BOOKMARKLET); toast('코드를 복사했습니다'); }
  catch { box.hidden = false; box.value = BOOKMARKLET; box.select(); toast('아래 코드를 길게 눌러 복사하세요'); }
});

})();
