package contracts

import (
	"testing"

	"github.com/and1truong/aegir/internal/analyzer"
)

func TestCompareClassifiesRequiredFieldAsBreaking(t *testing.T) {
	base := analyzer.Contract{ID: "contract:1", Path: "openapi.yaml", Name: "openapi.yaml", Type: "openapi", Fingerprint: "base", Shape: map[string]string{"/components/schemas/Order/type": "string:object"}}
	head := analyzer.Contract{ID: "contract:1", Path: "openapi.yaml", Name: "openapi.yaml", Type: "openapi", Fingerprint: "head", Shape: map[string]string{"/components/schemas/Order/type": "string:object", "/components/schemas/Order/required/0": "string:id"}}
	diff := Compare(1, 2, []analyzer.Contract{base}, []analyzer.Contract{head})
	if len(diff.Changes) != 1 || diff.Changes[0].Compatibility != "break" || len(diff.Changes[0].Fields) != 1 {
		t.Fatalf("unexpected diff: %#v", diff)
	}
}
