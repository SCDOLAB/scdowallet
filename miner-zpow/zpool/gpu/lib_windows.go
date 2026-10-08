// +build cuda,windows

package gpu

import (
	"fmt"
	"syscall"
	"unsafe"
)

// Windows loads zpowdet.dll with the Go syscall package, so this file
// builds with CGO_ENABLED=0. The CUDA runtime DLL (cudart64_*.dll) must
// sit next to zpowdet.dll. Ignore the syscall errno: it is GetLastError,
// which the CUDA runtime does not use. The C return code is the status.

type native struct {
	dll      *syscall.LazyDLL
	count    *syscall.LazyProc
	set      *syscall.LazyProc
	name     *syscall.LazyProc
	last     *syscall.LazyProc
	factorFn *syscall.LazyProc
}

func loadNative(path string) (*native, error) {
	d := syscall.NewLazyDLL(path)
	if err := d.Load(); err != nil {
		return nil, fmt.Errorf("LoadLibrary %s: %v", path, err)
	}
	n := &native{dll: d}
	var err error
	if n.count, err = findProc(d, "zpow_device_count"); err != nil {
		return nil, err
	}
	if n.set, err = findProc(d, "zpow_set_device"); err != nil {
		return nil, err
	}
	if n.name, err = findProc(d, "zpow_device_name"); err != nil {
		return nil, err
	}
	if n.last, err = findProc(d, "zpow_last_error"); err != nil {
		return nil, err
	}
	if n.factorFn, err = findProc(d, "zpow_factor_batch"); err != nil {
		return nil, err
	}
	return n, nil
}

func findProc(d *syscall.LazyDLL, name string) (*syscall.LazyProc, error) {
	p := d.NewProc(name)
	if err := p.Find(); err != nil {
		return nil, fmt.Errorf("%s: %v", name, err)
	}
	return p, nil
}

func (n *native) deviceCount() (int, error) {
	r, _, _ := n.count.Call()
	c := int32(r)
	if c < 0 {
		return 0, fmt.Errorf("cuda device count: %s", n.lastError())
	}
	return int(c), nil
}

func (n *native) setDevice(device int) error {
	r, _, _ := n.set.Call(uintptr(device))
	if int32(r) != 0 {
		return fmt.Errorf("cuda set device %d: %s", device, n.lastError())
	}
	return nil
}

func (n *native) deviceName(device int) (string, error) {
	buf := make([]byte, 256)
	r, _, _ := n.name.Call(uintptr(device), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if int32(r) != 0 {
		return "", fmt.Errorf("cuda device name: %s", n.lastError())
	}
	i := 0
	for i < len(buf) && buf[i] != 0 {
		i++
	}
	return string(buf[:i]), nil
}

func (n *native) lastError() string {
	r, _, _ := n.last.Call()
	return cstr(r)
}

func (n *native) factor(hashes []byte, emery int, diags []float64, signs []int32) error {
	if len(hashes) == 0 {
		return nil
	}
	count := len(hashes) / 32
	if count == 0 || len(diags) < count*Dim || len(signs) < count {
		return fmt.Errorf("gpu: short factor buffers")
	}
	r, _, _ := n.factorFn.Call(
		uintptr(unsafe.Pointer(&hashes[0])),
		uintptr(count),
		uintptr(emery),
		uintptr(unsafe.Pointer(&diags[0])),
		uintptr(unsafe.Pointer(&signs[0])),
	)
	if int32(r) != 0 {
		return fmt.Errorf("zpow_factor_batch: %s", n.lastError())
	}
	return nil
}

func (n *native) close() {}

func cstr(p uintptr) string {
	if p == 0 {
		return ""
	}
	buf := make([]byte, 0, 64)
	for i := uintptr(0); i < 511; i++ {
		b := *(*byte)(unsafe.Pointer(p + i))
		if b == 0 {
			break
		}
		buf = append(buf, b)
	}
	return string(buf)
}
