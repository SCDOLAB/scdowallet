package ledger

import (
	"fmt"
	"strings"
)

// knownBadPayouts are burn/sink addresses and publicly known test keys (Hardhat/Anvil
// default accounts 0-9). The SCDO Agent Ledger refuses them as payout addresses.
var knownBadPayouts = map[string]bool{
	"000000000000000000000000000000000000dead": true,
	"dead000000000000000042069420694206942069": true,
	"deaddeaddeaddeaddeaddeaddeaddeaddeaddead": true,
	"f39fd6e51aad88f6f4ce6ab8827279cfffb92266": true,
	"70997970c51812dc3a010c7d01b50e0d17dc79c8": true,
	"3c44cdddb6a900fa2b585dd299e03d12fa4293bc": true,
	"90f79bf6eb2c4f870365e785982e1f101e93b906": true,
	"15d34aaf54267db7d7c367839aaf71a00a2c6a65": true,
	"9965507d1a55bcc2695c58ba16fb37d819b0a4dc": true,
	"976ea74026e726554db657fa54763abd0c3a0aa9": true,
	"14dc79964da2c08b23698b3d3cc7ca32193d9955": true,
	"23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f": true,
	"a0ee7a142d267c1f36714e4a8f75612f20a79720": true,
}

// ValidPayout returns the EIP-55 payout address, or an error for anything that is not a
// real payout: bad checksum, zero/placeholder (0x0000..., 0x1111...1111, repeated digits or
// short repeated patterns), burn addresses and public test keys. Same rule as the ledger.
func ValidPayout(s string) (string, error) {
	sum, err := ChecksumAddress(s)
	if err != nil {
		return "", err
	}
	lower := strings.ToLower(sum[2:])
	bad := fmt.Errorf("payout %s is a placeholder, burn or test address; use a real wallet you control", sum)
	if knownBadPayouts[lower] {
		return "", bad
	}
	seen := map[rune]bool{}
	run, best := 1, 1
	for i, r := range lower {
		seen[r] = true
		if i > 0 && lower[i] == lower[i-1] {
			run++
			if run > best {
				best = run
			}
		} else {
			run = 1
		}
	}
	if len(seen) < 4 || best >= 20 {
		return "", bad
	}
	for p := 2; p <= 8; p++ {
		if strings.HasPrefix(strings.Repeat(lower[:p], 40/p+1), lower) {
			return "", bad
		}
	}
	return sum, nil
}
