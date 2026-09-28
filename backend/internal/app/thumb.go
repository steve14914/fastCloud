package app

import (
	"bytes"
	"database/sql"
	"encoding/binary"
	"errors"
	"image"
	"image/jpeg"
	"io"
	"net/http"
	"os"
	"path/filepath"

	// image.Decode가 이 형식들을 읽을 수 있도록 등록한다 (import만 하면 등록됨)
	_ "image/gif"
	_ "image/png"

	_ "golang.org/x/image/bmp"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// 사진 목록에는 원본(수 MB) 대신 작은 정사각형 썸네일(수십 KB)을 보여 줘서 화면이 빨리 뜨게 한다.
// 썸네일은 처음 한 번 만들어 data/thumbs/에 저장해 두고 이후에는 파일을 그대로 보낸다.
// 사진을 올리면 바로 뒤에서 미리 만들어 둔다.

const (
	thumbSize      = 256       // 썸네일 한 변 (픽셀). 폰 화면의 56px 칸을 3배 해상도로 채울 수 있는 크기
	thumbMaxPixels = 100 << 20 // 이보다 큰 사진(1억 화소 넘음)은 메모리를 너무 써서 썸네일을 만들지 않는다
)

// 썸네일은 CPU를 많이 쓰므로 동시에 2개까지만 만든다.
var thumbSlots = make(chan struct{}, 2)

// GET /api/files/{id}/thumb — 사진 썸네일 (JPEG). 만들 수 없는 형식(HEIC 등)이면 404.
func (a *App) handleThumb(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var storageName, category string
	err := a.db.QueryRowContext(r.Context(), `SELECT storage_name, category FROM files WHERE id = ?`, id).
		Scan(&storageName, &category)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && category != categoryPhoto) {
		writeError(w, http.StatusNotFound, "썸네일이 없습니다")
		return
	} else if err != nil {
		internalError(w, err)
		return
	}
	path, err := a.ensureThumb(storageName)
	if err != nil {
		writeError(w, http.StatusNotFound, "썸네일을 만들 수 없는 형식입니다")
		return
	}
	// 파일 id의 내용은 바뀌지 않으므로 브라우저가 오래 캐시해도 된다.
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("Content-Type", "image/jpeg")
	http.ServeFile(w, r, path)
}

func (a *App) thumbPath(storageName string) string {
	return filepath.Join(a.thumbsDir, storageName+".jpg")
}

// ensureThumb은 썸네일이 없으면 만들고 그 경로를 돌려준다.
func (a *App) ensureThumb(storageName string) (string, error) {
	path := a.thumbPath(storageName)
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	thumbSlots <- struct{}{}
	defer func() { <-thumbSlots }()
	// 기다리는 사이 다른 요청이 만들었을 수 있다.
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}

	src, err := os.ReadFile(filepath.Join(a.filesDir, storageName))
	if err != nil {
		return "", err
	}
	thumb, err := makeThumb(src)
	if err != nil {
		return "", err
	}
	// 임시 파일에 쓴 뒤 이름을 바꿔서, 반쯤 쓰인 썸네일이 보이지 않게 한다.
	tmp, err := os.CreateTemp(a.thumbsDir, "thumb-*.tmp")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	err = jpeg.Encode(tmp, thumb, &jpeg.Options{Quality: 80})
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return "", err
	}
	return path, os.Rename(tmp.Name(), path)
}

// thumbInBackground는 업로드 직후 썸네일을 미리 만들어 둔다 (실패해도 괜찮다: 나중에 요청 때 다시 시도).
func (a *App) thumbInBackground(storageName string) {
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		a.ensureThumb(storageName)
	}()
}

