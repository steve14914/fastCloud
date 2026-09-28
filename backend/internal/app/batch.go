package app

import (
	"context"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// 여러 파일을 한 번에 옮기거나 복사한다 (화면의 "선택" 기능).

// batchTarget은 옮기거나 복사할 곳이다.
//
//	{"ids": [1,2], "box": true}        임시함으로 (종류는 파일마다 정해져 있다)
//	{"ids": [1,2], "folderId": null}   영구저장소 맨 위로
//	{"ids": [1,2], "folderId": 3}      영구저장소의 폴더 3으로
type batchTarget struct {
	IDs      []int64 `json:"ids"`
	FolderID *int64  `json:"folderId"`
	Box      bool    `json:"box"`
}

const maxBatch = 5000

func (a *App) readBatch(w http.ResponseWriter, r *http.Request) (batchTarget, bool) {
	var body batchTarget
	if !readJSON(w, r, &body, 1<<20) {
		return body, false
	}
	if len(body.IDs) == 0 || len(body.IDs) > maxBatch {
		writeError(w, http.StatusBadRequest, "파일을 골라 주세요")
		return body, false
	}
	if !body.Box && body.FolderID != nil && !a.folderExists(r.Context(), *body.FolderID) {
		writeError(w, http.StatusBadRequest, "폴더가 없습니다")
		return body, false
	}
	return body, true
}

// inClause는 "?, ?, ?"와 그에 맞는 인자를 만든다.
func inClause(ids []int64) (string, []any) {
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return strings.TrimSuffix(strings.Repeat("?, ", len(ids)), ", "), args
}

// POST /api/files/move — 고른 파일들을 옮긴다. 휴지통에 있는 파일은 건너뛴다. → 204
func (a *App) handleMoveFiles(w http.ResponseWriter, r *http.Request) {
	body, ok := a.readBatch(w, r)
	if !ok {
		return
	}
	marks, ids := inClause(body.IDs)
	var err error
	if body.Box {
		// 임시함으로 새로 들어가는 파일만 자동 정리 기간을 새로 시작한다
		_, err = a.db.ExecContext(r.Context(),
			`UPDATE files SET boxed_at = CASE WHEN stashed = 1 THEN ? ELSE boxed_at END, stashed = 0, folder_id = NULL
			 WHERE deleted_at IS NULL AND id IN (`+marks+`)`,
			append([]any{time.Now().Unix()}, ids...)...)
	} else {
		_, err = a.db.ExecContext(r.Context(),
			`UPDATE files SET folder_id = ?, stashed = 1 WHERE deleted_at IS NULL AND id IN (`+marks+`)`,
			append([]any{body.FolderID}, ids...)...)
	}
	if err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/files/copy — 고른 파일들을 복사한다. → 201 {"files": [...]}
//
// 파일 내용은 올린 뒤 절대 바뀌지 않으므로, 디스크에는 하드 링크로 "같은 내용을 가리키는 이름"만 하나 더 만든다.
// 그래서 큰 파일도 복사가 즉시 끝나고 디스크도 더 쓰지 않는다. 한쪽을 지워도 다른 쪽은 그대로 남는다.
// (할당 용량 계산에는 복사본 크기도 들어간다.)
func (a *App) handleCopyFiles(w http.ResponseWriter, r *http.Request) {
	body, ok := a.readBatch(w, r)
	if !ok {
		return
	}
	marks, ids := inClause(body.IDs)
	type src struct {
		storageName string
		f           File
	}
	rows, err := a.db.QueryContext(r.Context(),
		`SELECT storage_name, `+fileColumns+` FROM files WHERE deleted_at IS NULL AND id IN (`+marks+`) ORDER BY created_at, id`, ids...)
	if err != nil {
		internalError(w, err)
		return
	}
	var srcs []src
	var total int64
	for rows.Next() {
		var s src
		var storage string
		f, err := scanFile(func(dest ...any) error { return rows.Scan(append([]any{&storage}, dest...)...) })
		if err != nil {
			rows.Close()
			internalError(w, err)
			return
		}
		s.storageName, s.f = storage, f
		srcs = append(srcs, s)
		total += f.Size
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		internalError(w, err)
		return
	}

	remaining, err := a.makeRoom(r.Context(), total)
	if err != nil {
		internalError(w, err)
		return
	}
	if remaining >= 0 && total > remaining {
		a.uploadError(w, errQuotaExceeded)
		return
	}

	stashed := !body.Box
	folderID := body.FolderID
	if body.Box {
		folderID = nil
	}
	copied := []File{}
	for _, s := range srcs {
		f, err := a.copyStored(r.Context(), s.storageName, s.f, folderID, stashed)
		if err != nil {
			internalError(w, err)
			return
		}
		copied = append(copied, f)
	}
	writeJSON(w, http.StatusCreated, map[string]any{"files": copied})
}

// copyStored는 파일 하나를 복사해 새 행을 만든다.
func (a *App) copyStored(ctx context.Context, storageName string, orig File, folderID *int64, stashed bool) (File, error) {
	newName, err := randomHex(16)
	if err != nil {
		return File{}, err
	}
	srcPath, dstPath := filepath.Join(a.filesDir, storageName), filepath.Join(a.filesDir, newName)
	if err := os.Link(srcPath, dstPath); err != nil {
		// 하드 링크를 못 만드는 파일 시스템이면 내용을 복사한다
		if err := copyFileContents(srcPath, dstPath); err != nil {
			return File{}, err
		}
	}
	now := time.Now().Unix()
	res, err := a.db.ExecContext(ctx,
		`INSERT INTO files (name, storage_name, size, content_type, category, folder_id, stashed, created_at, boxed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		orig.Name, newName, orig.Size, orig.ContentType, orig.Category, folderID, stashed, now, now)
	if err != nil {
		os.Remove(dstPath)
		return File{}, err
	}
	id, _ := res.LastInsertId()
	// 썸네일도 같은 내용이므로 링크로 재사용한다 (없으면 필요할 때 만들어진다)
	if orig.Category == categoryPhoto {
		if os.Link(a.thumbPath(storageName), a.thumbPath(newName)) != nil {
			a.thumbInBackground(newName)
		}
	}
	f := File{
		ID: id, Name: orig.Name, Size: orig.Size, ContentType: orig.ContentType, Category: orig.Category,
		FolderID: folderID, Stashed: stashed, CreatedAt: time.Unix(now, 0).UTC(), boxedAt: now,
	}
	a.setExpiry(&f)
	return f, nil
}

func copyFileContents(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(dst)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(dst)
		log.Printf("복사 실패: %v", err)
		return err
	}
	return nil
}
