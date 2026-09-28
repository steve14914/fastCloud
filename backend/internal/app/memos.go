package app

import (
	"database/sql"
	"errors"
	"html"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const maxMemoBytes = 1 << 20 // 메모 하나는 최대 1MB

// Memo는 메인 화면 메모장의 메모 하나다.
type Memo struct {
	ID        int64     `json:"id"`
	Title     string    `json:"title"`          // 사용자가 적은 제목 (비어 있을 수 있음)
	Label     string    `json:"label"`          // 목록·탭에 보여 줄 이름: 제목, 없으면 본문 첫 줄
	Body      string    `json:"body,omitempty"` // 서식이 들어간 HTML. 목록 조회에서는 비워서 보낸다
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// GET /api/memos — 최근에 고친 메모부터. 본문 없이 제목만.
func (a *App) handleListMemos(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(),
		// 제목이 없을 때 쓰려고 본문은 전체 대신 앞부분만 읽는다.
		`SELECT id, title, substr(body, 1, 1000), created_at, updated_at FROM memos ORDER BY updated_at DESC, id DESC`)
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
		if err := rows.Scan(&m.ID, &m.Title, &head, &created, &updated); err != nil {
			internalError(w, err)
			return
		}
		m.Label = memoLabel(m.Title, head)
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
	err := a.db.QueryRowContext(r.Context(), `SELECT id, title, body, created_at, updated_at FROM memos WHERE id = ?`, id).
		Scan(&m.ID, &m.Title, &m.Body, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "메모가 없습니다")
		return
	} else if err != nil {
		internalError(w, err)
		return
	}
	m.Label = memoLabel(m.Title, m.Body)
	m.CreatedAt, m.UpdatedAt = time.Unix(created, 0).UTC(), time.Unix(updated, 0).UTC()
	writeJSON(w, http.StatusOK, m)
}

// memoInput은 메모를 만들거나 저장할 때 받는 값이다.
type memoInput struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// readMemo는 요청에서 메모를 읽고 제목을 정리한다.
func readMemo(w http.ResponseWriter, r *http.Request) (memoInput, bool) {
	var in memoInput
	if !readJSON(w, r, &in, maxMemoBytes+1024) {
		return in, false
	}
	in.Title = strings.TrimSpace(strings.ReplaceAll(in.Title, "\n", " "))
	for len(in.Title) > 500 {
		_, size := utf8.DecodeLastRuneInString(in.Title)
		in.Title = in.Title[:len(in.Title)-size]
	}
	return in, true
}

// POST /api/memos  {"title": "...", "body": "<HTML>"}
func (a *App) handleCreateMemo(w http.ResponseWriter, r *http.Request) {
	in, ok := readMemo(w, r)
	if !ok {
		return
	}
	now := time.Now().Unix()
	res, err := a.db.ExecContext(r.Context(),
		`INSERT INTO memos (title, body, created_at, updated_at) VALUES (?, ?, ?, ?)`, in.Title, in.Body, now, now)
	if err != nil {
		internalError(w, err)
		return
	}
	id, _ := res.LastInsertId()
	t := time.Unix(now, 0).UTC()
	writeJSON(w, http.StatusCreated, Memo{ID: id, Title: in.Title, Label: memoLabel(in.Title, in.Body), Body: in.Body, CreatedAt: t, UpdatedAt: t})
}

// PUT /api/memos/{id}  {"title": "...", "body": "<HTML>"}
func (a *App) handleUpdateMemo(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	in, ok := readMemo(w, r)
	if !ok {
		return
	}
	now := time.Now().Unix()
	var created int64
	err := a.db.QueryRowContext(r.Context(),
		`UPDATE memos SET title = ?, body = ?, updated_at = ? WHERE id = ? RETURNING created_at`, in.Title, in.Body, now, id).Scan(&created)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "메모가 없습니다")
		return
	} else if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, Memo{
		ID: id, Title: in.Title, Label: memoLabel(in.Title, in.Body), Body: in.Body,
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

// memoLabel은 목록과 탭에 보여 줄 이름을 정한다.
// 제목이 있으면 제목, 없으면 본문의 첫 번째 내용 있는 줄을 50자까지 자른다.
func memoLabel(title, body string) string {
	if title != "" {
		return shorten(title)
	}
	for _, line := range strings.Split(htmlToText(body), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			return shorten(line)
		}
	}
	return "(빈 메모)"
}

func shorten(s string) string {
	if utf8.RuneCountInString(s) > 50 {
		return string([]rune(s)[:50]) + "…"
	}
	return s
}

var (
	// 줄이 바뀌는 태그 (<br>, </div>, </p>, </li>, </h1> 등)
	lineBreakTags = regexp.MustCompile(`(?i)<br\s*/?>|</(div|p|li|h[1-6])>`)
	anyTag        = regexp.MustCompile(`<[^>]*>`)
)

// htmlToText는 메모 본문 HTML에서 태그를 빼고 글자만 남긴다 (제목 만들기용이라 대충이어도 된다).
func htmlToText(s string) string {
	s = lineBreakTags.ReplaceAllString(s, "\n")
	s = anyTag.ReplaceAllString(s, "")
	return html.UnescapeString(s)
}
