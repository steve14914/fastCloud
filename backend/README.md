# fastcloud 백엔드

Go 표준 라이브러리 기반 HTTP 서버. 파일 내용은 디스크에, 메타데이터(파일 이름, 크기 등)는 SQLite에 저장한다.

## 구조

```
backend/
├── main.go                 진입점: 환경 변수 읽기, 서버 실행, passwd 명령
└── internal/app/
    ├── app.go              설정, 라우트 등록, 백그라운드 작업, JSON 응답 헬퍼
    ├── auth.go             아이디/비밀번호(bcrypt), 세션 쿠키, 로그인 시도 제한
    ├── google.go           구글 로그인 (선택)
    ├── files.go            업로드 / 목록 / 다운로드 / 휴지통 / 이동 / stash
    ├── category.go         확장자로 사진·문서·기타 구분
    ├── folders.go          저장공간 폴더
    ├── memos.go            메모장
    ├── thumb.go            사진 썸네일 (EXIF 회전 반영)
    ├── stats.go            사용 용량, 업로드/다운로드 속도
    ├── web.go              프론트엔드 파일 제공
    ├── db.go               SQLite 열기와 스키마 마이그레이션
    └── *_test.go           테스트
```

## 로컬에서 실행

Go 1.26 이상이 필요하다 (낮은 버전이 깔려 있으면 `go`가 알아서 1.26을 내려받는다).

```bash
cd backend
go run . passwd                                # 아이디와 비밀번호 설정 (처음 한 번)
FASTCLOUD_SECURE_COOKIE=false go run .         # http://127.0.0.1:8080 에서 실행
go test ./...                                  # 테스트
```

로컬은 HTTPS가 아니라서 `FASTCLOUD_SECURE_COOKIE=false`를 줘야 로그인 쿠키가 동작한다.

## 서버(Oracle Cloud, ARM)에 배포

순수 Go SQLite 드라이버(`modernc.org/sqlite`)를 써서 cgo가 필요 없으므로, 내 PC에서 ARM용으로 빌드해 복사하면 된다.

```bash
cd backend
GOOS=linux GOARCH=arm64 go build -o fastcloud .      # PowerShell: $env:GOOS="linux"; $env:GOARCH="arm64"; go build -o fastcloud .
scp -i <키파일> fastcloud ubuntu@<공인IP>:~/
```

서버에서:

```bash
./fastcloud passwd     # 아이디와 비밀번호 설정
./fastcloud            # 127.0.0.1:8080에서 실행 (외부에는 Caddy만 노출)
```

Caddy 설정 예 (`/etc/caddy/Caddyfile`). Caddy가 HTTPS 인증서를 자동으로 받는다.

```
내도메인.duckdns.org {
    request_body {
        max_size 4GB
    }
    encode zstd gzip          # 화면 파일(JS/CSS)을 압축해서 보낸다 (300KB → 90KB)
    reverse_proxy 127.0.0.1:8080
}
```

프론트엔드는 `frontend/`에서 `npm run build`로 만든 `dist/` 폴더를 서버의 `~/web`으로 복사하면 백엔드가 같이 제공한다 (`FASTCLOUD_WEB_DIR`).

```bash
cd frontend && npm run build
scp -i <키파일> -r dist ubuntu@<공인IP>:~/web
```

## 환경 변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `FASTCLOUD_ADDR` | `127.0.0.1:8080` | 서버 주소. Caddy 뒤에 둘 거라 외부에 열지 않는다 |
| `FASTCLOUD_DATA_DIR` | `./data` | DB(`fastcloud.db`)와 업로드 파일(`files/`)이 저장되는 폴더 |
| `FASTCLOUD_MAX_UPLOAD_MB` | `4096` | 요청 한 번의 최대 업로드 크기(MB) |
| `FASTCLOUD_SECURE_COOKIE` | `true` | HTTPS에서만 쿠키 전송. 로컬 개발 때만 `false` |
| `FASTCLOUD_TRUST_PROXY` | `true` | `X-Forwarded-For`로 클라이언트 IP 판단 (로그인 시도 제한에 사용). 서버를 Caddy 없이 직접 노출하면 `false` |
| `FASTCLOUD_SESSION_DAYS` | `30` | 로그인 유지 기간(일) |
| `FASTCLOUD_TRASH_DAYS` | `30` | 휴지통에 들어간 파일을 며칠 뒤 완전히 지울지. `0`이면 자동으로 지우지 않음 |
| `FASTCLOUD_WEB_DIR` | `./web` | 프론트엔드 빌드 결과(`frontend/dist`)가 있는 폴더 |
| `FASTCLOUD_PUBLIC_URL` | | 사이트 주소 (예: `https://내도메인.duckdns.org`). 구글 로그인에 필요 |
| `FASTCLOUD_GOOGLE_CLIENT_ID` | | 구글 로그인 클라이언트 ID |
| `FASTCLOUD_GOOGLE_CLIENT_SECRET` | | 구글 로그인 클라이언트 보안 비밀 |
| `FASTCLOUD_GOOGLE_EMAIL` | | 로그인을 허용할 내 구글 계정. 위 네 값이 모두 있어야 로그인 화면에 구글 버튼이 나온다 |

