//go:build !unix

package app

// 윈도우에서 로컬로 실행할 때는 디스크 크기를 알려 주지 않는다 (서버는 리눅스).
func diskSpace(path string) (total, free int64) { return 0, 0 }
