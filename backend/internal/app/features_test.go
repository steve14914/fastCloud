package app

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoginWrongUsername(t *testing.T) {
	_, srv, c := newTestServer(t)
	body := strings.NewReader(`{"username":"other","password":"correct-horse"}`)
	res, err := c.Post(srv.URL+"/api/login", "application/json", body)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("틀린 아이디 로그인 = %d, 401이어야 함", res.StatusCode)
	}
}

func TestCategoryOf(t *testing.T) {
	cases := map[string]string{
		"a.JPG": "photo", "b.heic": "photo", "c.pdf": "document", "d.hwp": "document",
		"e.txt": "document", "f.zip": "other", "g.json": "other", "noext": "other",
	}
	for name, want := range cases {
		if got := categoryOf(name, ""); got != want {
			t.Errorf("categoryOf(%q) = %q, want %q", name, got, want)
		}
	}
	if got := categoryOf("clipboard", "image/png"); got != "photo" {
		t.Errorf("확장자 없는 image/png = %q", got)
	}
}

func TestHomeTrashAndRestore(t *testing.T) {
	_, srv, c := newTestServer(t)
	login(t, c, srv.URL, "correct-horse")
	upload(t, c, srv.URL, map[string]string{"cat.jpg": "img", "memo.pdf": "pdf", "x.zip": "zip"}).Body.Close()

	photos := listFilesQ(t, c, srv.URL, "?view=home&category=photo")
	if len(photos) != 1 || photos[0].Name != "cat.jpg" || photos[0].Stashed {
		t.Fatalf("사진함 = %+v", photos)
	}
	id := itoa(photos[0].ID)

	do(t, c, http.MethodDelete, srv.URL+"/api/files/"+id, nil)
	if n := len(listFilesQ(t, c, srv.URL, "?view=home&category=photo")); n != 0 {
		t.Errorf("휴지통으로 간 사진이 사진함에 남아 있음")
	}
	trash := listFilesQ(t, c, srv.URL, "?view=trash")
	if len(trash) != 1 || trash[0].DeletedAt == nil {
		t.Fatalf("휴지통 = %+v", trash)
	}
	var usage map[string]int64
	do(t, c, http.MethodGet, srv.URL+"/api/usage", nil, &usage)
	if usage["usedBytes"] != 9 || usage["trashBytes"] != 3 {
		t.Errorf("용량 = %+v", usage)
	}

	if got := do(t, c, http.MethodPost, srv.URL+"/api/files/"+id+"/restore", nil); got != http.StatusNoContent {
		t.Fatalf("복원 = %d", got)
	}
	if n := len(listFilesQ(t, c, srv.URL, "?view=home&category=photo")); n != 1 {
		t.Errorf("복원 후 사진함 개수 = %d", n)
	}

	// 휴지통 비우기
	do(t, c, http.MethodDelete, srv.URL+"/api/files/"+id, nil)
	if got := do(t, c, http.MethodDelete, srv.URL+"/api/trash", nil); got != http.StatusNoContent {
		t.Fatalf("휴지통 비우기 = %d", got)
	}
	if n := len(listFilesQ(t, c, srv.URL, "?view=trash")); n != 0 {
		t.Errorf("비운 뒤 휴지통 개수 = %d", n)
	}
}

