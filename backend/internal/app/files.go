package app

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// File은 API로 주고받는 파일 정보다. `json:"..."` 태그가 JSON 필드 이름을 정한다.
type File struct {
	ID          int64      `json:"id"`
	Name        string     `json:"name"`
	Size        int64      `json:"size"`
	ContentType string     `json:"contentType"`
	Category    string     `json:"category"`  // photo | document | other
	FolderID    *int64     `json:"folderId"`  // null이면 루트
	Stashed     bool       `json:"stashed"`   // false: 사진/문서/기타함에 있음 (메인 화면에 보임), true: 저장공간(폴더 정리 영역)에 있음
	CreatedAt   time.Time  `json:"createdAt"` //
	DeletedAt   *time.Time `json:"deletedAt"` // 휴지통에 들어간 시각 (휴지통이 아니면 null)
}

const fileColumns = `id, name, size, content_type, category, folder_id, stashed, created_at, deleted_at`

// scanFile은 fileColumns 순서로 조회한 행 하나를 File로 바꾼다.
func scanFile(scan func(...any) error) (File, error) {
	var f File
	var created int64
	var folderID, deleted sql.NullInt64
	if err := scan(&f.ID, &f.Name, &f.Size, &f.ContentType, &f.Category, &folderID, &f.Stashed, &created, &deleted); err != nil {
		return f, err
	}
	f.CreatedAt = time.Unix(created, 0).UTC()
	if folderID.Valid {
		f.FolderID = &folderID.Int64
	}
	if deleted.Valid {
		t := time.Unix(deleted.Int64, 0).UTC()
		f.DeletedAt = &t
	}
	return f, nil
}

// GET /api/files — 파일 목록. 쿼리 파라미터로 거른다.
//
//	view=all (기본)  휴지통이 아닌 모든 파일
//	view=home        사진/문서/기타함에 있는 파일 (메인 화면용)
//	view=stash       저장공간으로 보낸(stash) 파일만
//	view=trash       휴지통
//	category=photo|document|other
//	folder=root 또는 폴더 id   그 폴더 바로 안의 파일만
//	limit=숫자
func (a *App) handleListFiles(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var where []string
	var args []any
	order := "created_at DESC, id DESC"

	switch q.Get("view") {
	case "", "all":
		where = append(where, "deleted_at IS NULL")
	case "home":
		where = append(where, "deleted_at IS NULL", "stashed = 0")
	case "stash":
		where = append(where, "deleted_at IS NULL", "stashed = 1")
	case "trash":
		where = append(where, "deleted_at IS NOT NULL")
		order = "deleted_at DESC, id DESC"
	default:
		writeError(w, http.StatusBadRequest, "view 값이 잘못되었습니다")
		return
	}
	if c := q.Get("category"); c != "" {
		if !validCategory(c) {
			writeError(w, http.StatusBadRequest, "category 값이 잘못되었습니다")
			return
		}
		where = append(where, "category = ?")
		args = append(args, c)
	}
	switch folder := q.Get("folder"); folder {
	case "":
	case "root":
		where = append(where, "folder_id IS NULL")
	default:
		id, err := strconv.ParseInt(folder, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "folder 값이 잘못되었습니다")
			return
		}
		where = append(where, "folder_id = ?")
		args = append(args, id)
	}
	query := `SELECT ` + fileColumns + ` FROM files WHERE ` + strings.Join(where, " AND ") + ` ORDER BY ` + order
	if l := q.Get("limit"); l != "" {
		n, err := strconv.Atoi(l)
		if err != nil || n <= 0 {
			writeError(w, http.StatusBadRequest, "limit 값이 잘못되었습니다")
			return
		}
		query += ` LIMIT ?`
		args = append(args, n)
	}

	rows, err := a.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		internalError(w, err)
		return
	}
	defer rows.Close()

	files := []File{} // nil이 아닌 빈 슬라이스로 시작해야 JSON이 null이 아니라 []가 된다.
	for rows.Next() {
		f, err := scanFile(rows.Scan)
		if err != nil {
			internalError(w, err)
			return
		}
		files = append(files, f)
	}
	if err := rows.Err(); err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"files": files})
}

// getFile은 id로 파일 하나를 조회한다. 없으면 sql.ErrNoRows.
func (a *App) getFile(ctx context.Context, id int64) (File, error) {
	return scanFile(a.db.QueryRowContext(ctx, `SELECT `+fileColumns+` FROM files WHERE id = ?`, id).Scan)
}

