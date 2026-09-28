package app

import (
	"database/sql"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestQuota(t *testing.T) {
	a, srv, c := newTestServer(t)
	a.cfg.QuotaBytes = 10
	login(t, c, srv.URL, "correct-horse")

	res := upload(t, c, srv.URL, map[string]string{"a.txt": "123456"})
	res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("용량 안쪽 업로드 = %d", res.StatusCode)
	}
	// 남은 용량은 4바이트
	res = upload(t, c, srv.URL, map[string]string{"b.txt": "12345"})
	res.Body.Close()
	if res.StatusCode != http.StatusInsufficientStorage {
		t.Errorf("용량 초과 업로드 = %d, 507이어야 함", res.StatusCode)
	}
	if n := len(listFiles(t, c, srv.URL)); n != 1 {
		t.Errorf("초과한 파일이 남음: %d개", n)
	}
	res = upload(t, c, srv.URL, map[string]string{"c.txt": "1234"})
	res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		t.Errorf("딱 맞는 업로드 = %d", res.StatusCode)
	}

	var usage map[string]int64
	do(t, c, http.MethodGet, srv.URL+"/api/usage", nil, &usage)
	if usage["quotaBytes"] != 10 || usage["usedBytes"] != 10 {
		t.Errorf("usage = %v", usage)
	}
}

func TestShareLink(t *testing.T) {
	a, srv, c := newTestServer(t)
	a.cfg.ShareTTL = time.Hour
	login(t, c, srv.URL, "correct-horse")
	upload(t, c, srv.URL, map[string]string{"사진.jpg": "img-bytes"}).Body.Close()
	f := listFiles(t, c, srv.URL)[0]

	var share struct {
		Path      string
		ExpiresAt time.Time
	}
	if code := do(t, c, http.MethodPost, srv.URL+"/api/files/"+itoa(f.ID)+"/share", nil, &share); code != http.StatusCreated {
		t.Fatalf("공유 링크 만들기 = %d", code)
	}
	if !strings.HasPrefix(share.Path, "/s/") || time.Until(share.ExpiresAt) < 59*time.Minute {
		t.Fatalf("공유 링크 = %+v", share)
	}

	// 로그인하지 않은 클라이언트로 받을 수 있어야 한다
	get := func(path string) (int, string) {
		res, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(b)
	}
	if code, body := get(share.Path); code != 200 || body != "img-bytes" {
		t.Errorf("공유 링크 다운로드 = %d %q", code, body)
	}
	if code, _ := get("/s/nottherealtoken"); code != http.StatusNotFound {
		t.Errorf("틀린 토큰 = %d", code)
	}
	// 로그인 없이 일반 다운로드 주소는 여전히 막혀 있어야 한다
	if code, _ := get("/api/files/" + itoa(f.ID)); code != http.StatusUnauthorized {
		t.Errorf("로그인 없이 일반 다운로드 = %d", code)
	}

	// 휴지통에 넣으면 링크로 받을 수 없다
	do(t, c, http.MethodDelete, srv.URL+"/api/files/"+itoa(f.ID), nil)
	if code, _ := get(share.Path); code != http.StatusNotFound {
		t.Errorf("휴지통 파일 공유 = %d", code)
	}
	do(t, c, http.MethodPost, srv.URL+"/api/files/"+itoa(f.ID)+"/restore", nil)

	// 만료되면 받을 수 없고, 정리하면 지워진다
	a.db.Exec(`UPDATE shares SET expires_at = ?`, time.Now().Add(-time.Second).Unix())
	if code, _ := get(share.Path); code != http.StatusNotFound {
		t.Errorf("만료된 링크 = %d", code)
	}
	a.purgeShares()
	var n int
	a.db.QueryRow(`SELECT COUNT(*) FROM shares`).Scan(&n)
	if n != 0 {
		t.Errorf("만료된 링크가 %d개 남음", n)
	}
}

// 예전(2번 스키마) DB의 일반 텍스트 메모가 HTML로 바뀌는지 확인한다.
func TestMemoMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	for i, m := range migrations[:2] {
		if _, err := db.Exec(m); err != nil {
			t.Fatalf("마이그레이션 %d: %v", i+1, err)
		}
	}
	db.Exec(`PRAGMA user_version = 2`)
	db.Exec(`INSERT INTO memos (body, created_at, updated_at) VALUES (?, 0, 0)`, "a<b & c\r\n둘째 줄")
	db.Close()

	db, err = openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var title, body string
	db.QueryRow(`SELECT title, body FROM memos`).Scan(&title, &body)
	if title != "" || body != "a&lt;b &amp; c<br>둘째 줄" {
		t.Errorf("바뀐 메모 = %q %q", title, body)
	}
	if got := memoLabel(title, body); got != "a<b & c" {
		t.Errorf("이름 = %q", got)
	}
}