func TestStashAndFolders(t *testing.T) {
	_, srv, c := newTestServer(t)
	login(t, c, srv.URL, "correct-horse")
	upload(t, c, srv.URL, map[string]string{"doc.pdf": "pdf"}).Body.Close()
	doc := listFiles(t, c, srv.URL)[0]
	id := itoa(doc.ID)

	// stash: 임시문서함에서 빠지고 영구저장소의 '문서' 폴더로
	var f File
	do(t, c, http.MethodPatch, srv.URL+"/api/files/"+id, map[string]any{"stashed": true}, &f)
	if !f.Stashed || f.FolderID == nil || f.ExpiresAt != nil {
		t.Fatalf("stash 결과 = %+v", f)
	}
	if n := len(listFilesQ(t, c, srv.URL, "?view=home")); n != 0 {
		t.Errorf("stash한 파일이 메인 화면에 남아 있음")
	}
	if n := len(listFilesQ(t, c, srv.URL, "?folder="+itoa(*f.FolderID))); n != 1 {
		t.Errorf("'문서' 폴더 개수 = %d", n)
	}

	// 폴더 만들고 옮기기
	var parent, child Folder
	do(t, c, http.MethodPost, srv.URL+"/api/folders", map[string]any{"name": "여행"}, &parent)
	do(t, c, http.MethodPost, srv.URL+"/api/folders", map[string]any{"name": "2026", "parentId": parent.ID}, &child)
	do(t, c, http.MethodPatch, srv.URL+"/api/files/"+id, map[string]any{"folderId": child.ID}, &f)
	if f.FolderID == nil || *f.FolderID != child.ID {
		t.Fatalf("폴더 이동 결과 = %+v", f)
	}

	// 폴더를 자기 하위 폴더로 옮기면 안 된다
	if got := do(t, c, http.MethodPatch, srv.URL+"/api/folders/"+itoa(parent.ID), map[string]any{"parentId": child.ID}); got != http.StatusBadRequest {
		t.Errorf("순환 이동 = %d, 400이어야 함", got)
	}

	// 하위 폴더를 지우면 안의 파일은 상위 폴더로 올라온다
	if got := do(t, c, http.MethodDelete, srv.URL+"/api/folders/"+itoa(child.ID), nil); got != http.StatusNoContent {
		t.Fatalf("폴더 삭제 = %d", got)
	}
	files := listFilesQ(t, c, srv.URL, "?folder="+itoa(parent.ID))
	if len(files) != 1 {
		t.Fatalf("상위 폴더 파일 = %+v", files)
	}

	// 다시 문서함으로: 폴더에서도 빠진다
	do(t, c, http.MethodPatch, srv.URL+"/api/files/"+id, map[string]any{"stashed": false}, &f)
	if f.Stashed || f.FolderID != nil {
		t.Fatalf("함으로 되돌리기 결과 = %+v", f)
	}

	// 폴더로 바로 업로드하면 저장공간에 들어간다
	res := uploadTo(t, c, srv.URL+"/api/files?folder="+itoa(parent.ID), map[string]string{"p.png": "img"})
	var up struct{ Files []File }
	json.NewDecoder(res.Body).Decode(&up)
	res.Body.Close()
	if len(up.Files) != 1 || !up.Files[0].Stashed || up.Files[0].FolderID == nil || *up.Files[0].FolderID != parent.ID {
		t.Errorf("폴더 업로드 결과 = %+v", up.Files)
	}
}

func TestMemos(t *testing.T) {
	_, srv, c := newTestServer(t)
	login(t, c, srv.URL, "correct-horse")
	var m Memo
	if got := do(t, c, http.MethodPost, srv.URL+"/api/memos", map[string]string{"body": "\n  장보기 목록\n우유"}, &m); got != http.StatusCreated {
		t.Fatalf("메모 만들기 = %d", got)
	}
	if m.Label != "장보기 목록" {
		t.Errorf("이름 = %q", m.Label)
	}
	do(t, c, http.MethodPut, srv.URL+"/api/memos/"+itoa(m.ID), map[string]string{"title": "", "body": "<div><b>바뀐</b> 내용&amp;</div><div>둘째 줄</div>"}, &m)
	if m.Label != "바뀐 내용&" {
		t.Errorf("HTML 본문 이름 = %q", m.Label)
	}
	do(t, c, http.MethodPut, srv.URL+"/api/memos/"+itoa(m.ID), map[string]string{"title": " 할 일 ", "body": "바뀐 내용"}, &m)
	var got Memo
	do(t, c, http.MethodGet, srv.URL+"/api/memos/"+itoa(m.ID), nil, &got)
	if got.Body != "바뀐 내용" || got.Title != "할 일" || got.Label != "할 일" {
		t.Errorf("메모 = %+v", got)
	}
	var list struct{ Memos []Memo }
	do(t, c, http.MethodGet, srv.URL+"/api/memos", nil, &list)
	if len(list.Memos) != 1 || list.Memos[0].Body != "" {
		t.Errorf("목록 = %+v", list.Memos)
	}
	if code := do(t, c, http.MethodDelete, srv.URL+"/api/memos/"+itoa(m.ID), nil); code != http.StatusNoContent {
		t.Errorf("메모 삭제 = %d", code)
	}
}