// POST /api/files — multipart/form-data로 파일을 받는다. "file" 필드를 여러 개 보내면 여러 파일을 한 번에 올린다.
// 기본은 사진/문서/기타함에 들어간다. ?folder=폴더id 면 저장공간의 그 폴더에, ?folder=root 면 저장공간 맨 위에 넣는다.
//
// r.ParseMultipartForm을 쓰면 큰 파일을 메모리/임시 폴더에 통째로 받은 뒤 처리하지만,
// 여기서는 MultipartReader로 조금씩 읽으면서 바로 디스크에 써서 큰 파일도 메모리를 거의 쓰지 않는다.
func (a *App) handleUpload(w http.ResponseWriter, r *http.Request) {
	var folderID *int64
	stashed := false
	if v := r.URL.Query().Get("folder"); v == "root" {
		stashed = true
	} else if v != "" {
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil || !a.folderExists(r.Context(), id) {
			writeError(w, http.StatusBadRequest, "폴더가 없습니다")
			return
		}
		folderID = &id
		stashed = true
	}

	r.Body = http.MaxBytesReader(w, r.Body, a.cfg.MaxUploadBytes)
	mr, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "multipart/form-data 요청이어야 합니다")
		return
	}

	uploaded := []File{}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			a.uploadError(w, err)
			return
		}
		// "file" 필드만 처리하고 나머지 필드는 무시한다.
		if part.FormName() != "file" || part.FileName() == "" {
			part.Close()
			continue
		}
		f, err := a.saveFile(part, cleanFileName(part.FileName()), part.Header.Get("Content-Type"), folderID, stashed)
		part.Close()
		if err != nil {
			a.uploadError(w, err)
			return
		}
		uploaded = append(uploaded, f)
	}
	// 사진이면 썸네일을 미리 만들어 둔다 (목록에 처음 나올 때 바로 보이게)
	for _, f := range uploaded {
		if f.Category == categoryPhoto {
			var storageName string
			if a.db.QueryRow(`SELECT storage_name FROM files WHERE id = ?`, f.ID).Scan(&storageName) == nil {
				a.thumbInBackground(storageName)
			}
		}
	}

	if len(uploaded) == 0 {
		writeError(w, http.StatusBadRequest, "'file' 필드에 파일이 없습니다")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"files": uploaded})
}

func (a *App) uploadError(w http.ResponseWriter, err error) {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		writeError(w, http.StatusRequestEntityTooLarge, "파일이 너무 큽니다")
		return
	}
	internalError(w, err)
}

