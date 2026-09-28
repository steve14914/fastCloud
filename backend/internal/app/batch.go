package app

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// 여러 파일·폴더를 한 번에 옮기거나 복사한다 (화면의 "선택" 기능).

// batchTarget은 옮기거나 복사할 것과 그곳이다. ids는 파일, folderIds는 폴더(안의 내용 포함).
//
//	{"ids": [1,2], "box": true}                        임시함으로 (종류는 파일마다 정해져 있다. 폴더는 안 됨)
//	{"ids": [1,2], "folderIds": [5], "folderId": null} 영구저장소 맨 위로
//	{"ids": [1,2], "folderIds": [5], "folderId": 3}    영구저장소의 폴더 3으로
type batchTarget struct {
	IDs       []int64 `json:"ids"`
	FolderIDs []int64 `json:"folderIds"`
	FolderID  *int64  `json:"folderId"`
	Box       bool    `json:"box"`
}

const maxBatch = 5000

func (a *App) readBatch(w http.ResponseWriter, r *http.Request) (batchTarget, bool) {
	var body batchTarget
	if !readJSON(w, r, &body, 1<<20) {
		return body, false
	}
	n := len(body.IDs) + len(body.FolderIDs)
	if n == 0 || n > maxBatch {
		writeError(w, http.StatusBadRequest, "파일을 골라 주세요")
		return body, false
	}
	if body.Box && len(body.FolderIDs) > 0 {
		writeError(w, http.StatusBadRequest, "폴더는 임시함으로 옮기거나 복사할 수 없어요")
		return body, false
	}
	if !body.Box && body.FolderID != nil {
		if !a.folderExists(r.Context(), *body.FolderID) {
			writeError(w, http.StatusBadRequest, "폴더가 없습니다")
			return body, false
		}
		// 폴더를 자기 자신이나 자기 하위 폴더 안으로 옮기거나 복사하면 끝없이 이어진다.
		for _, fid := range body.FolderIDs {
			inside, err := a.isInside(r.Context(), *body.FolderID, fid)
			if err != nil {
				internalError(w, err)
				return body, false
			}
			if inside {
				writeError(w, http.StatusBadRequest, "폴더를 자기 안으로 옮기거나 복사할 수 없어요")
				return body, false
			}
		}
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

// POST /api/files/move — 고른 파일·폴더를 옮긴다. 휴지통에 있는 파일은 건너뛴다. → 204
func (a *App) handleMoveFiles(w http.ResponseWriter, r *http.Request) {
	body, ok := a.readBatch(w, r)
	if !ok {
		return
	}
	if len(body.FolderIDs) > 0 {
		marks, ids := inClause(body.FolderIDs)
		if _, err := a.db.ExecContext(r.Context(), `UPDATE folders SET parent_id = ? WHERE id IN (`+marks+`)`,
			append([]any{body.FolderID}, ids...)...); err != nil {
			internalError(w, err)
			return
		}
	}
	if len(body.IDs) == 0 {
		w.WriteHeader(http.StatusNoContent)
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

// POST /api/files/copy — 고른 파일·폴더를 복사한다. 폴더는 안의 파일과 하위 폴더까지 통째로 복사한다.
// → 201 {"files": [...], "folders": [...]} (새로 만든 맨 위 항목들)
//
// 파일 내용은 올린 뒤 절대 바뀌지 않으므로, 디스크에는 하드 링크로 "같은 내용을 가리키는 이름"만 하나 더 만든다.
// 그래서 큰 파일도 복사가 즉시 끝나고 디스크도 더 쓰지 않는다. 한쪽을 지워도 다른 쪽은 그대로 남는다.
// (할당 용량 계산에는 복사본 크기도 들어간다.)
func (a *App) handleCopyFiles(w http.ResponseWriter, r *http.Request) {
	body, ok := a.readBatch(w, r)
	if !ok {
		return
	}
	ctx := r.Context()

	var srcs []storedFile
	if len(body.IDs) > 0 {
		marks, ids := inClause(body.IDs)
		var err error
		if srcs, err = a.storedFiles(ctx, `id IN (`+marks+`)`, ids...); err != nil {
			internalError(w, err)
			return
		}
	}
	total := int64(0)
	for _, s := range srcs {
		total += s.f.Size
	}
	if len(body.FolderIDs) > 0 {
		// 폴더들 안(하위 폴더 포함)에 있는 파일 크기의 합
		marks, ids := inClause(body.FolderIDs)
		var inFolders int64
		err := a.db.QueryRowContext(ctx, `
			WITH RECURSIVE sub(id) AS (
				SELECT id FROM folders WHERE id IN (`+marks+`)
				UNION SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
			)
			SELECT COALESCE(SUM(size), 0) FROM files WHERE deleted_at IS NULL AND folder_id IN (SELECT id FROM sub)`,
			ids...).Scan(&inFolders)
		if err != nil {
			internalError(w, err)
			return
		}
		total += inFolders
	}

	remaining, err := a.makeRoom(ctx, total)
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
		f, err := a.copyStored(ctx, s.storageName, s.f, folderID, stashed)
		if err != nil {
			internalError(w, err)
			return
		}
		copied = append(copied, f)
	}
	folders := []Folder{}
	for _, fid := range body.FolderIDs {
		f, err := a.copyFolder(ctx, fid, folderID)
		if errors.Is(err, sql.ErrNoRows) {
			continue // 그사이 지워진 폴더
		} else if err != nil {
			internalError(w, err)
			return
		}
		folders = append(folders, f)
	}
	writeJSON(w, http.StatusCreated, map[string]any{"files": copied, "folders": folders})
}

// storedFile은 복사할 파일 정보와 디스크 이름이다.
type storedFile struct {
	storageName string
	f           File
}

// storedFiles는 조건에 맞는, 휴지통이 아닌 파일들을 읽는다.
func (a *App) storedFiles(ctx context.Context, cond string, args ...any) ([]storedFile, error) {
	rows, err := a.db.QueryContext(ctx,
		`SELECT storage_name, `+fileColumns+` FROM files WHERE deleted_at IS NULL AND `+cond+` ORDER BY created_at, id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []storedFile
	for rows.Next() {
		var s storedFile
		f, err := scanFile(func(dest ...any) error { return rows.Scan(append([]any{&s.storageName}, dest...)...) })
		if err != nil {
			return nil, err
		}
		s.f = f
		out = append(out, s)
	}
	return out, rows.Err()
}

// copyFolder는 폴더 src를 parent 안에 같은 이름으로 만들고, 안의 파일과 하위 폴더를 모두 복사한다.
func (a *App) copyFolder(ctx context.Context, src int64, parent *int64) (Folder, error) {
	var name string
	if err := a.db.QueryRowContext(ctx, `SELECT name FROM folders WHERE id = ?`, src).Scan(&name); err != nil {
		return Folder{}, err
	}
	// 하위 폴더 목록을 먼저 읽어 둔다 (복사하면서 새로 생기는 폴더를 다시 복사하지 않도록)
	var children []int64
	rows, err := a.db.QueryContext(ctx, `SELECT id FROM folders WHERE parent_id = ? ORDER BY id`, src)
	if err != nil {
		return Folder{}, err
	}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return Folder{}, err
		}
		children = append(children, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return Folder{}, err
	}
	files, err := a.storedFiles(ctx, `folder_id = ?`, src)
	if err != nil {
		return Folder{}, err
	}

	now := time.Now().Unix()
	res, err := a.db.ExecContext(ctx, `INSERT INTO folders (name, parent_id, created_at) VALUES (?, ?, ?)`, name, parent, now)
	if err != nil {
		return Folder{}, err
	}
	id, _ := res.LastInsertId()
	for _, s := range files {
		if _, err := a.copyStored(ctx, s.storageName, s.f, &id, true); err != nil {
			return Folder{}, err
		}
	}
	for _, c := range children {
		if _, err := a.copyFolder(ctx, c, &id); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return Folder{}, err
		}
	}
	return Folder{ID: id, Name: name, ParentID: parent, CreatedAt: time.Unix(now, 0).UTC()}, nil
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
