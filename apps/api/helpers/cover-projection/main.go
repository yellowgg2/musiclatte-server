// Private exact gonic v0.22.0 cover projection check. No network or file mutations.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"io"
	"os"
	"syscall"

	"github.com/disintegration/imaging"
)

func picture(name string) (image.Image, string, error) {
	fd, err := syscall.Open(name, syscall.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, "", err
	}
	f := os.NewFile(uintptr(fd), name)
	defer f.Close()
	s, err := f.Stat()
	if err != nil || !s.Mode().IsRegular() || s.Size() < 1 || s.Size() > 8*1024*1024 {
		return nil, "", errors.New("invalid_cover")
	}
	data, err := io.ReadAll(io.LimitReader(f, 8*1024*1024+1))
	if err != nil {
		return nil, "", err
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg") || config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 16000000 {
		return nil, "", errors.New("invalid_cover")
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	return img, format, err
}

func matches() (bool, error) {
	// The caller owns a fresh private working directory containing these two bounded files.
	expected, format, err := picture("expected")
	if err != nil {
		return false, err
	}
	actual, actualFormat, err := picture("actual")
	if err != nil {
		return false, err
	}
	if actualFormat != format {
		return false, nil
	}
	size := min(600, max(expected.Bounds().Dx(), expected.Bounds().Dy()))
	resized := imaging.Fit(expected, size, size, imaging.Lanczos)
	var encoded bytes.Buffer
	encoding := imaging.PNG
	if format == "jpeg" {
		encoding = imaging.JPEG
	}
	if err := imaging.Encode(&encoded, resized, encoding); err != nil {
		return false, err
	}
	projected, _, err := image.Decode(&encoded)
	if err != nil {
		return false, err
	}
	a, b := projected.Bounds(), actual.Bounds()
	if a.Dx() != b.Dx() || a.Dy() != b.Dy() {
		return false, nil
	}
	for y := 0; y < a.Dy(); y++ {
		for x := 0; x < a.Dx(); x++ {
			if color.NRGBAModel.Convert(projected.At(a.Min.X+x, a.Min.Y+y)) != color.NRGBAModel.Convert(actual.At(b.Min.X+x, b.Min.Y+y)) {
				return false, nil
			}
		}
	}
	return true, nil
}

func main() {
	if len(os.Args) != 1 {
		os.Exit(1)
	}
	matched, err := matches()
	if err != nil {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"error": "invalid_cover"})
		return
	}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"profile": "gonic-0.22.0-imaging-1.6.2", "matches": matched})
}
