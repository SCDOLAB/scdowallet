// Package ledger speaks the SCDO Agent Ledger v1 envelope used by the desktop wallet.
// Canonical JSON matches src/agent/envelope.js canonical() / JSON.stringify.
package ledger

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// Prefix is the exact EIP-191 message prefix. The desktop constant is
// 'SCDO Agent Ledger v1\n'.
const Prefix = "SCDO Agent Ledger v1\n"

// Canonical encodes v the way envelope.js canonical() does: object keys sorted,
// undefined keys omitted (they are simply absent), compact separators, and
// JSON.stringify escaping. Non-finite numbers become null.
func Canonical(v any) (string, error) {
	var b strings.Builder
	if err := writeCanonical(&b, v); err != nil {
		return "", err
	}
	return b.String(), nil
}

func writeCanonical(b *strings.Builder, v any) error {
	switch t := v.(type) {
	case nil:
		b.WriteString("null")
		return nil
	case bool:
		if t {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
		return nil
	case string:
		writeString(b, t)
		return nil
	case int:
		b.WriteString(strconv.FormatInt(int64(t), 10))
		return nil
	case int64:
		b.WriteString(strconv.FormatInt(t, 10))
		return nil
	case int32:
		b.WriteString(strconv.FormatInt(int64(t), 10))
		return nil
	case uint:
		b.WriteString(strconv.FormatUint(uint64(t), 10))
		return nil
	case uint64:
		b.WriteString(strconv.FormatUint(t, 10))
		return nil
	case float64:
		b.WriteString(formatFloat(t))
		return nil
	case float32:
		b.WriteString(formatFloat(float64(t)))
		return nil
	case []any:
		b.WriteByte('[')
		for i, el := range t {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := writeCanonical(b, el); err != nil {
				return err
			}
		}
		b.WriteByte(']')
		return nil
	case []string:
		arr := make([]any, len(t))
		for i, s := range t {
			arr[i] = s
		}
		return writeCanonical(b, arr)
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		b.WriteByte('{')
		first := true
		for _, k := range keys {
			if !first {
				b.WriteByte(',')
			}
			first = false
			writeString(b, k)
			b.WriteByte(':')
			if err := writeCanonical(b, t[k]); err != nil {
				return err
			}
		}
		b.WriteByte('}')
		return nil
	default:
		return fmt.Errorf("canonical: unsupported %T", v)
	}
}

func formatFloat(f float64) string {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return "null"
	}
	if f == math.Trunc(f) && f >= -9007199254740991 && f <= 9007199254740991 {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

func writeString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				fmt.Fprintf(b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}
