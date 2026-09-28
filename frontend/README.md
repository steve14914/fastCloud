# fastcloud 프론트엔드

Vite + React + TypeScript. 폰, 아이패드, PC 화면에 맞춰 배치가 바뀐다.

## 실행

Node.js 20.19 이상이 필요하다.

```bash
cd frontend
npm install          # 처음 한 번
npm run dev          # http://localhost:5173 (API 요청은 127.0.0.1:8080 백엔드로 넘어감)
npm run build        # dist/ 에 배포용 파일 생성
```

개발할 때는 백엔드를 따로 켜 둔다: `cd backend && FASTCLOUD_SECURE_COOKIE=false go run .`

## 구조

```
src/
├── main.tsx              시작점
├── App.tsx               로그인 여부에 따라 화면(주소) 연결
├── api.ts                백엔드 API 호출 (화면 코드는 fetch 대신 이걸 쓴다)
├── auth.tsx              로그인 상태
├── refresh.tsx           "목록 새로고침" 신호 (파일이 바뀌면 모든 목록이 다시 불러옴)
├── upload.tsx            업로드 대기열 (하나씩 올리면서 진행률/속도 표시)
├── hooks.ts              useLoad: 데이터 불러오기 + 화면 이동 시 즉시 보여 주는 캐시
├── fileTypes.ts          확장자별 미리보기 방식
├── format.ts             용량, 속도, 날짜 표시
├── styles.css            전체 스타일 (다크 모드 포함)
├── pages/
│   ├── LoginPage.tsx     아이디/비밀번호 + 구글 로그인
│   ├── HomePage.tsx      메인: 메모, 업로드, 사진함/문서함/기타파일함
│   ├── FilesPage.tsx     전체 파일: 함들 + 저장공간 폴더 정리
│   └── TrashPage.tsx     휴지통
└── components/           화면 조각들 (메모장, 파일 한 줄, 미리보기 창 등)
```

## 빠르게 느껴지도록 한 것

- 사진 목록은 원본 대신 서버가 만든 256px 썸네일(수 KB)을 보여 주고, 화면에 보일 때만 불러온다.
- 파일과 썸네일은 브라우저가 캐시한다 (같은 id의 파일은 내용이 바뀌지 않으므로).
- 삭제, stash 버튼은 서버 응답을 기다리지 않고 바로 목록에서 빠진다 (실패하면 되돌림).
- 다른 화면에 갔다가 돌아오면 전에 불러온 목록을 즉시 보여 주고 뒤에서 새로 불러온다.
- 사진 미리보기에서 앞뒤 사진을 미리 받아 둔다.
