// Command mktar writes a ustar gzip archive with the pinned Go toolchain.
// Host tar differs between Ubuntu 22.04 and 24.04 (device-number fields in
// the header), which changes the gzip even when every file byte matches.
package main

import (
	"archive/tar"
	"compress/gzip"
	"flag"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func main() {
	epoch := flag.Int64("epoch", 0, "mtime unix seconds")
	dir := flag.String("C", ".", "directory to read")
	outPath := flag.String("o", "", "output .tar.gz path")
	flag.Parse()
	if *outPath == "" || flag.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "usage: mktar -epoch N -C dir -o out.tar.gz paths...")
		os.Exit(2)
	}
	if err := write(*outPath, *dir, *epoch, flag.Args()); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}

func write(outPath, root string, epoch int64, roots []string) error {
	names, err := collect(root, roots)
	if err != nil {
		return err
	}
	sort.Strings(names)
	f, err := os.OpenFile(outPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewWriterLevel(f, gzip.DefaultCompression)
	if err != nil {
		return err
	}
	// Zero name and mtime match gzip -n.
	gz.Header.Name = ""
	gz.Header.ModTime = time.Unix(0, 0).UTC()
	tw := tar.NewWriter(gz)
	when := time.Unix(epoch, 0).UTC()
	for _, name := range names {
		disk := filepath.Join(root, filepath.FromSlash(strings.TrimSuffix(name, "/")))
		info, err := os.Lstat(disk)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink not packed: %s", name)
		}
		hdr := &tar.Header{
			Name:     name,
			Mode:     int64(info.Mode().Perm()),
			Uid:      0,
			Gid:      0,
			ModTime:  when,
			Format:   tar.FormatUSTAR,
			Typeflag: tar.TypeReg,
		}
		if strings.HasSuffix(name, "/") {
			hdr.Typeflag = tar.TypeDir
			hdr.Mode = int64(info.Mode().Perm())
			if err := tw.WriteHeader(hdr); err != nil {
				return err
			}
			continue
		}
		hdr.Size = info.Size()
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		in, err := os.Open(disk)
		if err != nil {
			return err
		}
		if _, err := io.Copy(tw, in); err != nil {
			in.Close()
			return err
		}
		if err := in.Close(); err != nil {
			return err
		}
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return gz.Close()
}

func collect(root string, roots []string) ([]string, error) {
	var names []string
	for _, rel := range roots {
		rel = path.Clean(rel)
		if rel == "." || strings.HasPrefix(rel, "../") || path.IsAbs(rel) {
			return nil, fmt.Errorf("refusing path %q", rel)
		}
		if err := walk(root, rel, &names); err != nil {
			return nil, err
		}
	}
	return names, nil
}

func walk(root, rel string, names *[]string) error {
	disk := filepath.Join(root, filepath.FromSlash(rel))
	info, err := os.Lstat(disk)
	if err != nil {
		return err
	}
	if info.IsDir() {
		*names = append(*names, rel+"/")
		entries, err := os.ReadDir(disk)
		if err != nil {
			return err
		}
		children := make([]string, 0, len(entries))
		for _, e := range entries {
			children = append(children, e.Name())
		}
		sort.Strings(children)
		for _, child := range children {
			if err := walk(root, path.Join(rel, child), names); err != nil {
				return err
			}
		}
		return nil
	}
	*names = append(*names, rel)
	return nil
}
