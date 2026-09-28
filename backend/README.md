# fastcloud 백엔드

Go 표준 라이브러리 기반 HTTP 서버. 파일 내용은 디스크에, 메타데이터(파일 이름, 크기 등)는 SQLite에 저장한다.

## 구조

```
backend/
├── main.go                 진입점: 환경 변수 읽기, 서버 실행, passwd 명령
└── internal/app/
    ├── app.go              설정, 라우트 등록, JSON 응답 헬퍼
    ├── auth.go             비밀번호(bcrypt), 세션 쿠키, 로그인 시도 제한
    ├── files.go            업로드 / 목록 / 다운로드 / 삭제
    ├── db.go               SQLite 열기와 스키마 마이그레이션
    └── app_test.go         API 전체 흐름 테스트
```

## 로컬에서 실행

Go 1.26 이상이 필요하다 (낮은 버전이 깔려 있으면 `go`가 알아서 1.26을 내려받는다).

```bash
cd backend
go run . passwd                                # 비밀번호 설정 (처음 한 번)
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
./fastcloud passwd     # 비밀번호 설정
./fastcloud            # 127.0.0.1:8080에서 실행 (외부에는 Caddy만 노출)
```

Caddy 설정 예 (`/etc/caddy/Caddyfile`). Caddy가 HTTPS 인증서를 자동으로 받는다.

```
내도메인.duckdns.org {
    request_body {
        max_size 4GB
    }
    reverse_proxy 127.0.0.1:8080
}
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

## API

로그인 외의 모든 API는 로그인 쿠키가 필요하다. 없으면 `401`.

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/api/login` | `{"password": "..."}` → 성공 시 `204` + 세션 쿠키. 같은 IP에서 15분 안에 5번 틀리면 `429` |
| `POST` | `/api/logout` | 로그아웃 |
| `GET` | `/api/me` | 로그인 상태 확인 (`200` 또는 `401`) |
| `GET` | `/api/files` | 파일 목록 (최신순) `{"files": [{id, name, size, contentType, createdAt}]}` |
| `POST` | `/api/files` | `multipart/form-data`, `file` 필드 (여러 개 가능) → `201` + 올라간 파일 정보 |
| `GET` | `/api/files/{id}` | 다운로드. `?inline=1`이면 브라우저에서 바로 열기. 이어받기(Range) 지원 |
| `DELETE` | `/api/files/{id}` | 삭제 → `204` |
| `GET` | `/healthz` | 동작 확인용 |

curl로 시험해 보기:

```bash
curl -c cookie.txt -X POST -d '{"password":"내비밀번호"}' http://127.0.0.1:8080/api/login
curl -b cookie.txt -F file=@보고서.docx http://127.0.0.1:8080/api/files
curl -b cookie.txt http://127.0.0.1:8080/api/files
curl -b cookie.txt -OJ http://127.0.0.1:8080/api/files/1
```

## 아직 안 한 것

- 같은 이름으로 올리면 지금은 별개 파일로 둘 다 남는다 (이전 버전 보관 기능은 나중에)
- 폴더 없음, 전체 용량 표시 없음
- systemd 서비스 등록 (서버 재부팅 시 자동 실행)
