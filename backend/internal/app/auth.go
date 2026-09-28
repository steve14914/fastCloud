package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const sessionCookieName = "fastcloud_session"

// SetPassword는 비밀번호를 bcrypt로 해시해서 저장한다. (fastcloud passwd 명령에서 사용)
// bcrypt는 일부러 느리게 만든 해시라서 DB가 유출돼도 비밀번호를 알아내기 어렵다.
func (a *App) SetPassword(password string) error {
	if len(password) < 8 {
		return errors.New("비밀번호는 8자 이상이어야 합니다")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	// 비밀번호를 바꾸면 기존 로그인 세션은 모두 끊는다.
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() // Commit 이후에 호출되면 아무 일도 하지 않는다.
	if _, err := tx.Exec(
		`INSERT INTO settings (key, value) VALUES ('password_hash', ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`, string(hash)); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM sessions`); err != nil {
		return err
	}
	return tx.Commit()
}

// SetUsername은 로그인 아이디를 저장한다. (fastcloud passwd 명령에서 사용)
func (a *App) SetUsername(username string) error {
	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("아이디를 입력하세요")
	}
	_, err := a.db.Exec(
		`INSERT INTO settings (key, value) VALUES ('username', ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`, username)
	return err
}

func (a *App) passwordHash() (string, error) {
	return a.setting("password_hash")
}

func (a *App) setting(key string) (string, error) {
	var value string
	err := a.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&value)
	return value, err
}

// POST /api/login  {"username": "...", "password": "..."}
// 아이디를 아직 정하지 않았으면(예전 버전에서 passwd만 한 경우) 아이디는 검사하지 않는다.
func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := a.clientIP(r)
	if !a.limiter.allow(ip) {
		writeError(w, http.StatusTooManyRequests, "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요")
		return
	}

	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !readJSON(w, r, &body, 4096) {
		return
	}

	hash, err := a.passwordHash()
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusServiceUnavailable, "비밀번호가 아직 설정되지 않았습니다. 서버에서 'fastcloud passwd'를 실행하세요")
		return
	} else if err != nil {
		internalError(w, err)
		return
	}
	usernameOK := true
	if username, err := a.setting("username"); err == nil {
		// ConstantTimeCompare: 글자를 비교하는 데 걸리는 시간으로 아이디를 추측하지 못하게 한다.
		usernameOK = subtle.ConstantTimeCompare([]byte(username), []byte(strings.TrimSpace(body.Username))) == 1
	}
	// 아이디가 틀려도 비밀번호 검사는 한다 (응답 시간으로 아이디가 맞았는지 알 수 없게).
	passwordOK := bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.Password)) == nil
	if !usernameOK || !passwordOK {
		a.limiter.fail(ip)
		writeError(w, http.StatusUnauthorized, "아이디 또는 비밀번호가 틀렸습니다")
		return
	}
	a.limiter.reset(ip)

	if err := a.startSession(w); err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// startSession은 새 세션을 만들고 로그인 쿠키를 심는다.
func (a *App) startSession(w http.ResponseWriter) error {
	token, err := a.createSession()
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(a.cfg.SessionTTL.Seconds()),
		HttpOnly: true,                 // 자바스크립트에서 쿠키를 읽을 수 없게 한다 (XSS 대비)
		Secure:   a.cfg.SecureCookie,   // HTTPS에서만 전송
		SameSite: http.SameSiteLaxMode, // 다른 사이트에서 보낸 POST/DELETE 요청에는 쿠키가 붙지 않는다 (CSRF 대비)
	})
	return nil
}

// POST /api/logout
func (a *App) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookieName); err == nil {
		a.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, hashToken(c.Value))
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1, // 쿠키 삭제
		HttpOnly: true,
		Secure:   a.cfg.SecureCookie,
		SameSite: http.SameSiteLaxMode,
	})
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/me — 프론트엔드가 "로그인되어 있는지" 확인할 때 쓴다. 로그인 안 됐으면 requireAuth가 401을 준다.
func (a *App) handleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"loggedIn": true})
}

// createSession은 무작위 토큰을 만들어 DB에 (해시로) 저장하고 원본 토큰을 돌려준다.
func (a *App) createSession() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	token := hex.EncodeToString(buf)
	now := time.Now()
	// 로그인할 때마다 만료된 세션을 정리한다.
	if _, err := a.db.Exec(`DELETE FROM sessions WHERE expires_at <= ?`, now.Unix()); err != nil {
		return "", err
	}
	_, err := a.db.Exec(`INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)`,
		hashToken(token), now.Unix(), now.Add(a.cfg.SessionTTL).Unix())
	return token, err
}

// hashToken: DB가 유출돼도 쿠키 값을 알 수 없도록 토큰은 해시로만 저장한다.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// requireAuth는 로그인한 요청만 next로 넘기는 미들웨어다. (NestJS의 Guard와 비슷한 역할)
func (a *App) requireAuth(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookieName)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "로그인이 필요합니다")
			return
		}
		var expiresAt int64
		err = a.db.QueryRowContext(r.Context(),
			`SELECT expires_at FROM sessions WHERE token_hash = ?`, hashToken(c.Value)).Scan(&expiresAt)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && expiresAt <= time.Now().Unix()) {
			writeError(w, http.StatusUnauthorized, "로그인이 필요합니다")
			return
		} else if err != nil {
			if !errors.Is(err, context.Canceled) {
				internalError(w, err)
			}
			return
		}
		next(w, r)
	})
}

// clientIP는 요청을 보낸 클라이언트의 IP를 구한다.
// Caddy 뒤에서 돌면 RemoteAddr는 항상 127.0.0.1이므로, TrustProxy일 때는 Caddy가 붙여 준
// X-Forwarded-For의 마지막 값(= Caddy가 직접 본 IP)을 쓴다.
func (a *App) clientIP(r *http.Request) string {
	if a.cfg.TrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// loginLimiter는 IP별 로그인 실패 횟수를 세서 무차별 대입 공격을 막는다.
// 서버가 재시작되면 기록이 초기화되는 단순한 메모리 방식이다.
type loginLimiter struct {
	mu       sync.Mutex // 여러 요청(고루틴)이 동시에 map을 건드리지 않도록 잠근다
	max      int
	window   time.Duration
	failures map[string][]time.Time
}

func newLoginLimiter(max int, window time.Duration) *loginLimiter {
	return &loginLimiter{max: max, window: window, failures: map[string][]time.Time{}}
}

// allow는 이 IP가 최근 window 안에 max번 이상 실패했으면 false를 돌려준다.
func (l *loginLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := time.Now().Add(-l.window)
	recent := l.failures[ip][:0]
	for _, t := range l.failures[ip] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	if len(recent) == 0 {
		delete(l.failures, ip)
	} else {
		l.failures[ip] = recent
	}
	return len(recent) < l.max
}

func (l *loginLimiter) fail(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.failures[ip] = append(l.failures[ip], time.Now())
}

func (l *loginLimiter) reset(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.failures, ip)
}
