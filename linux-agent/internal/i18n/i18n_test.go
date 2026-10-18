package i18n

import "testing"

func TestLanguageName(t *testing.T) {
	if New(ZH).T("langName") != "華語" {
		t.Fatal(New(ZH).T("langName"))
	}
	if New(EN).T("langName") != "English" {
		t.Fatal(New(EN).T("langName"))
	}
}