// makeThumb은 사진을 가운데 기준 정사각형으로 잘라 thumbSize로 줄이고, 폰 사진의 회전 정보(EXIF)를 반영한다.
func makeThumb(src []byte) (image.Image, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(src))
	if err != nil {
		return nil, err
	}
	if cfg.Width*cfg.Height > thumbMaxPixels {
		return nil, errors.New("사진이 너무 큽니다")
	}
	img, _, err := image.Decode(bytes.NewReader(src))
	if err != nil {
		return nil, err
	}

	// 가운데 정사각형 영역
	b := img.Bounds()
	side := min(b.Dx(), b.Dy())
	x0 := b.Min.X + (b.Dx()-side)/2
	y0 := b.Min.Y + (b.Dy()-side)/2
	crop := image.Rect(x0, y0, x0+side, y0+side)

	// 크게 줄일 때는 빠른 방식으로 2배 크기까지 줄인 뒤, 품질 좋은 방식으로 마무리한다.
	var mid image.Image = img
	midRect := crop
	if side > thumbSize*2 {
		m := image.NewRGBA(image.Rect(0, 0, thumbSize*2, thumbSize*2))
		draw.ApproxBiLinear.Scale(m, m.Bounds(), img, crop, draw.Src, nil)
		mid, midRect = m, m.Bounds()
	}
	out := image.NewRGBA(image.Rect(0, 0, thumbSize, thumbSize))
	draw.CatmullRom.Scale(out, out.Bounds(), mid, midRect, draw.Src, nil)

	// 정사각형은 돌려도 가운데가 그대로라서, 자른 뒤에 돌려도 결과가 같다.
	return orient(out, exifOrientation(src)), nil
}

// orient는 EXIF 방향 값(1~8)에 맞게 정사각형 이미지를 돌리거나 뒤집는다.
func orient(img *image.RGBA, o int) image.Image {
	if o <= 1 || o > 8 {
		return img
	}
	n := img.Bounds().Dx()
	out := image.NewRGBA(img.Bounds())
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			var sx, sy int // 결과 (x, y)에 들어갈 원본 좌표
			switch o {
			case 2: // 좌우 반전
				sx, sy = n-1-x, y
			case 3: // 180도
				sx, sy = n-1-x, n-1-y
			case 4: // 상하 반전
				sx, sy = x, n-1-y
			case 5: // 대각선 반전
				sx, sy = y, x
			case 6: // 시계 방향 90도
				sx, sy = y, n-1-x
			case 7: // 반대 대각선 반전
				sx, sy = n-1-y, n-1-x
			case 8: // 반시계 방향 90도
				sx, sy = n-1-y, x
			}
			out.SetRGBA(x, y, img.RGBAAt(sx, sy))
		}
	}
	return out
}

// exifOrientation은 JPEG의 EXIF에서 방향(Orientation, 태그 0x0112) 값을 읽는다. 없으면 1.
// 폰 카메라는 사진을 돌려서 저장하지 않고 "이렇게 돌려서 보라"는 값만 적어 두기 때문에 필요하다.
func exifOrientation(src []byte) int {
	r := bytes.NewReader(src)
	var marker [2]byte
	if _, err := io.ReadFull(r, marker[:]); err != nil || marker != [2]byte{0xFF, 0xD8} {
		return 1 // JPEG가 아님
	}
	for {
		if _, err := io.ReadFull(r, marker[:]); err != nil || marker[0] != 0xFF {
			return 1
		}
		var size uint16
		if binary.Read(r, binary.BigEndian, &size) != nil || size < 2 {
			return 1
		}
		seg := make([]byte, size-2)
		if _, err := io.ReadFull(r, seg); err != nil {
			return 1
		}
		if marker[1] == 0xE1 && len(seg) > 14 && string(seg[:6]) == "Exif\x00\x00" {
			return tiffOrientation(seg[6:])
		}
		if marker[1] == 0xDA { // 이미지 데이터 시작: 여기까지 EXIF가 없었다
			return 1
		}
	}
}

func tiffOrientation(t []byte) int {
	var bo binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return 1
	}
	ifd := int(bo.Uint32(t[4:8]))
	if ifd+2 > len(t) {
		return 1
	}
	count := int(bo.Uint16(t[ifd:]))
	for i := 0; i < count; i++ {
		e := ifd + 2 + i*12
		if e+12 > len(t) {
			return 1
		}
		if bo.Uint16(t[e:]) == 0x0112 {
			return int(bo.Uint16(t[e+8:]))
		}
	}
	return 1
}
