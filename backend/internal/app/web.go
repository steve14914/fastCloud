package app

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// handleWeb은 프론트엔드 빌드 결과(WebDir)를 제공한다.
//
// 프론트엔드는 React Router로 /files, /trash 같은 주소를 자바스크립트가 처리하는 "싱글 페이지 앱"이다.
// 그래서 실제 파일이 없는 주소로 들어오면 index.html을 주고, 화면 전환은 브라우저가 알아서 한다.
func (a *App) handleWeb(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "없는 API입니다")
		return
	}
	if a.cfg.WebDir == "" {
		http.NotFound(w, r)
		return
	}
	// path.Clean으로 ".." 같은 것을 없애서 WebDir 밖의 파일을 읽지 못하게 한다.
	p := filepath.Join(a.cfg.WebDir, filepath.FromSlash(path.Clean("/"+r.URL.Path)))
	if info, err := os.Stat(p); err != nil || info.IsDir() {
		p = filepath.Join(a.cfg.WebDir, "index.html")
		if _, err := os.Stat(p); err != nil {
			http.NotFound(w, r)
			return
		}
	}
	if strings.HasPrefix(r.URL.Path, "/assets/") {
		// Vite가 만든 assets/ 파일은 내용이 바뀌면 이름(해시)도 바뀌므로 오래 캐시해도 된다.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		// index.html 등은 매번 새로 확인해서 배포 후 바로 새 화면이 보이게 한다.
		w.Header().Set("Cache-Control", "no-cache")
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeFile(w, r, p)
}
