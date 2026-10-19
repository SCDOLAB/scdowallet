package ledger

import "testing"

func TestValidPayout(t *testing.T) {
	bad := []string{
		"0x0000000000000000000000000000000000000000",
		"0x1111111111111111111111111111111111111111",
		"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"0x0000000000000000000000000000000000000001",
		"0x000000000000000000000000000000000000dEaD",
		"0x1234123412341234123412341234123412341234",
		"0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
		"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
		"0xE750146Dffc722f231583De628696F05D694f5eD", // bad checksum (case flipped)
		"0x123", "",
	}
	for _, s := range bad {
		if _, err := ValidPayout(s); err == nil {
			t.Fatalf("%s accepted", s)
		}
	}
	good := []string{"0xe750146Dffc722f231583De628696F05D694f5eD", "0x2d6f6ebc9686d0316e1f24f8588585c1f22fc956"}
	for _, s := range good {
		if _, err := ValidPayout(s); err != nil {
			t.Fatalf("%s rejected: %v", s, err)
		}
	}
}
