// 애드센스 설정 — 이 파일 한 곳만 수정하면 가이드·소개 등 모든 콘텐츠 페이지에 적용됩니다.
// 변환 화면(첫 화면)에는 개인 문서 보호를 위해 불러오지 않습니다.
const ADSENSE_ID = '';   // 예: 'ca-pub-1234567890123456'

if (ADSENSE_ID) {
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + ADSENSE_ID;
  document.head.appendChild(s);
}
