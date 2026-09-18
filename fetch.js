// Cloudflare Pages Function: GET /api/fetch?url=...
// 공개 페이지만 가져올 수 있습니다(로그인 세션 전달 불가). 내용은 저장하지 않습니다.
const MAX = 5 * 1024 * 1024;
const PRIVATE = /^(localhost$|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i;

const err = (status, error) => new Response(JSON.stringify({ error }), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export async function onRequestGet({ request }) {
  const target = new URL(request.url).searchParams.get('url');
  let u;
  try { u = new URL(target); } catch { return err(400, '주소 형식이 올바르지 않습니다.'); }
  if (!/^https?:$/.test(u.protocol)) return err(400, 'http, https 주소만 지원합니다.');
  if (PRIVATE.test(u.hostname)) return err(400, '내부망 주소는 가져올 수 없습니다.');

  let res;
  try {
    res = await fetch(u.href, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; DamdaFetcher/1.0)', accept: 'text/html,application/xhtml+xml' },
    });
  } catch { return err(502, '페이지에 연결할 수 없습니다.'); }

  if (!res.ok) return err(502, `원본 사이트가 오류를 반환했습니다 (${res.status}).`);
  const ct = res.headers.get('content-type') || '';
  if (!/html|xml|text\/plain/i.test(ct)) return err(415, 'HTML 문서가 아닙니다.');
  if (+(res.headers.get('content-length') || 0) > MAX) return err(413, '5MB를 넘는 페이지는 지원하지 않습니다.');

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX) return err(413, '5MB를 넘는 페이지는 지원하지 않습니다.');

  return new Response(buf, {
    headers: {
      'content-type': 'application/octet-stream',
      'x-final-url': res.url,
      'x-charset': (ct.match(/charset=([\w-]+)/i) || [])[1] || '',
      'cache-control': 'no-store',
    },
  });
}
