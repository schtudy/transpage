# 담다 – 배포 메모

## GitHub 저장소 최상단에 있어야 할 파일
index.html articles.html guide.html about.html contact.html privacy.html terms.html 404.html
article-*.html (10개)  style.css app.js ads.js og.png favicon.svg robots.txt sitemap.xml ads.txt _headers
functions/api/fetch.js  ← Create new file에서 경로째 입력

## 배포 후 꼭 바꿀 것
1. 모든 HTML·contact: YOUR-EMAIL@gmail.com → 실제 이메일
2. ads.js: ADSENSE_ID = 'ca-pub-...' (한 곳만 수정하면 전체 적용)
3. ads.txt: pub-ID 입력 후 # 제거
4. 도메인을 사면 transhtml.pages.dev → 새 도메인으로 전체 치환

## 보안
- GitHub·Cloudflare 2단계 인증 필수 (계정 탈취 = 저장 버튼 변조)
- 첫 화면(/)은 광고 없음 + CSP 적용 (_headers)
