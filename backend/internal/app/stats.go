package app

import (
	"context"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// transferStats는 서버가 주고받은 바이트 수를 세서 현재 업로드/다운로드 속도를 계산한다.
// 브라우저의 일반 다운로드는 자바스크립트로 진행 상황을 알 수 없어서, 서버 쪽에서 재는 방식을 쓴다.
// 그래서 폰에서 받는 중이면 PC 화면에도 그 속도가 보인다.
type transferStats struct {
	up, down atomic.Int64 // 서버가 켜진 뒤 누적 바이트 (업로드는 받은 양, 다운로드는 보낸 양)

	mu      sync.Mutex
	samples []statSample // 최근 몇 초의 누적값 기록
}

type statSample struct {
	at       time.Time
	up, down int64
}

const speedWindow = 3 // 최근 3초 평균으로 속도를 낸다

// sample은 1초마다 호출되어 누적값을 기록한다.
func (s *transferStats) sample(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.samples = append(s.samples, statSample{at: now, up: s.up.Load(), down: s.down.Load()})
	if len(s.samples) > speedWindow+1 {
		s.samples = s.samples[1:]
	}
}

// speed는 초당 바이트 수를 돌려준다.
func (s *transferStats) speed() (up, down float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.samples) < 2 {
		return 0, 0
	}
	first, last := s.samples[0], s.samples[len(s.samples)-1]
	secs := last.at.Sub(first.at).Seconds()
	if secs <= 0 {
		return 0, 0
	}
	return float64(last.up-first.up) / secs, float64(last.down-first.down) / secs
}

// GET /api/stats/transfer → {"uploadBps": 123.4, "downloadBps": 567.8}
func (a *App) handleTransferStats(w http.ResponseWriter, r *http.Request) {
	up, down := a.stats.speed()
	writeJSON(w, http.StatusOK, map[string]float64{"uploadBps": up, "downloadBps": down})
}

// countingReader는 읽은 바이트 수를 n에 더한다.
type countingReader struct {
	r io.Reader
	n *atomic.Int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n.Add(int64(n))
	return n, err
}

// countingWriter는 쓴 바이트 수를 n에 더한다.
type countingWriter struct {
	http.ResponseWriter
	n *atomic.Int64
}

func (c *countingWriter) Write(p []byte) (int, error) {
	n, err := c.ResponseWriter.Write(p)
	c.n.Add(int64(n))
	return n, err
}

// GET /api/usage — 사용 용량
//
//	usedBytes   올린 파일 전체 크기 (휴지통 포함)
//	trashBytes  그중 휴지통에 있는 크기
//	quotaBytes  fastcloud에 할당한 용량 (0이면 제한 없음)
//	diskTotal   서버 디스크 전체 크기, diskFree 남은 크기 (알 수 없으면 0)
//	tempDays    임시함 파일이 휴지통으로 가기까지 일수, trashDays 휴지통 파일이 완전히 지워지기까지 일수 (0이면 자동 삭제 안 함)
func (a *App) handleUsage(w http.ResponseWriter, r *http.Request) {
	var used, trash, count int64
	err := a.db.QueryRowContext(r.Context(), `
		SELECT COALESCE(SUM(size), 0),
		       COALESCE(SUM(CASE WHEN deleted_at IS NOT NULL THEN size ELSE 0 END), 0),
		       COUNT(*)
		FROM files`).Scan(&used, &trash, &count)
	if err != nil {
		internalError(w, err)
		return
	}
	total, free := diskSpace(a.filesDir)
	writeJSON(w, http.StatusOK, map[string]int64{
		"usedBytes":  used,
		"trashBytes": trash,
		"quotaBytes": a.cfg.QuotaBytes,
		"fileCount":  count,
		"diskTotal":  total,
		"diskFree":   free,
		"tempDays":   int64(a.cfg.TempDays),
		"trashDays":  int64(a.cfg.TrashDays),
	})
}

// usedBytes는 올린 파일 전체 크기(휴지통 포함)를 돌려준다.
func (a *App) usedBytes(ctx context.Context) (int64, error) {
	var used int64
	err := a.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(size), 0) FROM files`).Scan(&used)
	return used, err
}
