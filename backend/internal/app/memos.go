package app

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

const maxMemoBytes = 1 << 20 // 메모 하나는 최대 1MB

// Memo는 메인 화면 메모장의 메모 하나다.
type Memo struct {
	ID        int64     `json:"id"`
	Title     string    `json:"title"`          // 첫 줄 (목록에 보여 주기용)
	Body      string    `json:"body,omitempty"` // 목록 조회에서는 비워서 보낸다
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// GET /api/memos — 최근에 고친 메모부터. 본문 없이 제목만.
func (a *App) handleListMemos(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(),
		// 본문 전체 대신 앞부분만 읽어 제목을 만든다.
		`SELECT id, substr(body, 1, 200), created_at, updated_at FROM memos ORDER BY updated_at DESC, id DESC`)
	if err != nil {
		internalError(w, err)
		return
	}
	defer rows.Close()
	memos := []Memo{}
	for rows.Next() {
		var m Memo
		var head string
		var created, updated int64
		if err := rows.Scan(&m.ID, &head, &created, &updated); err != nil {
			internalError(w, err)
			return
		}
		m.Title = memoTitle(head)
		m.CreatedAt, m.UpdatedAt = time.Unix(created, 0).UTC(), time.Unix(updated, 0).UTC()
		memos = append(memos, m)
	}
	if err := rows.Err(); err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"memos": memos})
}

// GET /api/memos/{id}
func (a *App) handleGetMemo(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var m Memo
	var created, updated int64
	err := a.db.QueryRowContext(r.Context(), `SELECT id, body, created_at, updated_at FROM memos WHERE id = ?`, id).
		Scan(&m.ID, &m.Body, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "메모가 없습니다")
		return
	} else if err != nil {
		internalError(w, err)
		return
	}
	m.Title = memoTitle(m.Body)
	m.CreatedAt, m.UpdatedAt = time.Unix(created, 0).UTC(), time.Unix(updated, 0).UTC()
	writeJSON(w, http.StatusOK, m)
}

// POST /api/memos  {"body": "..."}
func (a *App) handleCreateMemo(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Body string `json:"body"`
	}
	if !readJSON(w, r, &body, maxMemoBytes+1024) {
		return
	}
	now := time.Now().Unix()
	res, err := a.db.ExecContext(r.Context(),
		`INSERT INTO memos (body, created_at, updated_at) VALUES (?, ?, ?)`, body.Body, now, now)
	if err != nil {
		internalError(w, err)
		return
	}
	id, _ := res.LastInsertId()
	t := time.Unix(now, 0).UTC()
	writeJSON(w, http.StatusCreated, Memo{ID: id, Title: memoTitle(body.Body), Body: body.Body, CreatedAt: t, UpdatedAt: t})
}

// PUT /api/memos/{id}  {"body": "..."}
func (a *App) handleUpdateMemo(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var body struct {
		Body string `json:"body"`
	}
	if !readJSON(w, r, &body, maxMemoBytes+1024) {
		return
	}
	now := time.Now().Unix()
	var created int64
	err := a.db.QueryRowContext(r.Context(),
		`UPDATE memos SET body = ?, updated_at = ? WHERE id = ? RETURNING created_at`, body.Body, now, id).Scan(&created)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "메모가 없습니다")
		return
	} else if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, Memo{
		ID: id, Title: memoTitle(body.Body), Body: body.Body,
		CreatedAt: time.Unix(created, 0).UTC(), UpdatedAt: time.Unix(now, 0).UTC(),
	})
}

// DELETE /api/memos/{id}
func (a *App) handleDeleteMemo(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	res, err := a.db.ExecContext(r.Context(), `DELETE FROM memos WHERE id = ?`, id)
	if err != nil {
		internalError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "메모가 없습니다")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// memoTitle은 메모의 첫 번째 내용 있는 줄을 50자까지 잘라 제목으로 쓴다.
func memoTitle(body string) string {
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if utf8.RuneCountInString(line) > 50 {
			line = string([]rune(line)[:50]) + "…"
		}
		return line
	}
	return "(빈 메모)"
}
