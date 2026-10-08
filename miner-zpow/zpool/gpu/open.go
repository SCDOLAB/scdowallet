// +build cuda

package gpu

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/scdoproject/go-scdo/common"
)

// Device is one CUDA device. All calls into the zpow library run on a
// single locked OS thread: the CUDA context is thread-local, and a Go
// goroutine can migrate.
type Device struct {
	lib   *native
	name  string
	index int
	calls chan func()
	once  sync.Once
}

// Open loads libzpowdet and selects device. path may be empty; then
// ZPOW_GPU_LIB, the executable's directory, and the working directory
// are searched.
func Open(path string, device int) (*Device, error) {
	libPath, err := findLib(path)
	if err != nil {
		return nil, err
	}
	n, err := loadNative(libPath)
	if err != nil {
		return nil, err
	}
	d := &Device{lib: n, index: device, calls: make(chan func())}
	go d.loop()
	var name string
	err = d.onThread(func() error {
		count, err := n.deviceCount()
		if err != nil {
			return err
		}
		if count <= 0 {
			return fmt.Errorf("no CUDA device (count %d)", count)
		}
		if device < 0 || device >= count {
			return fmt.Errorf("CUDA device %d out of range (count %d)", device, count)
		}
		if err := n.setDevice(device); err != nil {
			return err
		}
		name, err = n.deviceName(device)
		return err
	})
	if err != nil {
		d.Close()
		return nil, fmt.Errorf("%s: %v", libPath, err)
	}
	d.name = name
	return d, nil
}

func (d *Device) loop() {
	runtime.LockOSThread()
	for fn := range d.calls {
		fn()
	}
	if d.lib != nil {
		d.lib.close()
	}
}

func (d *Device) onThread(fn func() error) (err error) {
	defer func() {
		if recover() != nil {
			err = fmt.Errorf("gpu device closed")
		}
	}()
	done := make(chan error, 1)
	d.calls <- func() {
		defer func() {
			if r := recover(); r != nil {
				done <- fmt.Errorf("gpu panic: %v", r)
			}
		}()
		done <- fn()
	}
	return <-done
}

// Name is the CUDA device name, such as "NVIDIA GeForce RTX 5060 Ti".
func (d *Device) Name() string { return d.name }

// Close stops the CUDA thread. It does not unload the driver.
func (d *Device) Close() {
	d.once.Do(func() { close(d.calls) })
}

// Dets returns one determinant per hash, bit-matched to zp.Det when the
// library was built with -fmad=false. height selects the EmeryFork RNG
// (height >= common.EmeryForkHeight). The library returns LU diagonals
// and the row-swap sign; detFrom applies the same log/exp sum as gonum.
func (d *Device) Dets(hashes []common.Hash, height uint64) ([]float64, error) {
	n := len(hashes)
	if n == 0 {
		return nil, nil
	}
	raw := make([]byte, n*32)
	for i := range hashes {
		copy(raw[i*32:(i+1)*32], hashes[i].Bytes())
	}
	diags := make([]float64, n*Dim)
	signs := make([]int32, n)
	emery := 0
	if height >= common.EmeryForkHeight {
		emery = 1
	}
	err := d.onThread(func() error {
		return d.lib.factor(raw, emery, diags, signs)
	})
	if err != nil {
		return nil, err
	}
	out := make([]float64, n)
	for i := 0; i < n; i++ {
		s := signs[i]
		if s != 1 && s != -1 {
			return nil, fmt.Errorf("gpu: swap sign %d at batch index %d", s, i)
		}
		var diag [Dim]float64
		copy(diag[:], diags[i*Dim:(i+1)*Dim])
		out[i] = detFrom(diag, float64(s))
	}
	return out, nil
}

func findLib(explicit string) (string, error) {
	if explicit != "" {
		if err := existingFile(explicit); err != nil {
			return "", fmt.Errorf("GPU library %s: %v", explicit, err)
		}
		return explicit, nil
	}
	if env := os.Getenv("ZPOW_GPU_LIB"); env != "" {
		if err := existingFile(env); err != nil {
			return "", fmt.Errorf("ZPOW_GPU_LIB %s: %v", env, err)
		}
		return env, nil
	}
	var dirs []string
	if exe, err := os.Executable(); err == nil {
		dirs = append(dirs, filepath.Dir(exe))
	}
	if wd, err := os.Getwd(); err == nil {
		dirs = append(dirs, wd)
	}
	names := libFileNames()
	var tried []string
	for _, dir := range dirs {
		for _, name := range names {
			p := filepath.Join(dir, name)
			tried = append(tried, p)
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p, nil
			}
		}
	}
	return "", fmt.Errorf("zpow GPU library not found (pass -lib or set ZPOW_GPU_LIB; looked for %s)", strings.Join(tried, ", "))
}

func existingFile(path string) error {
	st, err := os.Stat(path)
	if err != nil {
		return err
	}
	if st.IsDir() {
		return fmt.Errorf("is a directory")
	}
	return nil
}

func libFileNames() []string {
	if runtime.GOOS == "windows" {
		return []string{"zpowdet.dll"}
	}
	return []string{"libzpowdet.so"}
}
