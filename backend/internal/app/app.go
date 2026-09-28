// Package app은 fastcloud 백엔드의 HTTP 서버를 구현한다.
package app

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// Config는 서버 설정이다. main.go에서 환경 변수를 읽어 채운다.
type Config struct {
	DataDir        string        // DB 파일과 업로드 파일이 저장될 폴더
	MaxUploadBytes int64         // 요청 한 번에 올릴 수 있는 최대 크기
	SecureCookie   bool          // true면 HTTPS에서만 쿠키가 전송된다 (운영 환경에서는 반드시 true)
	TrustProxy     bool          // true면 X-Forwarded-For 헤더로 클라이언트 IP를 판단한다 (Caddy 뒤에 있을 때)
	SessionTTL     time.Duration // 로그인 유지 기간
}

// App은 서버가 동작하는 데 필요한 모든 것을 묶어 둔 구조체다.
// NestJS로 치면 여러 서비스가 주입된 모듈 하나라고 생각하면 된다.
type App struct {
	cfg      Config
	db       *sql.DB
	filesDir string
	limiter  *loginLimiter
}

// Open은 데이터 폴더를 준비하고 DB를 연다.
func Open(cfg Config) (*App, error) {
	filesDir := filepath.Join(cfg.DataDir, "files")
	// 0o700: 소유자(서버를 실행하는 계정)만 읽고 쓸 수 있다.
	if err := os.MkdirAll(filesDir, 0o700); err != nil {
		return nil, err
	}
	db, err := openDB(filepath.Join(cfg.DataDir, "fastcloud.db"))
	if err != nil {
		return nil, err
	}
	return &App{
		cfg:      cfg,
		db:       db,
		filesDir: filesDir,
		limiter:  newLoginLimiter(5, 15*time.Minute),
	}, nil
}

func (a *App) Close() error {
	return a.db.Close()
}

// Handler는 모든 라우트가 등록된 http.Handler를 돌려준다.
// Go 1.22부터 표준 라이브러리 ServeMux가 "메서드 경로"와 {id} 같은 경로 변수를 지원한다.
func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	// 로그인 없이 접근 가능
	mux.HandleFunc("POST /api/login", a.handleLogin)

	// 로그인 필요 (requireAuth가 세션을 검사한다)
	mux.Handle("POST /api/logout", a.requireAuth(a.handleLogout))
	mux.Handle("GET /api/me", a.requireAuth(a.handleMe))
	mux.Handle("GET /api/files", a.requireAuth(a.handleListFiles))
	mux.Handle("POST /api/files", a.requireAuth(a.handleUpload))
	mux.Handle("GET /api/files/{id}", a.requireAuth(a.handleDownload))
	mux.Handle("DELETE /api/files/{id}", a.requireAuth(a.handleDelete))

	return logRequests(mux)
}

// writeJSON은 값을 JSON으로 응답한다.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// writeError는 {"error": "..."} 형태로 에러를 응답한다.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// statusRecorder는 로그에 남기려고 응답 상태 코드를 기억해 둔다.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Unwrap이 있어야 http.ServeContent 등이 원래 ResponseWriter의 기능을 쓸 수 있다.
func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, rec.status, time.Since(start).Round(time.Millisecond))
	})
}
