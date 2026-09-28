// fastcloud 백엔드 진입점.
//
//	fastcloud          서버 실행
//	fastcloud passwd   로그인 비밀번호 설정/변경
//
// 설정은 환경 변수로 한다 (README 참고).
package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/term"

	"github.com/steve14914/fastcloud/backend/internal/app"
)

func main() {
	cfg := app.Config{
		DataDir:        env("FASTCLOUD_DATA_DIR", "./data"),
		MaxUploadBytes: int64(envInt("FASTCLOUD_MAX_UPLOAD_MB", 4096)) << 20, // MB → 바이트
		SecureCookie:   env("FASTCLOUD_SECURE_COOKIE", "true") == "true",
		TrustProxy:     env("FASTCLOUD_TRUST_PROXY", "true") == "true",
		SessionTTL:     time.Duration(envInt("FASTCLOUD_SESSION_DAYS", 30)) * 24 * time.Hour,
	}
	addr := env("FASTCLOUD_ADDR", "127.0.0.1:8080")

	a, err := app.Open(cfg)
	if err != nil {
		log.Fatalf("초기화 실패: %v", err)
	}
	defer a.Close()

	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "passwd":
			if err := setPassword(a); err != nil {
				log.Fatal(err)
			}
			fmt.Println("비밀번호를 저장했습니다. 기존 로그인은 모두 해제되었습니다.")
			return
		default:
			log.Fatalf("알 수 없는 명령: %s (사용 가능: passwd)", os.Args[1])
		}
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           a.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		// ReadTimeout/WriteTimeout은 일부러 두지 않는다. 큰 파일 업로드·다운로드가 오래 걸릴 수 있기 때문이다.
	}

	// Ctrl+C나 systemctl stop(SIGTERM)을 받으면 진행 중인 요청을 마무리하고 종료한다.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	log.Printf("fastcloud 시작: http://%s (데이터 폴더: %s)", addr, cfg.DataDir)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

// setPassword는 터미널에서 비밀번호를 두 번 입력받아 저장한다.
func setPassword(a *app.App) error {
	first, err := readPassword("새 비밀번호: ")
	if err != nil {
		return err
	}
	second, err := readPassword("한 번 더 입력: ")
	if err != nil {
		return err
	}
	if first != second {
		return errors.New("두 비밀번호가 다릅니다")
	}
	return a.SetPassword(first)
}

func readPassword(prompt string) (string, error) {
	fmt.Fprint(os.Stderr, prompt)
	fd := int(os.Stdin.Fd())
	if term.IsTerminal(fd) {
		// 터미널이면 입력한 글자가 화면에 보이지 않게 읽는다.
		b, err := term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
		return string(b), err
	}
	// 파이프로 들어온 경우 (예: 스크립트) 한 줄씩 읽는다.
	line, err := stdin.ReadString('\n')
	if err != nil && line == "" {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
}

var stdin = bufio.NewReader(os.Stdin)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		log.Fatalf("%s 값이 숫자가 아닙니다: %q", key, v)
	}
	return n
}
