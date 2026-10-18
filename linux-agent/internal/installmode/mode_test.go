package installmode

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestUserPathsAndResolve(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("SCDO_AGENT_MODE", "")
	if UserBin() != filepath.Join(home, ".local", "bin", "scdo-agent") {
		t.Fatal(UserBin())
	}
	if UserData() != filepath.Join(home, ".local", "share", "scdo-agent") {
		t.Fatal(UserData())
	}
	if got := Resolve(Input{DataRoot: UserData()}); got != ModeUser {
		t.Fatal(got)
	}
	if got := Resolve(Input{DataRoot: SystemData}); got != ModeSystem {
		t.Fatal(got)
	}
	if got := Resolve(Input{Binary: UserBin()}); got != ModeUser {
		t.Fatal(got)
	}
	t.Setenv("SCDO_AGENT_MODE", "user")
	if got := Resolve(Input{DataRoot: SystemData}); got != ModeUser {
		t.Fatal(got)
	}
	t.Setenv("SCDO_AGENT_MODE", "system")
	if got := Resolve(Input{ForceUser: true}); got != ModeUser {
		t.Fatal(got)
	}
}

func TestScopeFileSelectsUser(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("SCDO_AGENT_MODE", "")
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "install-scope"), []byte("user\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := Resolve(Input{DataRoot: root, DataExplicit: true}); got != ModeUser {
		t.Fatal(got)
	}
}

func TestAcquireIsExclusiveAcrossModes(t *testing.T) {
	t.Setenv("SCDO_AGENT_MODE", "system")
	release, err := Acquire("fieldlock51", ModeUser)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	_, err = Acquire("fieldlock51", ModeSystem)
	if !errors.Is(err, ErrHeld) {
		t.Fatal(err)
	}
}
