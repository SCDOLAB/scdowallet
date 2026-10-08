package zp

// Known-good shard1 mainnet block (#9262262, hash 0x8abde557785f05072a47ad7aa6466af0ec4e6cd79964d9f8609d2f9c5eae0d02), used as a startup self-test so a
// build linked against a fake scdorand stub refuses to run (see node_stall_rootcause.md).
const selfTestHeader = `{"Consensus": 0, "CreateTimestamp": 1791018543, "Creator": "1S01dfdbe4d921d507032cb83ee04bb7efc4fd9a51", "DebtHash": "0x0000000000000000000000000000000000000000000000000000000000000000", "Difficulty": 2854297, "ExtraData": "", "Height": 9262262, "PreviousBlockHash": "0xf308b0acce9624fb93c450951d38d0823b8d0c09f329bd88a8f8be1c0742877e", "ReceiptHash": "0x6269f1869abf8adf4180b39fc1720e43d1f23c411ea98655e32fbd4dd2e7e896", "SecondWitness": "", "StateHash": "0x2cc0275147167857a7a7f74b80060b380865aabaf4306d3e0de9363bf82a655f", "TxDebtHash": "0x0000000000000000000000000000000000000000000000000000000000000000", "TxHash": "0xb2b7c26fa4aaa5b055f618626fceffdbe494f93eb81d7569e0a89a7ce5a5da6d", "Witness": "MjY2ODM1OTgzMjIwODcxMDI1Mg=="}`
const selfTestHash = "0x8abde557785f05072a47ad7aa6466af0ec4e6cd79964d9f8609d2f9c5eae0d02"

// SelfTest returns nil only if this binary reproduces the real zpow result for a real block.
func SelfTest() error {
	h, err := ParseHeader([]byte(selfTestHeader))
	if err != nil {
		return err
	}
	if h.Hash().Hex() != selfTestHash {
		return errSelf("header hash mismatch")
	}
	if !VerifyBlock(h) {
		return errSelf("zpow det below target for a real block: wrong scdorand (stub?) build")
	}
	c := *h
	c.Witness = append([]byte{}, h.Witness...)
	c.Witness[len(c.Witness)-1] ^= 1
	if VerifyBlock(&c) {
		return errSelf("tampered nonce accepted")
	}
	return nil
}

type errSelf string

func (e errSelf) Error() string { return "zpow self-test failed: " + string(e) }
