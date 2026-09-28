package app

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"
)

// 공유 링크: 로그인하지 않은 기기(QR을 찍은 폰, 링크를 받은 다른 PC)에서도 파일을 받을 수 있게 한다.
// 링크에 들어 있는 무작위 토큰(256비트)이 곧 권한이라 추측할 수 없고, ShareTTL이 지나면 쓸 수 없다.
// 로그인 쿠키를 주는 게 아니므로 링크가 새어도 그 파일 하나만, 정해진 시간 동안만 받을 수 있다.

// POST /api/files/{id}/share → {"path": "/s/<토큰>", "expiresAt": "..."}
// 주소 앞부분(https://도메인)은 프론트엔드가 붙인다.
func (a *App) handleCreateShare(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var one int
	if err := a.db.QueryRowContext(r.Context(),
		`SELECT 1 FROM files WHERE id = ? AND deleted_at IS NULL`, id).Scan(&one); err != nil {
		writeError(w, http.StatusNotFound, "파일이 없습니다")
		return
	}
	token, err := randomHex(32)
	if err != nil {
		internalError(w, err)
		return
	}
	now := time.Now()
	expires := now.Add(a.cfg.ShareTTL)
	if _, err := a.db.ExecContext(r.Context(),
		`INSERT INTO shares (token_hash, file_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
		hashToken(token), id, now.Unix(), expires.Unix()); err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"path":      "/s/" + token,
		"expiresAt": time.Unix(expires.Unix(), 0).UTC(),
	})
}

// GET /s/{token} — 공유 링크로 파일을 내려받는다 (로그인 불필요).
func (a *App) handleSharedDownload(w http.ResponseWriter, r *http.Request) {
	var fileID int64
	err := a.db.QueryRowContext(r.Context(), `
		SELECT s.file_id FROM shares s JOIN files f ON f.id = s.file_id
		WHERE s.token_hash = ? AND s.expires_at > ? AND f.deleted_at IS NULL`,
		hashToken(r.PathValue("token")), time.Now().Unix()).Scan(&fileID)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte("링크가 만료되었거나 파일이 없습니다."))
		}
		return
	}
	// 링크는 만료되므로 공유 캐시(프록시 등)에는 남기지 않는다.
	a.serveFile(w, r, fileID, false, "private, no-store")
}

// purgeShares는 만료된 공유 링크를 지운다.
func (a *App) purgeShares() {
	if _, err := a.db.Exec(`DELETE FROM shares WHERE expires_at <= ?`, time.Now().Unix()); err != nil {
		log.Printf("공유 링크 정리 실패: %v", err)
	}
}
