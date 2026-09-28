package app

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

// newTestServer는 임시 폴더를 데이터 폴더로 쓰는 테스트 서버와, 쿠키를 기억하는 클라이언트를 만든다.
func newTestServer(t *testing.T) (*App, *httptest.Server, *http.Client) {
	t.Helper()
	a, err := Open(Config{
		DataDir:        t.TempDir(),
		MaxUploadBytes: 1 << 20, // 테스트에서는 1MB로 제한
		SecureCookie:   false,   // httptest 서버는 HTTP라서
		SessionTTL:     time.Hour,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.Close() })
	if err := a.SetPassword("correct-horse"); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(a.Handler())
	t.Cleanup(srv.Close)
	jar, _ := cookiejar.New(nil)
	return a, srv, &http.Client{Jar: jar}
}

func login(t *testing.T, c *http.Client, url, password string) int {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"password": password})
	res, err := c.Post(url+"/api/login", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode
}

func upload(t *testing.T, c *http.Client, url string, files map[string]string) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for name, content := range files {
		fw, _ := mw.CreateFormFile("file", name)
		fw.Write([]byte(content))
	}
	mw.Close()
	res, err := c.Post(url+"/api/files", mw.FormDataContentType(), &buf)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func listFiles(t *testing.T, c *http.Client, url string) []File {
	t.Helper()
	res, err := c.Get(url + "/api/files")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("목록 조회 상태 코드 = %d", res.StatusCode)
	}
	var out struct{ Files []File }
	json.NewDecoder(res.Body).Decode(&out)
	return out.Files
}

func TestRequiresLogin(t *testing.T) {
	_, srv, c := newTestServer(t)
	for _, path := range []string{"/api/files", "/api/me", "/api/files/1"} {
		res, err := c.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusUnauthorized {
			t.Errorf("GET %s = %d, 401이어야 함", path, res.StatusCode)
		}
	}
}

func TestLoginWrongPassword(t *testing.T) {
	_, srv, c := newTestServer(t)
	if got := login(t, c, srv.URL, "wrong"); got != http.StatusUnauthorized {
		t.Fatalf("틀린 비밀번호 로그인 = %d, 401이어야 함", got)
	}
}

func TestLoginRateLimit(t *testing.T) {
	_, srv, c := newTestServer(t)
	for i := 0; i < 5; i++ {
		login(t, c, srv.URL, "wrong")
	}
	// 5번 틀린 뒤에는 맞는 비밀번호도 잠시 막힌다.
	if got := login(t, c, srv.URL, "correct-horse"); got != http.StatusTooManyRequests {
		t.Fatalf("제한 후 로그인 = %d, 429여야 함", got)
	}
}

func TestFileLifecycle(t *testing.T) {
	a, srv, c := newTestServer(t)
	if got := login(t, c, srv.URL, "correct-horse"); got != http.StatusNoContent {
		t.Fatalf("로그인 = %d", got)
	}

	// 업로드 (한글 이름 포함, 두 개 동시에)
	res := upload(t, c, srv.URL, map[string]string{"보고서.txt": "hello", "b.bin": "world!"})
	res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("업로드 = %d", res.StatusCode)
	}

	files := listFiles(t, c, srv.URL)
	if len(files) != 2 {
		t.Fatalf("파일 개수 = %d, 2여야 함", len(files))
	}
	var report File
	for _, f := range files {
		if f.Name == "보고서.txt" {
			report = f
		}
	}
	if report.ID == 0 || report.Size != 5 {
		t.Fatalf("보고서.txt 정보가 이상함: %+v", report)
	}

	// 다운로드
	res, err := c.Get(srv.URL + "/api/files/" + itoa(report.ID))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(body) != "hello" {
		t.Errorf("다운로드 내용 = %q", body)
	}
	if cd := res.Header.Get("Content-Disposition"); !strings.Contains(cd, "attachment") || !strings.Contains(cd, "utf-8''") {
		t.Errorf("Content-Disposition = %q", cd)
	}

	// 삭제
	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/api/files/"+itoa(report.ID), nil)
	res, err = c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("삭제 = %d", res.StatusCode)
	}
	if n := len(listFiles(t, c, srv.URL)); n != 1 {
		t.Errorf("삭제 후 파일 개수 = %d, 1이어야 함", n)
	}
	res, _ = c.Get(srv.URL + "/api/files/" + itoa(report.ID))
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("삭제된 파일 다운로드 = %d, 404여야 함", res.StatusCode)
	}

	// 디스크에는 남은 파일 하나만 있어야 한다 (임시 파일도 없어야 함)
	entries, _ := os.ReadDir(a.filesDir)
	if len(entries) != 1 {
		t.Errorf("디스크 파일 개수 = %d, 1이어야 함", len(entries))
	}

	// 로그아웃하면 다시 401
	res, _ = c.Post(srv.URL+"/api/logout", "", nil)
	res.Body.Close()
	res, _ = c.Get(srv.URL + "/api/files")
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Errorf("로그아웃 후 목록 = %d, 401이어야 함", res.StatusCode)
	}
}

func TestUploadTooLarge(t *testing.T) {
	a, srv, c := newTestServer(t)
	login(t, c, srv.URL, "correct-horse")
	res := upload(t, c, srv.URL, map[string]string{"big.bin": strings.Repeat("x", 2<<20)})
	res.Body.Close()
	if res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("큰 파일 업로드 = %d, 413이어야 함", res.StatusCode)
	}
	if n := len(listFiles(t, c, srv.URL)); n != 0 {
		t.Errorf("파일 개수 = %d, 0이어야 함", n)
	}
	entries, _ := os.ReadDir(a.filesDir)
	if len(entries) != 0 {
		t.Errorf("임시 파일이 남아 있음: %d개", len(entries))
	}
}

func TestPasswordChangeLogsOut(t *testing.T) {
	a, srv, c := newTestServer(t)
	login(t, c, srv.URL, "correct-horse")
	if err := a.SetPassword("new-password"); err != nil {
		t.Fatal(err)
	}
	res, _ := c.Get(srv.URL + "/api/me")
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("비밀번호 변경 후 /api/me = %d, 401이어야 함", res.StatusCode)
	}
}

func TestCleanFileName(t *testing.T) {
	cases := map[string]string{
		"a.txt":                "a.txt",
		"../../etc/passwd":     "passwd",
		`C:\Users\me\보고서.docx`: "보고서.docx",
		"bad\x00name\n.txt":    "badname.txt",
		"":                     "unnamed",
		"..":                   "unnamed",
	}
	for in, want := range cases {
		if got := cleanFileName(in); got != want {
			t.Errorf("cleanFileName(%q) = %q, want %q", in, got, want)
		}
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
