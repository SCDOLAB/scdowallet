package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWriteTwiceMatches(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "systemd"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "systemd", "a.service"), []byte("unit\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "scdo-agent"), []byte("bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	out1 := filepath.Join(t.TempDir(), "a.tar.gz")
	out2 := filepath.Join(t.TempDir(), "b.tar.gz")
	if err := write(out1, dir, 0, []string{"scdo-agent", "systemd"}); err != nil {
		t.Fatal(err)
	}
	if err := write(out2, dir, 0, []string{"systemd", "scdo-agent"}); err != nil {
		t.Fatal(err)
	}
	a, err := os.ReadFile(out1)
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(out2)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a, b) {
		t.Fatalf("archive bytes differ (%d vs %d)", len(a), len(b))
	}
	gz, err := gzip.NewReader(bytes.NewReader(a))
	if err != nil {
		t.Fatal(err)
	}
	tr := tar.NewReader(gz)
	var got []string
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if !hdr.ModTime.Equal(time.Unix(0, 0).UTC()) {
			t.Fatalf("mtime %s for %s", hdr.ModTime, hdr.Name)
		}
		if hdr.Uid != 0 || hdr.Gid != 0 {
			t.Fatalf("owner %s", hdr.Name)
		}
		got = append(got, hdr.Name)
	}
	want := []string{"scdo-agent", "systemd/", "systemd/a.service"}
	if len(got) != len(want) {
		t.Fatalf("names %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("names %v", got)
		}
	}
}
