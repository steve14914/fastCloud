package app

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStashGoesToCategoryFolders(t *testing.T) {
	_, srv, c := newTestServer(t)
	login(t, c, srv.URL, "correct-horse")
	upload(t, c, srv.URL, map[string]string{"a.jpg": "1", "b.pdf": "2", "c.zip": "3", "d.png": "4"}).Body.Close()

	for _, f := range listFiles(t, c, srv.URL) {
		do(t, c, http.MethodPatch, srv.URL+"/api/files/"+itoa(f.ID), map[string]any{"stashed": true})
	}
	var folders struct{ Folders []Folder }
	do(t, c, http.MethodGet, srv.URL+"/api/folders", nil, &folders)
	byName := map[string]int64{}
	for _, f := range folders.Folders {
		if f.ParentID != nil {
			t.Errorf("종류별 폴더가 맨 위가 아님: %+v", f)
		}
		byName[f.Name] = f.ID
	}
	if len(byName) != 3 || byName["사진"] == 0 || byName["문서"] == 0 || byName["기타파일"] == 0 {
		t.Fatalf("폴더 = %+v", folders.Folders)
	}
	for name, want := range map[string]int{"사진": 2, "문서": 1, "기타파일": 1} {
		if n := len(listFilesQ(t, c, srv.URL, "?folder="+itoa(byName[name]))); n != want {
			t.Errorf("%s 폴더 파일 수 = %d, want %d", name, n, want)
		}
	}
}

func TestTempFilesExpireToTrash(t *testing.T) {
	a, srv, c := newTestServer(t)
	a.cfg.TempDays = 30
	a.cfg.TrashDays = 30
	login(t, c, srv.URL, "correct-horse")
	upload(t, c, srv.URL, map[string]string{"old.txt": "1", "new.txt": "2", "kept.txt": "3"}).Body.Close()
	files := listFiles(t, c, srv.URL)
	ids := map[string]int64{}
	for _, f := range files {
		ids[f.Name] = f.ID
		if f.ExpiresAt == nil || time.Until(*f.ExpiresAt) < 29*24*time.Hour {
			t.Errorf("임시함 파일의 expiresAt = %v", f.ExpiresAt)
		}
	}
	// kept.txt는 영구저장소로, old.txt는 31일 전에 들어간 것으로
	do(t, c, http.MethodPost, srv.URL+"/api/files/move", map[string]any{"ids": []int64{ids["kept.txt"]}, "folderId": nil})
	old := time.Now().AddDate(0, 0, -31).Unix()
	a.db.Exec(`UPDATE files SET boxed_at = ? WHERE id IN (?, ?)`, old, ids["old.txt"], ids["kept.txt"])

	a.cleanup()

	trash := listFilesQ(t, c, srv.URL, "?view=trash")
	if len(trash) != 1 || trash[0].Name != "old.txt" {
		t.Fatalf("휴지통 = %+v", trash)
	}
	if trash[0].ExpiresAt == nil || time.Until(*trash[0].ExpiresAt) < 29*24*time.Hour {
		t.Errorf("휴지통 expiresAt = %v", trash[0].ExpiresAt)
	}
	if n := len(listFiles(t, c, srv.URL)); n != 2 {
		t.Errorf("남은 파일 = %d", n)
	}

	// 복구하면 기간이 새로 시작되어 다시 정리되지 않는다
	do(t, c, http.MethodPost, srv.URL+"/api/files/"+itoa(ids["old.txt"])+"/restore", nil)
	a.cleanup()
	if n := len(listFilesQ(t, c, srv.URL, "?view=trash")); n != 0 {
		t.Errorf("복구한 파일이 다시 휴지통으로 감")
	}
}

