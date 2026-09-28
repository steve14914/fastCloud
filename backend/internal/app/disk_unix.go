//go:build unix

package app

import "syscall"

// diskSpace는 path가 있는 디스크의 전체 크기와 남은 크기(바이트)를 돌려준다.
func diskSpace(path string) (total, free int64) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0
	}
	return int64(st.Blocks) * int64(st.Bsize), int64(st.Bavail) * int64(st.Bsize)
}
