package app

import (
	"database/sql"
	"path/filepath"
	"strings"
)

// 파일 종류. 메인 화면의 사진 / 문서 / 기타 목록을 나누는 데 쓴다.
const (
	categoryPhoto    = "photo"
	categoryDocument = "document"
	categoryOther    = "other"
)

var photoExts = setOf("jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "avif", "svg", "tif", "tiff")

var documentExts = setOf(
	"pdf", "txt", "md", "rtf", "csv",
	"doc", "docx", "xls", "xlsx", "ppt", "pptx", // MS 오피스
	"hwp", "hwpx", // 한글
	"odt", "ods", "odp", // 리브레오피스
	"pages", "numbers", "key", "epub",
)

// categoryOf는 확장자(없으면 Content-Type)로 파일 종류를 정한다.
func categoryOf(name, contentType string) string {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
	switch {
	case photoExts[ext]:
		return categoryPhoto
	case documentExts[ext]:
		return categoryDocument
	case ext == "" && strings.HasPrefix(contentType, "image/"):
		return categoryPhoto
	case ext == "" && contentType == "application/pdf":
		return categoryDocument
	}
	return categoryOther
}

func validCategory(c string) bool {
	return c == categoryPhoto || c == categoryDocument || c == categoryOther
}

// backfillCategories는 category 칸이 생기기 전에 올라간 파일들의 종류를 채운다.
func backfillCategories(db *sql.DB) error {
	rows, err := db.Query(`SELECT id, name, content_type FROM files WHERE category = ''`)
	if err != nil {
		return err
	}
	type row struct {
		id                int64
		name, contentType string
	}
	var todo []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.name, &r.contentType); err != nil {
			rows.Close()
			return err
		}
		todo = append(todo, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, r := range todo {
		if _, err := db.Exec(`UPDATE files SET category = ? WHERE id = ?`, categoryOf(r.name, r.contentType), r.id); err != nil {
			return err
		}
	}
	return nil
}

func setOf(items ...string) map[string]bool {
	m := make(map[string]bool, len(items))
	for _, s := range items {
		m[s] = true
	}
	return m
}
