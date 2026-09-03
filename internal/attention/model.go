package attention

const ModelVersion = "attention-v1.4"

type EvidenceRef struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

type Factor struct {
	ID           string        `json:"id"`
	Label        string        `json:"label"`
	RawValue     float64       `json:"rawValue"`
	DisplayValue string        `json:"displayValue"`
	Normalized   float64       `json:"normalized"`
	Weight       float64       `json:"weight"`
	Contribution float64       `json:"contribution"`
	Status       string        `json:"status"`
	EvidenceRefs []EvidenceRef `json:"evidenceRefs"`
}

type Dimension struct {
	Score    *int     `json:"score"`
	Coverage float64  `json:"coverage"`
	Factors  []Factor `json:"factors"`
}

type UnitRef struct {
	ID        string   `json:"id"`
	Label     string   `json:"label"`
	Path      string   `json:"path,omitempty"`
	Kind      string   `json:"kind"`
	Team      string   `json:"team,omitempty"`
	Teams     []string `json:"teams,omitempty"`
	Subsystem string   `json:"subsystem,omitempty"`
}

type Unit struct {
	Unit             UnitRef   `json:"unit"`
	Impact           Dimension `json:"impact"`
	ChangeComplexity Dimension `json:"changeComplexity"`
	ChangeVelocity   Dimension `json:"changeVelocity"`
	Priority         int       `json:"priority"`
	Region           string    `json:"region"`
	MemberCount      int       `json:"memberCount"`
}

type Finding struct {
	ID              string        `json:"id"`
	UnitID          string        `json:"unitId"`
	Priority        int           `json:"priority"`
	Region          string        `json:"region"`
	Title           string        `json:"title"`
	Explanation     string        `json:"explanation"`
	DominantFactors []string      `json:"dominantFactors"`
	EvidenceRefs    []EvidenceRef `json:"evidenceRefs"`
}

type Policy struct {
	ID                     string `json:"id"`
	ImpactHigh             int    `json:"impactHigh"`
	ComplexityHigh         int    `json:"complexityHigh"`
	VelocityFast           int    `json:"velocityFast"`
	MaximumFindings        int    `json:"maximumFindings"`
	MinimumFindingPriority int    `json:"minimumFindingPriority"`
}

type Completeness struct {
	HistoryAvailable bool     `json:"historyAvailable"`
	HistoryShallow   bool     `json:"historyShallow"`
	OptionalSignals  []string `json:"optionalSignals"`
	Warnings         []string `json:"warnings"`
}

type Landscape struct {
	Version      int          `json:"version"`
	ModelVersion string       `json:"modelVersion"`
	CalculatedAt string       `json:"calculatedAt"`
	SnapshotID   int64        `json:"snapshotId"`
	RepositoryID string       `json:"repositoryId"`
	UnitLevel    string       `json:"unitLevel"`
	WindowDays   int          `json:"windowDays"`
	Policy       Policy       `json:"policy"`
	Completeness Completeness `json:"completeness"`
	Units        []Unit       `json:"units"`
	Findings     []Finding    `json:"findings"`
}

type ReviewUnit struct {
	Unit                 Unit     `json:"unit"`
	Touched              bool     `json:"touched"`
	FocalNodeID          string   `json:"focalNodeId,omitempty"`
	ChangeStatuses       []string `json:"changeStatuses"`
	ChangedNodes         int      `json:"changedNodes"`
	ChangedRelationships int      `json:"changedRelationships"`
	ReviewPriority       int      `json:"reviewPriority"`
}

type ReviewAttention struct {
	Version            int          `json:"version"`
	ReviewID           string       `json:"reviewId"`
	Baseline           Landscape    `json:"baseline"`
	Units              []ReviewUnit `json:"units"`
	TouchedUnits       int          `json:"touchedUnits"`
	HighAttentionUnits int          `json:"highAttentionUnits"`
	NewNodes           int          `json:"newNodes"`
	NewRelationships   int          `json:"newRelationships"`
	Summary            string       `json:"summary"`
}

func DefaultPolicy() Policy {
	return Policy{ID: "default-v1", ImpactHigh: 50, ComplexityHigh: 60, VelocityFast: 65, MaximumFindings: 3, MinimumFindingPriority: 45}
}