// saveFile은 내용을 임시 파일에 쓴 뒤, DB에 기록하고, 최종 이름으로 바꾼다.
// 이렇게 하면 업로드 도중 끊겨도 반쯤 쓰인 파일이 목록에 나타나지 않는다.
func (a *App) saveFile(src io.Reader, name, contentType string, folderID *int64, stashed bool) (File, error) {
	storageName, err := randomHex(16)
	if err != nil {
		return File{}, err
	}
	finalPath := filepath.Join(a.filesDir, storageName)

	tmp, err := os.CreateTemp(a.filesDir, "upload-*.tmp")
	if err != nil {
		return File{}, err
	}
	// 중간에 실패하면 임시 파일을 지운다. 성공해서 이름이 바뀐 뒤에는 Remove가 조용히 실패할 뿐이다.
	defer os.Remove(tmp.Name())

	// countingReader가 읽은 바이트 수를 속도 계산용 카운터에 더한다.
	size, err := io.Copy(tmp, &countingReader{r: src, n: &a.stats.up})
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return File{}, err
	}

	if contentType == "" {
		contentType = "application/octet-stream"
	}
	category := categoryOf(name, contentType)
	now := time.Now()
	res, err := a.db.Exec(
		`INSERT INTO files (name, storage_name, size, content_type, category, folder_id, stashed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		name, storageName, size, contentType, category, folderID, stashed, now.Unix())
	if err != nil {
		return File{}, err
	}
	id, _ := res.LastInsertId()

	if err := os.Rename(tmp.Name(), finalPath); err != nil {
		a.db.Exec(`DELETE FROM files WHERE id = ?`, id)
		return File{}, err
	}
	return File{
		ID: id, Name: name, Size: size, ContentType: contentType, Category: category,
		FolderID: folderID, Stashed: stashed, CreatedAt: time.Unix(now.Unix(), 0).UTC(),
	}, nil
}

// GET /api/files/{id} — 파일을 내려받는다.
// 브라우저에서 바로 열고 싶으면 ?inline=1 을 붙인다 (예: 사진 미리보기).
// 휴지통에 있는 파일도 내려받을 수 있다 (지우기 전에 확인할 수 있도록).
func (a *App) handleDownload(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var name, storageName, contentType string
	var created int64
	err := a.db.QueryRowContext(r.Context(),
		`SELECT name, storage_name, content_type, created_at FROM files WHERE id = ?`, id).
		Scan(&name, &storageName, &contentType, &created)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "파일이 없습니다")
		return
	} else if err != nil {
		internalError(w, err)
		return
	}

	f, err := os.Open(filepath.Join(a.filesDir, storageName))
	if err != nil {
		internalError(w, err)
		return
	}
	defer f.Close()

	disposition := "attachment"
	inline := r.URL.Query().Get("inline") == "1"
	if inline {
		disposition = "inline"
	}
	// FormatMediaType은 한글 파일 이름을 filename*=utf-8''... 형태로 알아서 인코딩해 준다.
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": name}))
	w.Header().Set("Content-Type", contentType)
	// 업로드된 HTML 등을 브라우저가 우리 사이트 페이지처럼 실행하지 못하게 막는다.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// 단, 크롬은 sandbox가 걸린 PDF를 보여 주지 않아서 PDF 미리보기일 때만 뺀다.
	// PDF는 브라우저의 PDF 뷰어가 따로 격리해서 열기 때문에 우리 사이트의 쿠키나 화면에 접근할 수 없다.
	if !(inline && contentType == "application/pdf") {
		w.Header().Set("Content-Security-Policy", "sandbox")
	}
	// 같은 id의 파일 내용은 절대 바뀌지 않으므로 브라우저가 캐시해 두고 다시 받지 않게 한다 (사진 미리보기가 빨라짐).
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	// ServeContent는 Range 요청(이어받기, 동영상 탐색)과 캐시 헤더를 알아서 처리한다.
	// countingWriter는 보낸 바이트 수를 속도 계산용 카운터에 더한다.
	http.ServeContent(&countingWriter{ResponseWriter: w, n: &a.stats.down}, r, "", time.Unix(created, 0), f)
}

// DELETE /api/files/{id} — 휴지통으로 옮긴다. ?permanent=1 이면 완전히 지운다.
func (a *App) handleDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	if r.URL.Query().Get("permanent") == "1" {
		err := a.removeFile(r.Context(), id)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "파일이 없습니다")
		} else if err != nil {
			internalError(w, err)
		} else {
			w.WriteHeader(http.StatusNoContent)
		}
		return
	}
	res, err := a.db.ExecContext(r.Context(),
		`UPDATE files SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`, time.Now().Unix(), id)
	a.respondAffected(w, res, err)
}

// POST /api/files/{id}/restore — 휴지통에서 꺼낸다.
func (a *App) handleRestore(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	res, err := a.db.ExecContext(r.Context(),
		`UPDATE files SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`, id)
	a.respondAffected(w, res, err)
}

// respondAffected는 UPDATE 결과에 따라 204(바뀜) 또는 404(대상 없음)를 응답한다.
func (a *App) respondAffected(w http.ResponseWriter, res sql.Result, err error) {
	if err != nil {
		internalError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "파일이 없습니다")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// PATCH /api/files/{id}  {"name": "...", "folderId": 3, "stashed": true}
// 보낸 항목만 바꾼다.
//   - stashed: true  → 사진/문서/기타함에서 꺼내 저장공간으로 보낸다 (stash)
//   - stashed: false → 다시 사진/문서/기타함으로 넣는다 (폴더에서도 빠진다)
//   - folderId       → 저장공간의 그 폴더로 옮긴다 (null이면 저장공간 맨 위). 폴더는 저장공간에만 있으므로 stashed도 true가 된다.
func (a *App) handleUpdateFile(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	// json.RawMessage로 받으면 "필드가 없음"과 "null을 보냄"을 구분할 수 있다.
	var body map[string]json.RawMessage
	if !readJSON(w, r, &body, 4096) {
		return
	}
	var sets []string
	var args []any
	if raw, ok := body["name"]; ok {
		var name string
		if json.Unmarshal(raw, &name) != nil || strings.TrimSpace(name) == "" {
			writeError(w, http.StatusBadRequest, "이름이 잘못되었습니다")
			return
		}
		name = cleanFileName(name)
		sets = append(sets, "name = ?", "category = ?")
		// 이름(확장자)이 바뀌면 종류도 다시 정한다.
		var contentType string
		a.db.QueryRowContext(r.Context(), `SELECT content_type FROM files WHERE id = ?`, id).Scan(&contentType)
		args = append(args, name, categoryOf(name, contentType))
	}
	if raw, ok := body["folderId"]; ok {
		var folderID *int64
		if json.Unmarshal(raw, &folderID) != nil || (folderID != nil && !a.folderExists(r.Context(), *folderID)) {
			writeError(w, http.StatusBadRequest, "폴더가 없습니다")
			return
		}
		sets = append(sets, "folder_id = ?", "stashed = 1")
		args = append(args, folderID)
	} else if raw, ok := body["stashed"]; ok {
		var stashed bool
		if json.Unmarshal(raw, &stashed) != nil {
			writeError(w, http.StatusBadRequest, "stashed 값이 잘못되었습니다")
			return
		}
		if stashed {
			sets = append(sets, "stashed = 1")
		} else {
			sets = append(sets, "stashed = 0", "folder_id = NULL")
		}
	}
	if len(sets) == 0 {
		writeError(w, http.StatusBadRequest, "바꿀 항목이 없습니다")
		return
	}
	args = append(args, id)
	res, err := a.db.ExecContext(r.Context(), `UPDATE files SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
	if err != nil {
		internalError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "파일이 없습니다")
		return
	}
	f, err := a.getFile(r.Context(), id)
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

