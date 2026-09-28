package app

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// 구글 로그인 (OAuth 2.0 "authorization code" 방식)
//
//  1. 로그인 화면의 "구글로 로그인" 버튼 → /api/auth/google/start
//  2. 서버가 구글 로그인 페이지로 보낸다 (state라는 무작위 값을 쿠키에도 저장)
//  3. 사용자가 구글에서 로그인하면 구글이 /api/auth/google/callback?code=...&state=... 로 돌려보낸다
//  4. 서버가 code를 구글에 보내 access token을 받고, 그걸로 이메일 주소를 조회한다
//  5. 이메일이 FASTCLOUD_GOOGLE_EMAIL과 같으면 로그인 성공 (세션 쿠키를 심고 메인 화면으로)
//
// state는 다른 사이트가 3번 주소를 몰래 열게 해서 남의 계정으로 로그인시키는 공격(CSRF)을 막는다.

type googleEndpoints struct {
	authURL, tokenURL, userinfoURL string
}

var defaultGoogleEndpoints = googleEndpoints{
	authURL:     "https://accounts.google.com/o/oauth2/v2/auth",
	tokenURL:    "https://oauth2.googleapis.com/token",
	userinfoURL: "https://openidconnect.googleapis.com/v1/userinfo",
}

const oauthStateCookie = "fastcloud_oauth_state"

func (a *App) googleEnabled() bool {
	return a.cfg.GoogleClientID != "" && a.cfg.GoogleClientSecret != "" && a.cfg.GoogleEmail != "" && a.cfg.PublicURL != ""
}

func (a *App) googleRedirectURI() string {
	return strings.TrimRight(a.cfg.PublicURL, "/") + "/api/auth/google/callback"
}

// GET /api/auth/config — 로그인 화면에서 구글 버튼을 보여 줄지 정할 때 쓴다.
func (a *App) handleAuthConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"google": a.googleEnabled()})
}

// GET /api/auth/google/start
func (a *App) handleGoogleStart(w http.ResponseWriter, r *http.Request) {
	if !a.googleEnabled() {
		writeError(w, http.StatusNotFound, "구글 로그인이 설정되지 않았습니다")
		return
	}
	state, err := randomHex(16)
	if err != nil {
		internalError(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookie,
		Value:    state,
		Path:     "/api/auth/google",
		MaxAge:   600, // 10분 안에 로그인을 마쳐야 한다
		HttpOnly: true,
		Secure:   a.cfg.SecureCookie,
		SameSite: http.SameSiteLaxMode, // 구글에서 돌아오는 요청(GET)에는 쿠키가 붙는다
	})
	q := url.Values{
		"client_id":     {a.cfg.GoogleClientID},
		"redirect_uri":  {a.googleRedirectURI()},
		"response_type": {"code"},
		"scope":         {"openid email"},
		"state":         {state},
		"prompt":        {"select_account"},
		"login_hint":    {a.cfg.GoogleEmail},
	}
	http.Redirect(w, r, a.google.authURL+"?"+q.Encode(), http.StatusFound)
}

// GET /api/auth/google/callback
func (a *App) handleGoogleCallback(w http.ResponseWriter, r *http.Request) {
	// 실패하면 로그인 화면으로 돌려보내고 화면에 이유를 보여 준다.
	fail := func(reason string, err error) {
		if err != nil {
			log.Printf("구글 로그인 실패 (%s): %v", reason, err)
		}
		http.Redirect(w, r, "/login?error="+url.QueryEscape(reason), http.StatusFound)
	}
	if !a.googleEnabled() {
		fail("google_disabled", nil)
		return
	}
	ip := a.clientIP(r)
	if !a.limiter.allow(ip) {
		fail("too_many", nil)
		return
	}

	c, err := r.Cookie(oauthStateCookie)
	state := r.URL.Query().Get("state")
	if err != nil || state == "" || subtle.ConstantTimeCompare([]byte(c.Value), []byte(state)) != 1 {
		fail("state", nil)
		return
	}
	// 쓴 state 쿠키는 지운다.
	http.SetCookie(w, &http.Cookie{Name: oauthStateCookie, Path: "/api/auth/google", MaxAge: -1,
		HttpOnly: true, Secure: a.cfg.SecureCookie, SameSite: http.SameSiteLaxMode})

	code := r.URL.Query().Get("code")
	if code == "" {
		// 사용자가 구글 화면에서 취소한 경우 등
		fail("cancelled", nil)
		return
	}
	email, verified, err := a.googleEmail(r, code)
	if err != nil {
		fail("google_error", err)
		return
	}
	if !verified || !strings.EqualFold(email, a.cfg.GoogleEmail) {
		a.limiter.fail(ip)
		log.Printf("허용되지 않은 구글 계정으로 로그인 시도: %s", email)
		fail("not_allowed", nil)
		return
	}
	a.limiter.reset(ip)
	if err := a.startSession(w); err != nil {
		fail("server", err)
		return
	}
	http.Redirect(w, r, "/", http.StatusFound)
}

// googleEmail은 code를 access token으로 바꾸고, 그 토큰으로 사용자 이메일을 조회한다.
func (a *App) googleEmail(r *http.Request, code string) (email string, verified bool, err error) {
	client := &http.Client{Timeout: 10 * time.Second}

	res, err := client.PostForm(a.google.tokenURL, url.Values{
		"code":          {code},
		"client_id":     {a.cfg.GoogleClientID},
		"client_secret": {a.cfg.GoogleClientSecret},
		"redirect_uri":  {a.googleRedirectURI()},
		"grant_type":    {"authorization_code"},
	})
	if err != nil {
		return "", false, err
	}
	var token struct {
		AccessToken string `json:"access_token"`
	}
	err = json.NewDecoder(res.Body).Decode(&token)
	res.Body.Close()
	if err != nil || res.StatusCode != http.StatusOK || token.AccessToken == "" {
		return "", false, fmt.Errorf("토큰 발급 실패 (상태 %d): %v", res.StatusCode, err)
	}

	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, a.google.userinfoURL, nil)
	req.Header.Set("Authorization", "Bearer "+token.AccessToken)
	res, err = client.Do(req)
	if err != nil {
		return "", false, err
	}
	defer res.Body.Close()
	var info struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
	}
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil || res.StatusCode != http.StatusOK {
		return "", false, fmt.Errorf("사용자 정보 조회 실패 (상태 %d): %v", res.StatusCode, err)
	}
	return info.Email, info.EmailVerified, nil
}