### 구글 로그인 켜기 (선택)

1. [Google Cloud Console](https://console.cloud.google.com/) → API 및 서비스 → OAuth 동의 화면을 "외부"로 만들고, 테스트 사용자에 내 계정을 넣는다.
2. 사용자 인증 정보 → OAuth 클라이언트 ID 만들기 → 유형 "웹 애플리케이션".
   승인된 리디렉션 URI에 `https://내도메인.duckdns.org/api/auth/google/callback`을 넣는다.
3. 받은 클라이언트 ID와 보안 비밀을 위 환경 변수로 넣고 서버를 다시 켠다.

구글에서 로그인한 계정의 이메일이 `FASTCLOUD_GOOGLE_EMAIL`과 같을 때만 들어올 수 있다. 아이디/비밀번호 로그인도 그대로 쓸 수 있다.

## API

로그인 관련 세 개 외의 모든 API는 로그인 쿠키가 필요하다. 없으면 `401`.

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/api/login` | `{"username": "...", "password": "..."}` → 성공 시 `204` + 세션 쿠키. 같은 IP에서 15분 안에 5번 틀리면 `429` |
| `GET` | `/api/auth/config` | `{"google": true}` 구글 로그인이 켜져 있는지 |
| `GET` | `/api/auth/google/start` | 구글 로그인 시작 (구글로 이동) → 끝나면 `/api/auth/google/callback`으로 돌아옴 |
| `POST` | `/api/logout` | 로그아웃 |
| `GET` | `/api/me` | 로그인 상태 확인 (`200` 또는 `401`) |
| `GET` | `/api/files` | 파일 목록 (최신순). `view=all\|home\|stash\|trash`, `category=photo\|document\|other`, `folder=root\|폴더id`, `limit=` |
| `POST` | `/api/files` | `multipart/form-data`, `file` 필드 (여러 개 가능) → `201`. 기본은 사진/문서/기타함, `?folder=root\|폴더id`면 저장공간 |
| `GET` | `/api/files/{id}` | 다운로드. `?inline=1`이면 브라우저에서 바로 열기. 이어받기(Range) 지원 |
| `GET` | `/api/files/{id}/thumb` | 사진 썸네일 (256px JPEG) |
| `PATCH` | `/api/files/{id}` | `{"name"?, "folderId"?, "stashed"?}` 이름 바꾸기, 폴더 이동, stash / 함으로 되돌리기 |
| `DELETE` | `/api/files/{id}` | 휴지통으로. `?permanent=1`이면 완전히 삭제 |
| `POST` | `/api/files/{id}/restore` | 휴지통에서 되살리기 |
| `DELETE` | `/api/trash` | 휴지통 비우기 |
| `GET` `POST` | `/api/folders` | 폴더 목록 / 만들기 `{"name", "parentId"}` |
| `PATCH` `DELETE` | `/api/folders/{id}` | 이름 바꾸기·옮기기 / 삭제 (안의 파일은 한 칸 위로) |
| `GET` `POST` | `/api/memos` | 메모 목록(제목만) / 만들기 `{"body"}` |
| `GET` `PUT` `DELETE` | `/api/memos/{id}` | 메모 읽기 / 저장 / 삭제 |
| `GET` | `/api/usage` | 사용 용량, 디스크 크기 |
| `GET` | `/api/stats/transfer` | 현재 업로드/다운로드 속도 (서버 기준, 모든 기기 합) |
| `GET` | `/healthz` | 동작 확인용 |

### 파일이 있는 곳

- **사진함 · 문서함 · 기타파일함** (`stashed=false`): 메인 화면에 보인다. 올린 파일은 확장자에 따라 여기로 들어간다.
- **저장공간** (`stashed=true`): 오래 보관할 파일. 메인 화면에서 stash하면 여기로 오고, 폴더로 정리할 수 있다. 다시 함으로 돌려놓을 수도 있다.
- **휴지통** (`deletedAt`이 있음): 30일 뒤 자동으로 완전히 지워진다.

curl로 시험해 보기:

```bash
curl -c cookie.txt -X POST -d '{"username":"내아이디","password":"내비밀번호"}' http://127.0.0.1:8080/api/login
curl -b cookie.txt -F file=@보고서.docx http://127.0.0.1:8080/api/files
curl -b cookie.txt http://127.0.0.1:8080/api/files
curl -b cookie.txt -OJ http://127.0.0.1:8080/api/files/1
```

## 아직 안 한 것

- 같은 이름으로 올리면 지금은 별개 파일로 둘 다 남는다 (이전 버전 보관 기능은 나중에)
- HEIC(아이폰/일부 갤럭시 사진)는 썸네일과 미리보기가 안 된다 (다운로드는 됨)
- systemd 서비스 등록 (서버 재부팅 시 자동 실행)
