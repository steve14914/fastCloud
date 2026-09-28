// Package app은 fastcloud 백엔드의 HTTP 서버를 구현한다.
package app

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Config는 서버 설정이다. main.go에서 환경 변수를 읽어 채운다.
type Config struct {
	DataDir        string        // DB 파일과 업로드 파일이 저장될 폴더
	MaxUploadBytes int64         // 요청 한 번에 올릴 수 있는 최대 크기
	SecureCookie   bool          // true면 HTTPS에서만 쿠키가 전송된다 (운영 환경에서는 반드시 true)
	TrustProxy     bool          // true면 X-Forwarded-For 헤더로 클라이언트 IP를 판단한다 (Caddy 뒤에 있을 때)
	SessionTTL     time.Duration // 로그인 유지 기간
	TrashDays      int           // 휴지통에 들어간 파일을 며칠 뒤에 완전히 지울지 (0이면 자동으로 지우지 않음)
	WebDir         string        // 프론트엔드 빌드 결과(frontend/dist)가 있는 폴더. 없으면 API만 제공한다

	// 구글 로그인 (선택). 세 값이 모두 있어야 켜진다.
	PublicURL          string // 사이트 주소, 예: https://내도메인.duckdns.org (구글이 로그인 후 돌아올 주소를 만드는 데 사용)
	GoogleClientID     string
	GoogleClientSecret string
	GoogleEmail        string // 로그인을 허용할 구글 계정 (나 한 명)
}

// App은 서버가 동작하는 데 필요한 모든 것을 묶어 둔 구조체다.
// NestJS로 치면 여러 서비스가 주입된 모듈 하나라고 생각하면 된다.
type App struct {
	cfg       Config
	db        *sql.DB
	filesDir  string
	thumbsDir string
	limiter   *loginLimiter
	stats     *transferStats
	google    googleEndpoints
	stop      chan struct{}  // 닫히면 백그라운드 작업이 멈춘다
	wg        sync.WaitGroup // 썸네일 만들기 등 진행 중인 백그라운드 작업 (Close에서 끝날 때까지 기다린다)
}

// Open은 데이터 폴더를 준비하고 DB를 연다.
func Open(cfg Config) (*App, error) {
	filesDir := filepath.Join(cfg.DataDir, "files")
	// 0o700: 소유자(서버를 실행하는 계정)만 읽고 쓸 수 있다.
	thumbsDir := filepath.Join(cfg.DataDir, "thumbs")
	for _, dir := range []string{filesDir, thumbsDir} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, err
		}
	}
	db, err := openDB(filepath.Join(cfg.DataDir, "fastcloud.db"))
	if err != nil {
		return nil, err
	}
	if err := backfillCategories(db); err != nil {
		db.Close()
		return nil, err
	}
	a := &App{
		cfg:       cfg,
		db:        db,
		filesDir:  filesDir,
		thumbsDir: thumbsDir,
		limiter:   newLoginLimiter(5, 15*time.Minute),
		stats:     &transferStats{},
		google:    defaultGoogleEndpoints,
		stop:      make(chan struct{}),
	}
	go a.background()
	return a, nil
}

func (a *App) Close() error {
	close(a.stop)
	a.wg.Wait()
	return a.db.Close()
}

// background는 서버가 켜져 있는 동안 주기적인 작업을 한다.
//   - 1초마다: 업로드/다운로드 속도 계산
//   - 1시간마다: 오래된 휴지통 파일 정리
func (a *App) background() {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	a.purgeTrash()
	lastPurge := time.Now()
	for {
		select {
		case <-a.stop:
			return
		case now := <-tick.C:
			a.stats.sample(now)
			if now.Sub(lastPurge) >= time.Hour {
				a.purgeTrash()
				lastPurge = now
			}
		}
	}
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
	mux.HandleFunc("GET /api/auth/config", a.handleAuthConfig)
	mux.HandleFunc("GET /api/auth/google/start", a.handleGoogleStart)
	mux.HandleFunc("GET /api/auth/google/callback", a.handleGoogleCallback)

	// 로그인 필요 (requireAuth가 세션을 검사한다)
	mux.Handle("POST /api/logout", a.requireAuth(a.handleLogout))
	mux.Handle("GET /api/me", a.requireAuth(a.handleMe))

	mux.Handle("GET /api/files", a.requireAuth(a.handleListFiles))
	mux.Handle("POST /api/files", a.requireAuth(a.handleUpload))
	mux.Handle("GET /api/files/{id}", a.requireAuth(a.handleDownload))
	mux.Handle("GET /api/files/{id}/thumb", a.requireAuth(a.handleThumb))
	mux.Handle("PATCH /api/files/{id}", a.requireAuth(a.handleUpdateFile))
	mux.Handle("DELETE /api/files/{id}", a.requireAuth(a.handleDelete))
	mux.Handle("POST /api/files/{id}/restore", a.requireAuth(a.handleRestore))
	mux.Handle("DELETE /api/trash", a.requireAuth(a.handleEmptyTrash))

	mux.Handle("GET /api/folders", a.requireAuth(a.handleListFolders))
	mux.Handle("POST /api/folders", a.requireAuth(a.handleCreateFolder))
	mux.Handle("PATCH /api/folders/{id}", a.requireAuth(a.handleUpdateFolder))
	mux.Handle("DELETE /api/folders/{id}", a.requireAuth(a.handleDeleteFolder))

	mux.Handle("GET /api/memos", a.requireAuth(a.handleListMemos))
	mux.Handle("POST /api/memos", a.requireAuth(a.handleCreateMemo))
	mux.Handle("GET /api/memos/{id}", a.requireAuth(a.handleGetMemo))
	mux.Handle("PUT /api/memos/{id}", a.requireAuth(a.handleUpdateMemo))
	mux.Handle("DELETE /api/memos/{id}", a.requireAuth(a.handleDeleteMemo))

	mux.Handle("GET /api/usage", a.requireAuth(a.handleUsage))
	mux.Handle("GET /api/stats/transfer", a.requireAuth(a.handleTransferStats))

	// 그 밖의 경로는 프론트엔드 화면 (index.html, JS, CSS)
	mux.HandleFunc("GET /", a.handleWeb)

	return logRequests(mux)
}

// readJSON은 요청 본문 JSON을 v에 읽는다. 실패하면 400을 응답하고 false를 돌려준다.
func readJSON(w http.ResponseWriter, r *http.Request, v any, maxBytes int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "잘못된 요청입니다")
		return false
	}
	return true
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
