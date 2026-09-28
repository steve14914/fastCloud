package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

// Folder는 저장공간(stash한 파일을 정리하는 곳)의 폴더다.
type Folder struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	ParentID  *int64    `json:"parentId"` // null이면 저장공간 맨 위
	CreatedAt time.Time `json:"createdAt"`
}

// GET /api/folders — 모든 폴더를 한 번에 돌려준다. 트리 모양은 프론트엔드가 parentId로 만든다.
func (a *App) handleListFolders(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(), `SELECT id, name, parent_id, created_at FROM folders ORDER BY name`)
	if err != nil {
		internalError(w, err)
		return
	}
	defer rows.Close()
	folders := []Folder{}
	for rows.Next() {
		var f Folder
		var parent sql.NullInt64
		var created int64
		if err := rows.Scan(&f.ID, &f.Name, &parent, &created); err != nil {
			internalError(w, err)
			return
		}
		if parent.Valid {
			f.ParentID = &parent.Int64
		}
		f.CreatedAt = time.Unix(created, 0).UTC()
		folders = append(folders, f)
	}
	if err := rows.Err(); err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"folders": folders})
}

// POST /api/folders  {"name": "...", "parentId": null}
func (a *App) handleCreateFolder(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string `json:"name"`
		ParentID *int64 `json:"parentId"`
	}
	if !readJSON(w, r, &body, 4096) {
		return
	}
	name, ok := cleanFolderName(body.Name)
	if !ok {
		writeError(w, http.StatusBadRequest, "폴더 이름을 입력하세요")
		return
	}
	if body.ParentID != nil && !a.folderExists(r.Context(), *body.ParentID) {
		writeError(w, http.StatusBadRequest, "상위 폴더가 없습니다")
		return
	}
	now := time.Now()
	res, err := a.db.ExecContext(r.Context(),
		`INSERT INTO folders (name, parent_id, created_at) VALUES (?, ?, ?)`, name, body.ParentID, now.Unix())
	if err != nil {
		internalError(w, err)
		return
	}
	id, _ := res.LastInsertId()
	writeJSON(w, http.StatusCreated, Folder{ID: id, Name: name, ParentID: body.ParentID, CreatedAt: time.Unix(now.Unix(), 0).UTC()})
}

// PATCH /api/folders/{id}  {"name": "...", "parentId": 3}
// 보낸 항목만 바꾼다. parentId를 null로 보내면 맨 위로 옮긴다.
func (a *App) handleUpdateFolder(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	if !a.folderExists(r.Context(), id) {
		writeError(w, http.StatusNotFound, "폴더가 없습니다")
		return
	}
	var body map[string]json.RawMessage
	if !readJSON(w, r, &body, 4096) {
		return
	}
	if raw, ok := body["name"]; ok {
		var name string
		json.Unmarshal(raw, &name)
		name, ok := cleanFolderName(name)
		if !ok {
			writeError(w, http.StatusBadRequest, "폴더 이름을 입력하세요")
			return
		}
		if _, err := a.db.ExecContext(r.Context(), `UPDATE folders SET name = ? WHERE id = ?`, name, id); err != nil {
			internalError(w, err)
			return
		}
	}
	if raw, ok := body["parentId"]; ok {
		var parentID *int64
		if json.Unmarshal(raw, &parentID) != nil {
			writeError(w, http.StatusBadRequest, "parentId 값이 잘못되었습니다")
			return
		}
		if parentID != nil {
			if !a.folderExists(r.Context(), *parentID) {
				writeError(w, http.StatusBadRequest, "상위 폴더가 없습니다")
				return
			}
			// 폴더를 자기 자신이나 자기 하위 폴더 안으로 옮기면 고리가 생긴다.
			inside, err := a.isInside(r.Context(), *parentID, id)
			if err != nil {
				internalError(w, err)
				return
			}
			if inside {
				writeError(w, http.StatusBadRequest, "폴더를 자기 안으로 옮길 수 없습니다")
				return
			}
		}
		if _, err := a.db.ExecContext(r.Context(), `UPDATE folders SET parent_id = ? WHERE id = ?`, parentID, id); err != nil {
			internalError(w, err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /api/folders/{id} — 폴더를 지운다. 안에 있던 파일과 하위 폴더는 한 칸 위로 올라온다.
func (a *App) handleDeleteFolder(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		internalError(w, err)
		return
	}
	defer tx.Rollback()
	var parent sql.NullInt64
	err = tx.QueryRow(`SELECT parent_id FROM folders WHERE id = ?`, id).Scan(&parent)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "폴더가 없습니다")
		return
	} else if err != nil {
		internalError(w, err)
		return
	}
	for _, q := range []string{
		`UPDATE files SET folder_id = ? WHERE folder_id = ?`,
		`UPDATE folders SET parent_id = ? WHERE parent_id = ?`,
	} {
		if _, err := tx.Exec(q, parent, id); err != nil {
			internalError(w, err)
			return
		}
	}
	if _, err := tx.Exec(`DELETE FROM folders WHERE id = ?`, id); err != nil {
		internalError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) folderExists(ctx context.Context, id int64) bool {
	var one int
	return a.db.QueryRowContext(ctx, `SELECT 1 FROM folders WHERE id = ?`, id).Scan(&one) == nil
}

// isInside는 folder가 ancestor 자신이거나 그 하위 폴더이면 true를 돌려준다.
func (a *App) isInside(ctx context.Context, folder, ancestor int64) (bool, error) {
	var found int
	// WITH RECURSIVE: folder에서 시작해 부모를 따라 맨 위까지 올라가며 ancestor가 있는지 찾는다.
	err := a.db.QueryRowContext(ctx, `
		WITH RECURSIVE up(id) AS (
			SELECT ?
			UNION
			SELECT f.parent_id FROM folders f JOIN up ON f.id = up.id WHERE f.parent_id IS NOT NULL
		)
		SELECT COUNT(*) FROM up WHERE id = ?`, folder, ancestor).Scan(&found)
	return found > 0, err
}

// cleanFolderName은 파일 이름과 같은 규칙으로 정리한다. 비어 있으면 false.
func cleanFolderName(name string) (string, bool) {
	if strings.TrimSpace(name) == "" {
		return "", false
	}
	return cleanFileName(name), true
}

// stash했을 때 들어갈 영구저장소 맨 위의 종류별 폴더 이름
var categoryFolderNames = map[string]string{
	categoryPhoto:    "사진",
	categoryDocument: "문서",
	categoryOther:    "기타파일",
}

// categoryFolder는 파일 종류에 맞는 영구저장소 맨 위 폴더('사진', '문서', '기타파일')의 id를 돌려준다. 없으면 만든다.
// 같은 이름의 폴더가 여러 개면 가장 먼저 만든 것을 쓴다.
func (a *App) categoryFolder(ctx context.Context, category string) (int64, error) {
	name, ok := categoryFolderNames[category]
	if !ok {
		name = categoryFolderNames[categoryOther]
	}
	var id int64
	err := a.db.QueryRowContext(ctx,
		`SELECT id FROM folders WHERE parent_id IS NULL AND name = ? ORDER BY id LIMIT 1`, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	res, err := a.db.ExecContext(ctx, `INSERT INTO folders (name, parent_id, created_at) VALUES (?, NULL, ?)`, name, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}
