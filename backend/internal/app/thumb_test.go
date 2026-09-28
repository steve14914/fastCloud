package app

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"testing"
)

func TestThumbnail(t *testing.T) {
	_, srv, c := newTestServer(t)
	login(t, c, srv.URL, "correct-horse")

	// 가로로 긴 사진: 왼쪽 절반 빨강, 오른쪽 절반 파랑
	img := image.NewRGBA(image.Rect(0, 0, 800, 400))
	for y := 0; y < 400; y++ {
		for x := 0; x < 800; x++ {
			if x < 400 {
				img.Set(x, y, color.RGBA{255, 0, 0, 255})
			} else {
				img.Set(x, y, color.RGBA{0, 0, 255, 255})
			}
		}
	}
	var buf bytes.Buffer
	png.Encode(&buf, img)
	upload(t, c, srv.URL, map[string]string{"wide.png": buf.String(), "a.txt": "x"}).Body.Close()

	files := listFiles(t, c, srv.URL)
	for _, f := range files {
		res, err := c.Get(srv.URL + "/api/files/" + itoa(f.ID) + "/thumb")
		if err != nil {
			t.Fatal(err)
		}
		if f.Name == "a.txt" {
			res.Body.Close()
			if res.StatusCode != http.StatusNotFound {
				t.Errorf("텍스트 파일 썸네일 = %d, 404여야 함", res.StatusCode)
			}
			continue
		}
		thumb, err := jpeg.Decode(res.Body)
		res.Body.Close()
		if err != nil {
			t.Fatalf("썸네일이 JPEG가 아님: %v", err)
		}
		if b := thumb.Bounds(); b.Dx() != thumbSize || b.Dy() != thumbSize {
			t.Errorf("썸네일 크기 = %v", b)
		}
		// 가운데를 잘랐으니 왼쪽은 빨강, 오른쪽은 파랑
		if r, _, b, _ := thumb.At(10, 128).RGBA(); r < b {
			t.Errorf("썸네일 왼쪽이 빨강이 아님")
		}
		if r, _, b, _ := thumb.At(245, 128).RGBA(); b < r {
			t.Errorf("썸네일 오른쪽이 파랑이 아님")
		}
	}
}

func TestOrient(t *testing.T) {
	// 2x2에서 왼쪽 위만 흰색
	src := image.NewRGBA(image.Rect(0, 0, 2, 2))
	src.SetRGBA(0, 0, color.RGBA{255, 255, 255, 255})
	white := func(img image.Image, x, y int) bool { r, _, _, _ := img.At(x, y).RGBA(); return r > 0 }
	cases := map[int][2]int{1: {0, 0}, 2: {1, 0}, 3: {1, 1}, 4: {0, 1}, 5: {0, 0}, 6: {1, 0}, 7: {1, 1}, 8: {0, 1}}
	for o, want := range cases {
		if out := orient(src, o); !white(out, want[0], want[1]) {
			t.Errorf("orientation %d: 흰 점이 %v에 있어야 함", o, want)
		}
	}
}

func TestExifOrientation(t *testing.T) {
	// 최소한의 JPEG 앞부분: SOI + APP1(Exif, 리틀 엔디언 TIFF, 태그 하나: Orientation=6) + SOS
	var tiff bytes.Buffer
	tiff.WriteString("II")
	binary.Write(&tiff, binary.LittleEndian, uint16(42))
	binary.Write(&tiff, binary.LittleEndian, uint32(8)) // IFD0 위치
	binary.Write(&tiff, binary.LittleEndian, uint16(1)) // 항목 1개
	binary.Write(&tiff, binary.LittleEndian, []uint16{0x0112, 3})
	binary.Write(&tiff, binary.LittleEndian, uint32(1))
	binary.Write(&tiff, binary.LittleEndian, []uint16{6, 0})
	seg := append([]byte("Exif\x00\x00"), tiff.Bytes()...)

	var jpg bytes.Buffer
	jpg.Write([]byte{0xFF, 0xD8, 0xFF, 0xE1})
	binary.Write(&jpg, binary.BigEndian, uint16(len(seg)+2))
	jpg.Write(seg)
	jpg.Write([]byte{0xFF, 0xDA, 0, 2})
	if got := exifOrientation(jpg.Bytes()); got != 6 {
		t.Errorf("exifOrientation = %d, 6이어야 함", got)
	}
	if got := exifOrientation([]byte("not a jpeg")); got != 1 {
		t.Errorf("JPEG 아님 = %d", got)
	}
}