func TestQuotaPurgesOldestTrash(t *testing.T) {
	a, srv, c := newTestServer(t)
	login(t, c, srv.URL, "correct-horse")
	upload(t, c, srv.URL, map[string]string{"a.txt": "aaaaaaaaaa"}).Body.Close() // 10
	upload(t, c, srv.URL, map[string]string{"b.txt": "bbbbbbbbbb"}).Body.Close() // 10
	upload(t, c, srv.URL, map[string]string{"k.txt": "kkkkkkkkkk"}).Body.Close() // 10
	ids := map[string]int64{}
	for _, f := range listFiles(t, c, srv.URL) {
		ids[f.Name] = f.ID
	}
	do(t, c, http.MethodDelete, srv.URL+"/api/files/"+itoa(ids["a.txt"]), nil)
	do(t, c, http.MethodDelete, srv.URL+"/api/files/"+itoa(ids["b.txt"]), nil)
	a.db.Exec(`UPDATE files SET deleted_at = deleted_at - 100 WHERE id = ?`, ids["a.txt"]) // a가 더 오래됨

	// 요청 크기(multipart 포함)만큼 자리가 필요하다: 할당을 "지금 사용량 + 요청 크기 - 5"로 잡으면
	// 가장 오래된 휴지통 파일(a) 하나만 지워져야 한다.
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", "n.txt")
	fw.Write([]byte("nnnnnnnnnn"))
	mw.Close()
	a.cfg.QuotaBytes = 30 + int64(buf.Len()) - 5
	res := upload(t, c, srv.URL, map[string]string{"n.txt": "nnnnnnnnnn"})
	res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("업로드 = %d", res.StatusCode)
	}
	trash := listFilesQ(t, c, srv.URL, "?view=trash")
	if len(trash) != 1 || trash[0].Name != "b.txt" {
		t.Fatalf("휴지통 = %+v (a만 지워져야 함)", trash)
	}

	// 휴지통을 다 비워도 모자라면 거절하고, 휴지통이 아닌 파일은 건드리지 않는다
	a.cfg.QuotaBytes = 20 // 휴지통이 아닌 파일(k, n)만으로 꽉 참
	res = upload(t, c, srv.URL, map[string]string{"x.txt": "x"})
	res.Body.Close()
	if res.StatusCode != http.StatusInsufficientStorage {
		t.Errorf("초과 업로드 = %d", res.StatusCode)
	}
	if n := len(listFilesQ(t, c, srv.URL, "?view=trash")); n != 0 {
		t.Errorf("휴지통이 비워지지 않음")
	}
	if n := len(listFiles(t, c, srv.URL)); n != 2 {
		t.Errorf("휴지통이 아닌 파일 수 = %d, 2여야 함", n)
	}
}

func TestBatchMoveAndCopy(t *testing.T) {
	a, srv, c := newTestServer(t)
	a.cfg.TempDays = 30
	login(t, c, srv.URL, "correct-horse")
	upload(t, c, srv.URL, map[string]string{"a.txt": "hello", "b.txt": "world"}).Body.Close()
	var ids []int64
	for _, f := range listFiles(t, c, srv.URL) {
		ids = append(ids, f.ID)
	}
	var folder Folder
	do(t, c, http.MethodPost, srv.URL+"/api/folders", map[string]any{"name": "모음"}, &folder)

	if code := do(t, c, http.MethodPost, srv.URL+"/api/files/move", map[string]any{"ids": ids, "folderId": folder.ID}); code != http.StatusNoContent {
		t.Fatalf("이동 = %d", code)
	}
	if n := len(listFilesQ(t, c, srv.URL, "?folder="+itoa(folder.ID))); n != 2 {
		t.Fatalf("폴더 안 파일 = %d", n)
	}
	if n := len(listFilesQ(t, c, srv.URL, "?view=home")); n != 0 {
		t.Errorf("임시함에 남음 %d", n)
	}

	// 임시함으로 복사
	var out struct{ Files []File }
	if code := do(t, c, http.MethodPost, srv.URL+"/api/files/copy", map[string]any{"ids": ids, "box": true}, &out); code != http.StatusCreated {
		t.Fatalf("복사 = %d", code)
	}
	if len(out.Files) != 2 || out.Files[0].Stashed || out.Files[0].ExpiresAt == nil {
		t.Fatalf("복사 결과 = %+v", out.Files)
	}
	// 복사본을 지워도 원본 내용은 남아 있어야 한다
	do(t, c, http.MethodDelete, srv.URL+"/api/files/"+itoa(out.Files[0].ID)+"?permanent=1", nil)
	res, err := c.Get(srv.URL + "/api/files/" + itoa(ids[0]))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Errorf("원본 다운로드 = %d", res.StatusCode)
	}
	entries, _ := os.ReadDir(filepath.Join(a.cfg.DataDir, "files"))
	if len(entries) != 3 {
		t.Errorf("디스크 파일 수 = %d, 3이어야 함", len(entries))
	}

	// 없는 폴더, 빈 목록은 400
	if code := do(t, c, http.MethodPost, srv.URL+"/api/files/move", map[string]any{"ids": ids, "folderId": 999}); code != http.StatusBadRequest {
		t.Errorf("없는 폴더 = %d", code)
	}
	if code := do(t, c, http.MethodPost, srv.URL+"/api/files/copy", map[string]any{"ids": []int64{}}); code != http.StatusBadRequest {
		t.Errorf("빈 목록 = %d", code)
	}

	// 용량이 모자라면 복사도 거절
	a.cfg.QuotaBytes = 12
	if code := do(t, c, http.MethodPost, srv.URL+"/api/files/copy", map[string]any{"ids": ids, "folderId": nil}); code != http.StatusInsufficientStorage {
		t.Errorf("용량 초과 복사 = %d", code)
	}
}
