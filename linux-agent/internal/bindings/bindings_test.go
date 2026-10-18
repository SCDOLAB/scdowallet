package bindings

import "testing"

func TestParse(t *testing.T) {
	text := `
# fleet map
[[account]]
handle = "@alice"
user_id = "100"
agent = "alice"

[[account]]
handle = "bob"
user_id = "200"
agent = "bob"
`
	rows, err := Parse(text)
	if err != nil || len(rows) != 2 || rows[0].Handle != "alice" || rows[1].Agent != "bob" {
		t.Fatalf("%v %+v", err, rows)
	}
	if _, err := Parse("[[account]]\nhandle = \"a\"\n"); err == nil {
		t.Fatal("incomplete row")
	}
}
