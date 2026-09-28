package app

import (
	"database/sql"
	"fmt"
	"net/url"

	_ "modernc.org/sqlite" // 순수 Go SQLite 드라이버 (cgo 불필요). "sqlite"라는 이름으로 등록된다.
)

// migrations는 DB 스키마 변경 이력이다.
// 순서대로 한 번씩만 실행되며, 어디까지 실행했는지는 SQLite의 PRAGMA user_version에 기록된다.
// 스키마를 바꿀 때는 기존 항목을 고치지 말고 맨 뒤에 새 항목을 추가한다.
var migrations = []string{
	// 1: 초기 스키마
	`
	-- 사용자는 한 명뿐이므로 비밀번호 해시 같은 설정값을 key-value로 저장한다.
	CREATE TABLE settings (
		key   TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);

	-- 로그인 세션. 쿠키에는 원본 토큰이, DB에는 토큰의 SHA-256 해시만 저장된다.
	CREATE TABLE sessions (
		token_hash TEXT PRIMARY KEY,
		created_at INTEGER NOT NULL, -- 유닉스 시간(초)
		expires_at INTEGER NOT NULL
	);

	-- 업로드된 파일의 메타데이터. 실제 내용은 디스크의 files/<storage_name>에 있다.
	CREATE TABLE files (
		id           INTEGER PRIMARY KEY AUTOINCREMENT,
		name         TEXT    NOT NULL, -- 사용자가 올린 원래 파일 이름
		storage_name TEXT    NOT NULL UNIQUE, -- 디스크에 저장된 이름 (무작위)
		size         INTEGER NOT NULL,
		content_type TEXT    NOT NULL,
		created_at   INTEGER NOT NULL
	);
	CREATE INDEX files_created_at ON files(created_at);
	`,

	// 2: 폴더, 휴지통, 보관(stash), 파일 종류, 메모
	`
	-- 폴더. parent_id가 NULL이면 맨 위(루트)에 있는 폴더다.
	CREATE TABLE folders (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT    NOT NULL,
		parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
		created_at INTEGER NOT NULL
	);

	-- folder_id: 들어 있는 폴더 (NULL이면 루트). 폴더가 지워지면 루트로 나온다.
	ALTER TABLE files ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;
	-- category: 'photo' | 'document' | 'other'. 기존 행은 ''로 두고 Open에서 채운다.
	ALTER TABLE files ADD COLUMN category TEXT NOT NULL DEFAULT '';
	-- stashed: 1이면 메인 화면 목록에서 빠지고 전체 파일 목록에서만 보인다.
	ALTER TABLE files ADD COLUMN stashed INTEGER NOT NULL DEFAULT 0;
	-- deleted_at: 휴지통에 들어간 시각. NULL이면 휴지통이 아니다.
	ALTER TABLE files ADD COLUMN deleted_at INTEGER;
	CREATE INDEX files_folder ON files(folder_id);
	CREATE INDEX files_deleted_at ON files(deleted_at);

	CREATE TABLE memos (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		body       TEXT    NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	);
	CREATE INDEX memos_updated_at ON memos(updated_at);
	`,

	// 3: 메모 제목과 서식(HTML), 공유 링크
	`
	-- 메모는 제목과 본문을 따로 저장한다. 본문은 서식(굵게, 형광펜 등)을 담은 HTML이다.
	ALTER TABLE memos ADD COLUMN title TEXT NOT NULL DEFAULT '';
	-- 기존 메모(일반 텍스트)는 HTML로 바꾼다: 특수 문자를 이스케이프하고 줄바꿈을 <br>로.
	UPDATE memos SET body = replace(replace(replace(replace(replace(body, char(13), ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), char(10), '<br>');

	-- 로그인 없이 파일을 받을 수 있는 공유 링크. 링크의 토큰은 해시로만 저장한다.
	CREATE TABLE shares (
		token_hash TEXT    PRIMARY KEY,
		file_id    INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
		created_at INTEGER NOT NULL,
		expires_at INTEGER NOT NULL
	);
	CREATE INDEX shares_file ON shares(file_id);
	`,
}

// openDB는 SQLite 파일을 열고 아직 적용되지 않은 마이그레이션을 실행한다.
func openDB(path string) (*sql.DB, error) {
	// WAL 모드: 읽기와 쓰기가 서로 덜 막힌다.
	// busy_timeout: DB가 잠겨 있으면 바로 실패하지 않고 최대 5초 기다린다.
	q := url.Values{}
	q.Add("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "foreign_keys(1)")
	db, err := sql.Open("sqlite", "file:"+path+"?"+q.Encode())
	if err != nil {
		return nil, err
	}
	// 사용자가 한 명이라 동시 접속이 거의 없다. 연결을 하나로 제한하면 SQLite 잠금 문제를 피할 수 있다.
	db.SetMaxOpenConns(1)

	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func migrate(db *sql.DB) error {
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("스키마 버전 읽기 실패: %w", err)
	}
	for i := version; i < len(migrations); i++ {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(migrations[i]); err != nil {
			tx.Rollback()
			return fmt.Errorf("마이그레이션 %d 실패: %w", i+1, err)
		}
		// PRAGMA에는 ? 파라미터를 쓸 수 없어서 숫자를 직접 넣는다 (정수라 안전하다).
		if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", i+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
