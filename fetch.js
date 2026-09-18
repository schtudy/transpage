// Cloudflare Pages Function: GET /api/fetch?url=...
// 공개 페이지만 가져옵니다(로그인 세션 없음). 받아온 내용은 저장하지 않습니다.
const MAX = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const RATE = { limit: 20, windowMs: 60_000 };   // IP당 분당 20회 (인스턴스 단위, 보조 방어)
const hits = new Map();

const BAD_HOST = /(^|\.)(localhost|local|internal|intranet|home|lan|corp|nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me)$/i;
const IP_LIKE = /^(\d+|0x[0-9a-f]+)(\.(\d+|0x[0-9a-f]+)){0,3}$|:/i;   // 10진수·16진수·IPv4·IPv6 표기 전부

const err = (status, error) => new Response(JSON.stringify({ error }), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return [null, '주소 형식이 올바르지 않습니다.']; }
  if (!/^https?:$/.test(u.protocol)) return [null, 'http, https 주소만 지원합니다.'];
  if (u.username || u.password) return [null, '계정 정보가 포함된 주소는 지원하지 않습니다.'];
  if (u.port && !['80', '443'].includes(u.port)) return [null, '기본 포트(80, 443)만 지원합니다.'];
  const h = u.hostname.replace(/^\[|\]$/g, '');
  if (IP_LIKE.test(h)) return [null, 'IP 주소는 지원하지 않습니다. 도메인 주소를 입력하세요.'];
  if (!h.includes('.') || BAD_HOST.test(h)) return [null, '허용되지 않는 주소입니다.'];
  return [u, ''];
}

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.t > RATE.windowMs) { hits.set(ip, { t: now, n: 1 }); return false; }
  if (hits.size > 5000) hits.clear();
  return ++rec.n > RATE.limit;
}

export async function onRequestGet({ request }) {
  // 담다 화면에서 보낸 요청만 허용 (다른 사이트·직접 호출 차단)
  const site = request.headers.get('sec-fetch-site');
  const ref = request.headers.get('referer');
  const self = new URL(request.url).host;
  const sameOrigin = site ? site === 'same-origin' : (ref && new URL(ref).host === self);
  if (!sameOrigin) return err(403, '담다 사이트에서만 사용할 수 있습니다.');

  if (rateLimited(request.headers.get('cf-connecting-ip') || 'unknown'))
    return err(429, '요청이 너무 많습니다. 1분 뒤 다시 시도하세요.');

  let [u, msg] = checkUrl(new URL(request.url).searchParams.get('url'));
  if (!u) return err(400, msg);

  let res;
  for (let i = 0; ; i++) {
    try {
      res = await fetch(u.href, {
        redirect: 'manual',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; DamdaFetcher/1.0)', accept: 'text/html,application/xhtml+xml' },
      });
    } catch { return err(502, '페이지에 연결할 수 없습니다.'); }
    if (res.status < 300 || res.status >= 400) break;
    if (i >= MAX_REDIRECTS) return err(508, '이동(리다이렉트)이 너무 많습니다.');
    [u, msg] = checkUrl(new URL(res.headers.get('location') || '', u).href);   // 이동할 때마다 다시 검사
    if (!u) return err(400, '이동한 주소가 허용되지 않습니다: ' + msg);
  }

  if (!res.ok) return err(502, `원본 사이트가 오류를 반환했습니다 (${res.status}).`);
  const ct = res.headers.get('content-type') || '';
  if (!/html|xml|text\/plain/i.test(ct)) return err(415, 'HTML 문서가 아닙니다.');
  if (+(res.headers.get('content-length') || 0) > MAX) return err(413, '5MB를 넘는 페이지는 지원하지 않습니다.');

  // 크기를 세면서 읽고, 한도를 넘으면 즉시 중단
  const reader = res.body.getReader();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX) { reader.cancel(); return err(413, '5MB를 넘는 페이지는 지원하지 않습니다.'); }
    chunks.push(value);
  }
  const body = new Uint8Array(size); let off = 0;
  for (const c of chunks) { body.set(c, off); off += c.byteLength; }

  return new Response(body, {
    headers: {
      'content-type': 'application/octet-stream',
      'x-final-url': u.href,
      'x-charset': (ct.match(/charset=([\w-]+)/i) || [])[1] || '',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
