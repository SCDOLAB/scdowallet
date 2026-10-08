// +build cuda,linux

package gpu

/*
#cgo LDFLAGS: -ldl
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>

typedef char zpow_int_is_32[(sizeof(int) == 4) ? 1 : -1];

static void* zpow_dlopen(const char* path, char* err, int errlen) {
	dlerror();
	void* h = dlopen(path, RTLD_NOW | RTLD_LOCAL);
	if (!h) {
		const char* e = dlerror();
		if (!e) e = "dlopen failed";
		snprintf(err, (size_t)errlen, "%s", e);
	}
	return h;
}

static void* zpow_dlsym(void* h, const char* name, char* err, int errlen) {
	dlerror();
	void* p = dlsym(h, name);
	const char* e = dlerror();
	if (e) {
		snprintf(err, (size_t)errlen, "%s", e);
		return 0;
	}
	return p;
}

static void zpow_dlclose(void* h) {
	if (h) dlclose(h);
}

typedef int (*zpow_device_count_fn)(void);
typedef int (*zpow_set_device_fn)(int);
typedef int (*zpow_device_name_fn)(int, char*, int);
typedef const char* (*zpow_last_error_fn)(void);
typedef int (*zpow_factor_batch_fn)(const unsigned char*, int, int, double*, int*);

static int call_count(void* f) { return ((zpow_device_count_fn)f)(); }
static int call_set(void* f, int d) { return ((zpow_set_device_fn)f)(d); }
static int call_name(void* f, int d, char* buf, int n) { return ((zpow_device_name_fn)f)(d, buf, n); }
static const char* call_err(void* f) { return ((zpow_last_error_fn)f)(); }
static int call_factor(void* f, const unsigned char* hashes, int count, int emery, double* diags, int* signs) {
	return ((zpow_factor_batch_fn)f)(hashes, count, emery, diags, signs);
}
*/
import "C"
import (
	"fmt"
	"unsafe"
)

type native struct {
	handle unsafe.Pointer
	count  unsafe.Pointer
	set    unsafe.Pointer
	name   unsafe.Pointer
	last   unsafe.Pointer
	factor unsafe.Pointer
}

func loadNative(path string) (*native, error) {
	cpath := C.CString(path)
	defer C.free(unsafe.Pointer(cpath))
	var errbuf [512]C.char
	h := C.zpow_dlopen(cpath, &errbuf[0], C.int(len(errbuf)))
	if h == nil {
		return nil, fmt.Errorf("dlopen %s: %s", path, C.GoString(&errbuf[0]))
	}
	n := &native{handle: unsafe.Pointer(h)}
	var err error
	n.count, err = lookup(unsafe.Pointer(h), "zpow_device_count")
	if err != nil {
		n.close()
		return nil, err
	}
	n.set, err = lookup(unsafe.Pointer(h), "zpow_set_device")
	if err != nil {
		n.close()
		return nil, err
	}
	n.name, err = lookup(unsafe.Pointer(h), "zpow_device_name")
	if err != nil {
		n.close()
		return nil, err
	}
	n.last, err = lookup(unsafe.Pointer(h), "zpow_last_error")
	if err != nil {
		n.close()
		return nil, err
	}
	n.factor, err = lookup(unsafe.Pointer(h), "zpow_factor_batch")
	if err != nil {
		n.close()
		return nil, err
	}
	return n, nil
}

func lookup(h unsafe.Pointer, name string) (unsafe.Pointer, error) {
	cname := C.CString(name)
	defer C.free(unsafe.Pointer(cname))
	var errbuf [512]C.char
	p := C.zpow_dlsym(h, cname, &errbuf[0], C.int(len(errbuf)))
	if p == nil {
		return nil, fmt.Errorf("dlsym %s: %s", name, C.GoString(&errbuf[0]))
	}
	return unsafe.Pointer(p), nil
}

func (n *native) deviceCount() (int, error) {
	c := int(C.call_count(n.count))
	if c < 0 {
		return 0, fmt.Errorf("cuda device count: %s", n.lastError())
	}
	return c, nil
}

func (n *native) setDevice(device int) error {
	rc := int(C.call_set(n.set, C.int(device)))
	if rc != 0 {
		return fmt.Errorf("cuda set device %d: %s", device, n.lastError())
	}
	return nil
}

func (n *native) deviceName(device int) (string, error) {
	var buf [256]C.char
	rc := int(C.call_name(n.name, C.int(device), &buf[0], C.int(len(buf))))
	if rc != 0 {
		return "", fmt.Errorf("cuda device name: %s", n.lastError())
	}
	return C.GoString(&buf[0]), nil
}

func (n *native) lastError() string {
	p := C.call_err(n.last)
	if p == nil {
		return ""
	}
	return C.GoString(p)
}

func (n *native) factor(hashes []byte, emery int, diags []float64, signs []int32) error {
	if len(hashes) == 0 {
		return nil
	}
	count := len(hashes) / 32
	if count == 0 || len(diags) < count*Dim || len(signs) < count {
		return fmt.Errorf("gpu: short factor buffers")
	}
	rc := int(C.call_factor(
		n.factor,
		(*C.uchar)(unsafe.Pointer(&hashes[0])),
		C.int(count),
		C.int(emery),
		(*C.double)(unsafe.Pointer(&diags[0])),
		(*C.int)(unsafe.Pointer(&signs[0])),
	))
	if rc != 0 {
		return fmt.Errorf("zpow_factor_batch: %s", n.lastError())
	}
	return nil
}

func (n *native) close() {
	if n.handle != nil {
		C.zpow_dlclose(n.handle)
		n.handle = nil
	}
}