func TestTransferStatsCountsDownload(t *testing.T) {
	a, srv, c := newTestServer(t)
	login(t, c, srv.URL, "correct-horse")
	upload(t, c, srv.URL, map[string]string{"a.bin": "12345"}).Body.Close()
	f := listFiles(t, c, srv.URL)[0]
	res, _ := c.Get(srv.URL + "/api/files/" + itoa(f.ID))
	io.ReadAll(res.Body)
	res.Body.Close()
	if a.stats.up.Load() != 5 || a.stats.down.Load() != 5 {
		t.Errorf("up=%d down=%d, 둘 다 5여야 함", a.stats.up.Load(), a.stats.down.Load())
	}
}

func TestWebFallback(t *testing.T) {
	a, srv, c := newTestServer(t)
	a.cfg.WebDir = t.TempDir()
	os.WriteFile(filepath.Join(a.cfg.WebDir, "index.html"), []byte("<html>app</html>"), 0o600)

	res, _ := c.Get(srv.URL + "/files")
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || string(body) != "<html>app</html>" {
		t.Errorf("/files = %d %q, index.html이어야 함", res.StatusCode, body)
	}
	res, _ = c.Get(srv.URL + "/api/nope")
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("/api/nope = %d, 404여야 함", res.StatusCode)
	}
}

func TestGoogleLogin(t *testing.T) {
	a, srv, c := newTestServer(t)

	// 구글 대신 응답하는 가짜 서버
	email := "me@gmail.com"
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			r.ParseForm()
			if r.Form.Get("code") != "good-code" || r.Form.Get("client_secret") != "secret" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"access_token": "tok"})
		case "/userinfo":
			if r.Header.Get("Authorization") != "Bearer tok" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"email": email, "email_verified": true})
		}
	}))
	defer fake.Close()
	a.google = googleEndpoints{authURL: fake.URL + "/auth", tokenURL: fake.URL + "/token", userinfoURL: fake.URL + "/userinfo"}
	a.cfg.PublicURL = srv.URL
	a.cfg.GoogleClientID, a.cfg.GoogleClientSecret, a.cfg.GoogleEmail = "id", "secret", "Me@gmail.com"

	// 리다이렉트를 따라가지 않고 직접 확인한다.
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

	start := func() string {
		res, err := c.Get(srv.URL + "/api/auth/google/start")
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		loc, _ := url.Parse(res.Header.Get("Location"))
		if !strings.HasPrefix(loc.String(), fake.URL+"/auth") {
			t.Fatalf("start 리다이렉트 = %s", loc)
		}
		return loc.Query().Get("state")
	}
	callback := func(state string) string {
		res, err := c.Get(srv.URL + "/api/auth/google/callback?code=good-code&state=" + state)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.Header.Get("Location")
	}

	// state가 틀리면 실패
	start()
	if loc := callback("wrong"); !strings.Contains(loc, "error=state") {
		t.Errorf("틀린 state = %s", loc)
	}
	// 다른 계정이면 실패
	email = "someone@gmail.com"
	if loc := callback(start()); !strings.Contains(loc, "error=not_allowed") {
		t.Errorf("다른 계정 = %s", loc)
	}
	// 내 계정이면 성공 (대소문자 무시)
	email = "me@gmail.com"
	if loc := callback(start()); loc != "/" {
		t.Fatalf("내 계정 로그인 리다이렉트 = %s", loc)
	}
	res, _ := c.Get(srv.URL + "/api/me")
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Errorf("구글 로그인 후 /api/me = %d", res.StatusCode)
	}
}
