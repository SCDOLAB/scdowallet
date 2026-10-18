package wallet

import (
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/sys/unix"
)

const spendLogName = "spend-log.json"

type spendEntry struct {
	ID     string `json:"id,omitempty"`
	Amount string `json:"amount"`
	Asset  string `json:"asset,omitempty"`
	At     string `json:"at"`
	Until  string `json:"until,omitempty"`
	Nonce  string `json:"nonce,omitempty"`
	Tx     string `json:"tx,omitempty"`
	State  string `json:"state"`
}

type spendLog struct {
	V       int          `json:"v"`
	Entries []spendEntry `json:"entries"`
}

func spendLogPath(dir string) string {
	return filepath.Join(dir, spendLogName)
}

func readSpend(dir string) spendLog {
	raw, err := os.ReadFile(spendLogPath(dir))
	if err != nil || len(raw) == 0 {
		return spendLog{}
	}
	var log spendLog
	if json.Unmarshal(raw, &log) != nil {
		return spendLog{}
	}
	return log
}

func withSpendLock(dir string, fn func(*spendLog) error) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(spendLogPath(dir), os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := os.Chmod(spendLogPath(dir), 0o600); err != nil {
		return err
	}
	if err := unix.Flock(int(f.Fd()), unix.LOCK_EX); err != nil {
		return err
	}
	defer unix.Flock(int(f.Fd()), unix.LOCK_UN)
	raw, err := os.ReadFile(spendLogPath(dir))
	if err != nil {
		return err
	}
	var log spendLog
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &log); err != nil {
			return err
		}
	}
	if err := fn(&log); err != nil {
		return err
	}
	log.V = 1
	b, err := json.MarshalIndent(log, "", "  ")
	if err != nil {
		return err
	}
	if err := f.Truncate(0); err != nil {
		return err
	}
	if _, err := f.Seek(0, 0); err != nil {
		return err
	}
	_, err = f.Write(append(b, '\n'))
	return err
}

func (l spendLog) window(now time.Time) *big.Int {
	return l.windowAsset(now, "")
}

func (l spendLog) windowAsset(now time.Time, asset string) *big.Int {
	cut := now.Add(-24 * time.Hour)
	sum := big.NewInt(0)
	for _, e := range l.Entries {
		if !spendAssetMatch(e.Asset, asset) {
			continue
		}
		amt, ok := new(big.Int).SetString(e.Amount, 10)
		if !ok {
			continue
		}
		switch e.State {
		case "settled":
			at, err := time.Parse(time.RFC3339, e.At)
			if err != nil || at.Before(cut) {
				continue
			}
			sum.Add(sum, amt)
		case "pending":
			until, err := time.Parse(time.RFC3339, e.Until)
			if err != nil || !until.After(now) {
				continue
			}
			sum.Add(sum, amt)
		}
	}
	return sum
}

func seedHistory(doc Doc, log *spendLog, now time.Time) {
	if len(log.Entries) > 0 {
		return
	}
	spent := doc.spentToday(now)
	if spent.Sign() == 0 {
		return
	}
	log.Entries = append(log.Entries, spendEntry{
		Amount: spent.String(),
		At:     now.UTC().Format(time.RFC3339),
		State:  "settled",
		Tx:     doc.LastTx,
	})
}

func enforcedSpent(doc Doc, log spendLog, now time.Time) *big.Int {
	if len(log.Entries) == 0 {
		return doc.spentToday(now)
	}
	return log.window(now)
}

func spendAssetMatch(entry, want string) bool {
	usdc := want == "" || want == AssetUSDC || sameAddr(want, SepoliaUSDC)
	if usdc {
		return entry == "" || entry == AssetUSDC || sameAddr(entry, SepoliaUSDC)
	}
	return entry == want || sameAddr(entry, want)
}

func reservePending(log *spendLog, id, amount, asset string, now time.Time) {
	log.Entries = append(log.Entries, spendEntry{
		ID:     id,
		Amount: amount,
		Asset:  asset,
		At:     now.UTC().Format(time.RFC3339),
		Until:  now.Add(120 * time.Second).UTC().Format(time.RFC3339),
		State:  "pending",
	})
}

func noteNonce(log *spendLog, id, nonce string) {
	for i := range log.Entries {
		if log.Entries[i].ID == id && log.Entries[i].State == "pending" {
			log.Entries[i].Nonce = nonce
			return
		}
	}
}

func noteSettled(log *spendLog, id, tx string, now time.Time) {
	for i := range log.Entries {
		if log.Entries[i].ID == id {
			log.Entries[i].State = "settled"
			log.Entries[i].Tx = tx
			log.Entries[i].At = now.UTC().Format(time.RFC3339)
			log.Entries[i].Until = ""
			return
		}
	}
}
