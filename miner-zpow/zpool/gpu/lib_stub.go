// +build !cuda

package gpu

import (
	"fmt"

	"github.com/scdoproject/go-scdo/common"
)

// Device is the no-CUDA stub. The pool miner is built with -tags cuda.
type Device struct{}

// Open reports that this binary was built without the CUDA loader.
func Open(path string, device int) (*Device, error) {
	return nil, fmt.Errorf("this binary was built without -tags cuda (GPU library loader is not linked)")
}

// Name is empty on the stub.
func (d *Device) Name() string { return "" }

// Close is a no-op on the stub.
func (d *Device) Close() {}

// Dets is unavailable on the stub.
func (d *Device) Dets(hashes []common.Hash, height uint64) ([]float64, error) {
	return nil, fmt.Errorf("this binary was built without -tags cuda")
}
