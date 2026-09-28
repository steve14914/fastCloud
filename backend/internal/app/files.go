package app

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
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
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Size        int64     `json:"size"`
	ContentType string    `json:"contentType"`
	CreatedAt   time.Time `json:"createdAt"`
}

// GET /api/files — 최근에 올린 파일부터 목록을 돌려준다.
func (a *App) handleListFiles(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(),
		`SELECT id, name, size, content_type, created_at FROM files ORDER BY created_at DESC, id DESC`)
	if err != nil {
		internalError(w, err)
		return
	}
	defer rows.Close()

	files := []File{} // nil이 아닌 빈 슬라이스로 시작해야 JSON이 null이 아니라 []가 된다.
	for rows.Next() {
		var f File
		var created int64
		if err := rows.Scan(&f.ID, &f.Name, &f.Size, &f.ContentType, &created); err != nil {
			internalError(w, err)
			return
		}
		f.CreatedAt = time.Unix(created, 0).UTC()
		files = append(files, f)
	}
	if err := rows.Err(); err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"files": files})
}

// POST /api/files — multipart/form-data로 파일을 받는다. "file" 필드를 여러 개 보내면 여러 파일을 한 번에 올린다.
//
// r.ParseMultipartForm을 쓰면 큰 파일을 메모리/임시 폴더에 통째로 받은 뒤 처리하지만,
// 여기서는 MultipartReader로 조금씩 읽으면서 바로 디스크에 써서 큰 파일도 메모리를 거의 쓰지 않는다.
func (a *App) handleUpload(w http.ResponseWriter, r *http.Request) {
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
		f, err := a.saveFile(part, cleanFileName(part.FileName()), part.Header.Get("Content-Type"))
		part.Close()
		if err != nil {
			a.uploadError(w, err)
			return
		}
		uploaded = append(uploaded, f)
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
func (a *App) saveFile(src io.Reader, name, contentType string) (File, error) {
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

	size, err := io.Copy(tmp, src)
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return File{}, err
	}

	if contentType == "" {
		contentType = "application/octet-stream"
	}
	now := time.Now()
	res, err := a.db.Exec(
		`INSERT INTO files (name, storage_name, size, content_type, created_at) VALUES (?, ?, ?, ?, ?)`,
		name, storageName, size, contentType, now.Unix())
	if err != nil {
		return File{}, err
	}
	id, _ := res.LastInsertId()

	if err := os.Rename(tmp.Name(), finalPath); err != nil {
		a.db.Exec(`DELETE FROM files WHERE id = ?`, id)
		return File{}, err
	}
	return File{ID: id, Name: name, Size: size, ContentType: contentType, CreatedAt: time.Unix(now.Unix(), 0).UTC()}, nil
}

// GET /api/files/{id} — 파일을 내려받는다.
// 브라우저에서 바로 열고 싶으면 ?inline=1 을 붙인다 (예: 사진 미리보기).
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
	if r.URL.Query().Get("inline") == "1" {
		disposition = "inline"
	}
	// FormatMediaType은 한글 파일 이름을 filename*=utf-8''... 형태로 알아서 인코딩해 준다.
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": name}))
	w.Header().Set("Content-Type", contentType)
	// 업로드된 HTML 등을 브라우저가 우리 사이트 페이지처럼 실행하지 못하게 막는다.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "sandbox")
	// ServeContent는 Range 요청(이어받기, 동영상 탐색)과 캐시 헤더를 알아서 처리한다.
	http.ServeContent(w, r, "", time.Unix(created, 0), f)
}

// DELETE /api/files/{id}
func (a *App) handleDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var storageName string
	// RETURNING: 지우면서 지운 행의 값을 같이 받아온다 (SQLite 3.35+).
	err := a.db.QueryRowContext(r.Context(),
		`DELETE FROM files WHERE id = ? RETURNING storage_name`, id).Scan(&storageName)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "파일이 없습니다")
		return
	} else if err != nil {
		internalError(w, err)
		return
	}
	if err := os.Remove(filepath.Join(a.filesDir, storageName)); err != nil {
		// DB에서는 이미 지워졌으니 사용자에게는 성공으로 알리고, 서버 로그에만 남긴다.
		log.Printf("파일 삭제 실패 (id=%d, %s): %v", id, storageName, err)
	}
	w.WriteHeader(http.StatusNoContent)
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