// DELETE /api/trash — 휴지통 비우기
func (a *App) handleEmptyTrash(w http.ResponseWriter, r *http.Request) {
	if err := a.removeFilesWhere(r.Context(), `deleted_at IS NOT NULL`); err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// purgeTrash는 휴지통에 TrashDays일 넘게 있던 파일을 완전히 지운다.
func (a *App) purgeTrash() {
	if a.cfg.TrashDays <= 0 {
		return
	}
	cutoff := time.Now().AddDate(0, 0, -a.cfg.TrashDays).Unix()
	if err := a.removeFilesWhere(context.Background(), `deleted_at IS NOT NULL AND deleted_at <= ?`, cutoff); err != nil {
		log.Printf("휴지통 정리 실패: %v", err)
	}
}

// removeFile은 파일 하나를 DB와 디스크에서 완전히 지운다.
func (a *App) removeFile(ctx context.Context, id int64) error {
	var storageName string
	// RETURNING: 지우면서 지운 행의 값을 같이 받아온다 (SQLite 3.35+).
	err := a.db.QueryRowContext(ctx, `DELETE FROM files WHERE id = ? RETURNING storage_name`, id).Scan(&storageName)
	if err != nil {
		return err
	}
	a.removeStored(storageName)
	return nil
}

// removeFilesWhere는 조건에 맞는 파일을 모두 DB와 디스크에서 지운다.
func (a *App) removeFilesWhere(ctx context.Context, cond string, args ...any) error {
	rows, err := a.db.QueryContext(ctx, `DELETE FROM files WHERE `+cond+` RETURNING storage_name`, args...)
	if err != nil {
		return err
	}
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return err
		}
		names = append(names, name)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, name := range names {
		a.removeStored(name)
	}
	return nil
}

func (a *App) removeStored(storageName string) {
	if err := os.Remove(filepath.Join(a.filesDir, storageName)); err != nil {
		// DB에서는 이미 지워졌으니 사용자에게는 성공으로 알리고, 서버 로그에만 남긴다.
		log.Printf("파일 삭제 실패 (%s): %v", storageName, err)
	}
	os.Remove(a.thumbPath(storageName)) // 썸네일은 없을 수도 있다
}

func parseID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "잘못된 파일 id입니다")
		return 0, false
	}
	return id, true
}

// cleanFileName은 경로 부분과 제어 문자를 없애고 길이를 제한한다.
// 파일 이름은 DB에만 저장되고 디스크 경로에는 쓰이지 않지만, 화면과 다운로드 헤더에 쓰이므로 정리해 둔다.
func cleanFileName(name string) string {
	name = strings.ReplaceAll(name, "\\", "/") // 윈도우 경로 구분자
	name = filepath.Base(name)
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1 // -1을 돌려주면 그 글자는 빠진다
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	for len(name) > 255 {
		_, size := utf8.DecodeLastRuneInString(name)
		name = name[:len(name)-size] // 한글이 중간에 잘리지 않게 글자 단위로 자른다
	}
	if name == "" || name == "." || name == ".." || name == "/" {
		name = "unnamed"
	}
	return name
}

func randomHex(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// internalError는 자세한 에러는 서버 로그에만 남기고, 사용자에게는 일반적인 메시지만 보낸다.
func internalError(w http.ResponseWriter, err error) {
	log.Printf("internal error: %v", err)
	writeError(w, http.StatusInternalServerError, "서버 오류가 발생했습니다")
}
