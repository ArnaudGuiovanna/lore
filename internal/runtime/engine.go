package runtime

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"lore/internal/core"
	"lore/internal/ids"
	"lore/internal/observability"

	"go.opentelemetry.io/otel/attribute"
)

type Store interface {
	GetDomainGraph(ctx context.Context, tenantID, domainID string) (core.DomainGraph, error)
	GetLearnerStates(ctx context.Context, tenantID, learnerID, domainID string) ([]core.LearnerState, error)
	ListActiveMisconceptions(ctx context.Context, tenantID, learnerID, domainID string) ([]core.Misconception, error)
	GetRecentInteractions(ctx context.Context, tenantID, learnerID, domainID string, limit int) ([]core.Interaction, error)
	SavePlannedActivity(ctx context.Context, activity core.Activity, instruction core.TutorInstruction, snapshot core.PedagogicalSnapshot, events []core.Event) error
	GetActivity(ctx context.Context, tenantID, activityID string) (core.Activity, core.TutorInstruction, error)
	SaveInteractionDelta(ctx context.Context, delta core.StateDelta, activity core.Activity) error
	ListLearnerState(ctx context.Context, tenantID, learnerID string) ([]core.LearnerState, error)
}

type Engine struct {
	store Store
	clock func() time.Time
}

type PlanNextInput struct {
	TenantID  string `json:"tenant_id"`
	LearnerID string `json:"learner_id"`
	DomainID  string `json:"domain_id"`
	Intent    string `json:"intent,omitempty"`
}

func NewEngine(store Store) *Engine {
	return &Engine{store: store, clock: func() time.Time { return time.Now().UTC() }}
}

func (e *Engine) WithClock(clock func() time.Time) *Engine {
	if clock != nil {
		e.clock = clock
	}
	return e
}

func (e *Engine) PlanNext(ctx context.Context, in PlanNextInput) (core.RuntimeDecision, error) {
	ctx, span := observability.StartSpan(ctx, "runtime.PlanNext",
		attribute.String("tenant_id", in.TenantID),
		attribute.String("learner_id", in.LearnerID),
		attribute.String("domain_id", in.DomainID),
	)
	defer span.End()
	if in.TenantID == "" || in.LearnerID == "" || in.DomainID == "" {
		return core.RuntimeDecision{}, fmt.Errorf("%w: tenant_id, learner_id and domain_id are required", core.ErrInvalidInput)
	}
	now := e.clock()
	graph, err := e.store.GetDomainGraph(ctx, in.TenantID, in.DomainID)
	if err != nil {
		return core.RuntimeDecision{}, err
	}
	if err := ValidateGraph(graph.Concepts, graph.Dependencies); err != nil {
		return core.RuntimeDecision{}, err
	}
	if len(graph.Concepts) == 0 {
		return core.RuntimeDecision{}, fmt.Errorf("%w: domain has no concepts", core.ErrInvalidInput)
	}

	states, err := e.store.GetLearnerStates(ctx, in.TenantID, in.LearnerID, in.DomainID)
	if err != nil {
		return core.RuntimeDecision{}, err
	}
	stateByConcept := make(map[string]core.LearnerState, len(states))
	for _, state := range states {
		state.Retention = Retention(state.Stability, state.DueAt, now)
		stateByConcept[state.ConceptID] = state
	}

	recent, err := e.store.GetRecentInteractions(ctx, in.TenantID, in.LearnerID, in.DomainID, 20)
	if err != nil {
		return core.RuntimeDecision{}, err
	}
	misconceptions, err := e.store.ListActiveMisconceptions(ctx, in.TenantID, in.LearnerID, in.DomainID)
	if err != nil {
		return core.RuntimeDecision{}, err
	}

	phase := evaluatePhase(graph.Concepts, stateByConcept, now)
	selection := conceptSelection{}
	activityType := core.ActivityType("")
	if failures := consecutiveFailuresByLearner(recent)[in.LearnerID]; failures >= 3 {
		selection = overloadEscapeConcept(graph, stateByConcept, recent, now, in.LearnerID, failures)
		activityType = core.ActivityRest
	} else {
		selection = selectConcept(graph, stateByConcept, recent, misconceptions, now, in.LearnerID, in.Intent, phase)
		activityType = selectActivity(selection.State, selection.Reason, in.Intent, phase, selection.ActiveMisconception)
	}
	difficulty := clamp(0.35+selection.State.Mastery*0.55, 0.35, 0.95)
	rationale := fmt.Sprintf("%s; phase=%s; recent_interactions=%d", selection.Reason, phase, len(recent))

	activityID := ids.New()
	instructionID := ids.New()
	activity := core.Activity{
		TenantID:         in.TenantID,
		ID:               activityID,
		LearnerID:        in.LearnerID,
		DomainID:         in.DomainID,
		ConceptID:        selection.Concept.ID,
		ActivityType:     activityType,
		DifficultyTarget: difficulty,
		Status:           core.ActivityPlanned,
		InstructionID:    instructionID,
		AuditRationale:   rationale,
		CreatedAt:        now,
	}
	instruction := core.TutorInstruction{
		ID:               instructionID,
		TenantID:         in.TenantID,
		LearnerID:        in.LearnerID,
		DomainID:         in.DomainID,
		ConceptID:        selection.Concept.ID,
		ActivityID:       activityID,
		ActivityType:     activityType,
		DifficultyTarget: difficulty,
		Constraints: []string{
			"Do not decide mastery, retention, review timing, or learner progression.",
			"Collect observable learner evidence aligned with the requested activity.",
			"Return generated content only; runtime state is updated by LORE.",
		},
		AllowedVariants: allowedVariants(activityType),
		Context: map[string]any{
			"domain":       graph.Domain.Name,
			"concept":      selection.Concept.Name,
			"description":  selection.Concept.Description,
			"mastery":      selection.State.Mastery,
			"retention":    selection.State.Retention,
			"confidence":   selection.State.Confidence,
			"ability":      selection.State.Ability,
			"phase":        phase,
			"rationale":    rationale,
			"graphVersion": graph.Domain.GraphVersion,
		},
		CreatedAt: now,
	}
	if selection.ActiveMisconception {
		instruction.Context["misconception"] = map[string]any{
			"id":          selection.Misconception.ID,
			"description": selection.Misconception.Description,
			"severity":    selection.Misconception.Severity,
		}
	}
	snapshot := core.PedagogicalSnapshot{
		TenantID:   in.TenantID,
		ID:         ids.New(),
		ActivityID: activityID,
		LearnerID:  in.LearnerID,
		DomainID:   in.DomainID,
		ConceptID:  selection.Concept.ID,
		Before: map[string]any{
			"state": selection.State,
		},
		Decision: map[string]any{
			"phase":           phase,
			"activity_type":   activityType,
			"concept_id":      selection.Concept.ID,
			"audit_rationale": rationale,
		},
		CreatedAt: now,
	}
	if selection.ActiveMisconception {
		snapshot.Decision["misconception_id"] = selection.Misconception.ID
	}
	events := []core.Event{
		newEvent(in.TenantID, "ActivityPlanned", "activity", activityID, now, map[string]any{"learner_id": in.LearnerID, "domain_id": in.DomainID}),
		newEvent(in.TenantID, "TutorInstructionCreated", "tutor_instruction", instructionID, now, map[string]any{"activity_id": activityID}),
	}
	if err := e.store.SavePlannedActivity(ctx, activity, instruction, snapshot, events); err != nil {
		return core.RuntimeDecision{}, err
	}
	return core.RuntimeDecision{
		DecisionID:       snapshot.ID,
		Activity:         activity,
		TutorInstruction: instruction,
		Snapshot:         snapshot,
	}, nil
}

func (e *Engine) RecordInteraction(ctx context.Context, cmd core.InteractionCommand) (core.StateDelta, error) {
	ctx, span := observability.StartSpan(ctx, "runtime.RecordInteraction",
		attribute.String("tenant_id", cmd.TenantID),
		attribute.String("learner_id", cmd.LearnerID),
	)
	defer span.End()
	delta, completed, err := e.PrepareInteractionDelta(ctx, cmd)
	if err != nil {
		return core.StateDelta{}, err
	}
	if err := e.store.SaveInteractionDelta(ctx, delta, completed); err != nil {
		return core.StateDelta{}, err
	}
	return delta, nil
}

func (e *Engine) PrepareInteractionDelta(ctx context.Context, cmd core.InteractionCommand) (core.StateDelta, core.Activity, error) {
	if cmd.TenantID == "" || cmd.LearnerID == "" || cmd.ActivityID == "" {
		return core.StateDelta{}, core.Activity{}, fmt.Errorf("%w: tenant_id, learner_id and activity_id are required", core.ErrInvalidInput)
	}
	if math.IsNaN(cmd.Score) || math.IsInf(cmd.Score, 0) || cmd.Score < 0 || cmd.Score > 1 {
		return core.StateDelta{}, core.Activity{}, fmt.Errorf("%w: score must be in [0,1]", core.ErrInvalidInput)
	}
	now := e.clock()
	activity, instruction, err := e.store.GetActivity(ctx, cmd.TenantID, cmd.ActivityID)
	if err != nil {
		return core.StateDelta{}, core.Activity{}, err
	}
	if activity.LearnerID != cmd.LearnerID {
		return core.StateDelta{}, core.Activity{}, fmt.Errorf("%w: activity learner does not match command learner", core.ErrTenantMismatch)
	}
	states, err := e.store.GetLearnerStates(ctx, cmd.TenantID, cmd.LearnerID, activity.DomainID)
	if err != nil {
		return core.StateDelta{}, core.Activity{}, err
	}
	before := DefaultLearnerState(cmd.TenantID, cmd.LearnerID, activity.DomainID, activity.ConceptID, now)
	for _, state := range states {
		if state.ConceptID == activity.ConceptID {
			before = state
			break
		}
	}
	before.Retention = Retention(before.Stability, before.DueAt, now)
	activeMisconceptions, err := e.store.ListActiveMisconceptions(ctx, cmd.TenantID, cmd.LearnerID, activity.DomainID)
	if err != nil {
		return core.StateDelta{}, core.Activity{}, err
	}

	success := cmd.Success || cmd.Score >= 0.60
	after := BKTUpdate(before, success)
	after = ApplyReviewSchedule(after, success, cmd.Score, now)

	interaction := core.Interaction{
		TenantID:   cmd.TenantID,
		ID:         ids.New(),
		LearnerID:  cmd.LearnerID,
		ActivityID: cmd.ActivityID,
		DomainID:   activity.DomainID,
		ConceptID:  activity.ConceptID,
		Success:    success,
		Score:      cmd.Score,
		ErrorType:  cmd.ErrorType,
		Payload:    cmd.Payload,
		CreatedAt:  now,
	}
	evaluation := core.Evaluation{
		TenantID:      cmd.TenantID,
		ID:            ids.New(),
		InteractionID: interaction.ID,
		Score:         cmd.Score,
		Feedback:      cmd.Feedback,
		Rubric: map[string]any{
			"activity_type":     instruction.ActivityType,
			"runtime_validated": true,
		},
		CreatedAt: now,
	}
	snapshot := core.PedagogicalSnapshot{
		TenantID:      cmd.TenantID,
		ID:            ids.New(),
		InteractionID: interaction.ID,
		ActivityID:    cmd.ActivityID,
		LearnerID:     cmd.LearnerID,
		DomainID:      activity.DomainID,
		ConceptID:     activity.ConceptID,
		Before:        map[string]any{"state": before},
		Observation: map[string]any{
			"success":    success,
			"score":      cmd.Score,
			"error_type": cmd.ErrorType,
		},
		After: map[string]any{"state": after},
		Decision: map[string]any{
			"activity_type": activity.ActivityType,
			"mastery_delta": after.Mastery - before.Mastery,
			"review_due_at": after.DueAt,
		},
		CreatedAt: now,
	}
	activityCompleted := newEvent(cmd.TenantID, "ActivityCompleted", "activity", cmd.ActivityID, now, map[string]any{"learner_id": cmd.LearnerID, "interaction_id": interaction.ID})
	activityCompleted.CausationID = interaction.ID
	events := []core.Event{
		activityCompleted,
		newEvent(cmd.TenantID, "InteractionRecorded", "interaction", interaction.ID, now, map[string]any{"activity_id": cmd.ActivityID}),
		newEvent(cmd.TenantID, "EvaluationRecorded", "evaluation", evaluation.ID, now, map[string]any{"interaction_id": interaction.ID, "score": cmd.Score}),
		newEvent(cmd.TenantID, "LearnerStateUpdated", "learner_state", after.ConceptID, now, map[string]any{"learner_id": cmd.LearnerID, "mastery": after.Mastery}),
		newEvent(cmd.TenantID, "ReviewScheduled", "review_card", after.ConceptID, now, map[string]any{"learner_id": cmd.LearnerID, "due_at": after.DueAt}),
	}
	var misconceptionChanges []core.Misconception
	if before.Mastery < MasteryThreshold && after.Mastery >= MasteryThreshold {
		events = append(events, newEvent(cmd.TenantID, "ConceptMastered", "concept", after.ConceptID, now, map[string]any{"learner_id": cmd.LearnerID}))
	}
	// ReviewCompleted: a due review card existed (or the activity was an explicit
	// review) and the learner just interacted with that concept.
	if activity.ActivityType == core.ActivityReview || (before.DueAt != nil && !before.DueAt.After(now)) {
		events = append(events, newEvent(cmd.TenantID, "ReviewCompleted", "review_card", after.ConceptID, now, map[string]any{
			"learner_id": cmd.LearnerID,
			"success":    success,
			"score":      cmd.Score,
		}))
	}
	if activity.ActivityType == core.ActivityAssessment {
		events = append(events, newEvent(cmd.TenantID, "AssessmentCompleted", "activity", cmd.ActivityID, now, map[string]any{
			"learner_id":      cmd.LearnerID,
			"concept_id":      after.ConceptID,
			"interaction_id":  interaction.ID,
			"evaluation_id":   evaluation.ID,
			"success":         success,
			"score":           cmd.Score,
			"mastery":         after.Mastery,
			"runtime_scored":  true,
			"activity_type":   activity.ActivityType,
			"assessment_kind": instruction.Context["assessment_kind"],
		}))
	}
	// MisconceptionDetected: a failed interaction that reported a specific error
	// type is evidence of a misconception on this concept.
	if !success && cmd.ErrorType != "" {
		misconception, existed := findActiveMisconception(activeMisconceptions, after.ConceptID, cmd.ErrorType)
		if !existed {
			misconception = core.Misconception{
				TenantID:    cmd.TenantID,
				ID:          ids.New(),
				LearnerID:   cmd.LearnerID,
				ConceptID:   after.ConceptID,
				Description: cmd.ErrorType,
				Severity:    clamp(1-cmd.Score, 0.10, 1),
				Status:      "ACTIVE",
				CreatedAt:   now,
			}
			misconceptionChanges = append(misconceptionChanges, misconception)
		}
		events = append(events, newEvent(cmd.TenantID, "MisconceptionDetected", "concept", after.ConceptID, now, map[string]any{
			"learner_id":       cmd.LearnerID,
			"error_type":       cmd.ErrorType,
			"misconception_id": misconception.ID,
		}))
	}
	// MisconceptionResolved: a concept that previously accumulated lapses (past
	// failures) is now answered correctly.
	resolvedMisconceptions := 0
	if success {
		for _, misconception := range activeMisconceptionsForConcept(activeMisconceptions, after.ConceptID) {
			misconception.Status = "RESOLVED"
			misconceptionChanges = append(misconceptionChanges, misconception)
			resolvedMisconceptions++
			events = append(events, newEvent(cmd.TenantID, "MisconceptionResolved", "concept", after.ConceptID, now, map[string]any{
				"learner_id":       cmd.LearnerID,
				"misconception_id": misconception.ID,
			}))
		}
	}
	if success && before.Lapses > 0 && resolvedMisconceptions == 0 {
		events = append(events, newEvent(cmd.TenantID, "MisconceptionResolved", "concept", after.ConceptID, now, map[string]any{
			"learner_id": cmd.LearnerID,
		}))
	}
	completed := activity
	completed.Status = core.ActivityCompleted
	completed.CompletedAt = &now

	delta := core.StateDelta{
		Interaction:    interaction,
		Evaluation:     evaluation,
		Before:         before,
		After:          after,
		Snapshot:       snapshot,
		Misconceptions: misconceptionChanges,
		Events:         events,
	}
	return delta, completed, nil
}

func (e *Engine) GetLearnerModel(ctx context.Context, tenantID, learnerID string) ([]core.LearnerState, error) {
	return e.store.ListLearnerState(ctx, tenantID, learnerID)
}

type conceptSelection struct {
	Concept             core.Concept
	State               core.LearnerState
	Reason              string
	ActiveMisconception bool
	Misconception       core.Misconception
}

func selectConcept(graph core.DomainGraph, states map[string]core.LearnerState, recent []core.Interaction, misconceptions []core.Misconception, now time.Time, learnerID, intent string, phase core.Phase) conceptSelection {
	concepts := append([]core.Concept(nil), graph.Concepts...)
	sort.Slice(concepts, func(i, j int) bool {
		if concepts[i].Name == concepts[j].Name {
			return concepts[i].ID < concepts[j].ID
		}
		return concepts[i].Name < concepts[j].Name
	})
	prereqs := PrerequisitesByChild(graph.Dependencies)
	if intent != "review" {
		if selected, ok := activeMisconceptionConcept(graph, concepts, states, misconceptions, prereqs, now, learnerID); ok {
			return selected
		}
	}

	if intent == "review" {
		if selected, ok := earliestDue(concepts, states, now); ok {
			selected.Reason = "review intent: earliest due review selected"
			return selected
		}
	}
	if selected, ok := earliestDue(concepts, states, now); ok {
		selected.Reason = "critical review bypass: due review selected"
		return selected
	}
	if phase == core.PhaseDiagnostic || intent == "diagnostic" {
		if selected, ok := missingEvidenceConcept(graph, concepts, states, prereqs, now, learnerID); ok {
			return selected
		}
	}

	var best conceptSelection
	bestScore := math.Inf(-1)
	recentConcepts := recentConceptWindow(recent, 3)
	for _, concept := range concepts {
		state := stateFor(graph.Domain, concept, states, now, learnerID)
		if state.Mastery >= MasteryThreshold {
			continue
		}
		if !prerequisitesSatisfied(prereqs[concept.ID], states, now) {
			continue
		}
		score := (1 - state.Mastery) * (1 + concept.Difficulty/10)
		reason := fmt.Sprintf("instruction fringe: score=%.3f mastery=%.3f", score, state.Mastery)
		if recentConcepts[concept.ID] {
			score *= 0.25
			reason = fmt.Sprintf("anti-repeat penalty: score=%.3f mastery=%.3f", score, state.Mastery)
		}
		if score > bestScore || (score == bestScore && concept.ID < best.Concept.ID) {
			bestScore = score
			best = conceptSelection{
				Concept: concept,
				State:   state,
				Reason:  reason,
			}
		}
	}
	if best.Concept.ID != "" {
		return best
	}

	if selected, ok := lowestRetention(concepts, states, now); ok {
		selected.Reason = "maintenance: lowest retention mastered concept selected"
		return selected
	}
	concept := concepts[0]
	return conceptSelection{
		Concept: concept,
		State:   stateFor(graph.Domain, concept, states, now, learnerID),
		Reason:  "fallback: first canonical concept selected",
	}
}

func missingEvidenceConcept(graph core.DomainGraph, concepts []core.Concept, states map[string]core.LearnerState, prereqs map[string][]string, now time.Time, learnerID string) (conceptSelection, bool) {
	var best conceptSelection
	bestScore := math.Inf(-1)
	for _, concept := range concepts {
		state := stateFor(graph.Domain, concept, states, now, learnerID)
		if state.Reps > 0 {
			continue
		}
		if !prerequisitesSatisfied(prereqs[concept.ID], states, now) {
			continue
		}
		score := 1 + concept.Difficulty
		if score > bestScore || (score == bestScore && concept.ID < best.Concept.ID) {
			bestScore = score
			best = conceptSelection{
				Concept: concept,
				State:   state,
				Reason:  fmt.Sprintf("diagnostic missing evidence: score=%.3f", score),
			}
		}
	}
	return best, best.Concept.ID != ""
}

func activeMisconceptionConcept(graph core.DomainGraph, concepts []core.Concept, states map[string]core.LearnerState, misconceptions []core.Misconception, prereqs map[string][]string, now time.Time, learnerID string) (conceptSelection, bool) {
	conceptByID := make(map[string]core.Concept, len(concepts))
	for _, concept := range concepts {
		conceptByID[concept.ID] = concept
	}
	var best core.Misconception
	for _, misconception := range misconceptions {
		if misconception.Status != "ACTIVE" {
			continue
		}
		concept, ok := conceptByID[misconception.ConceptID]
		if !ok {
			continue
		}
		if !prerequisitesSatisfied(prereqs[concept.ID], states, now) {
			continue
		}
		if best.ID == "" ||
			misconception.Severity > best.Severity ||
			(misconception.Severity == best.Severity && misconception.CreatedAt.Before(best.CreatedAt)) ||
			(misconception.Severity == best.Severity && misconception.CreatedAt.Equal(best.CreatedAt) && misconception.ID < best.ID) {
			best = misconception
		}
	}
	if best.ID == "" {
		return conceptSelection{}, false
	}
	concept := conceptByID[best.ConceptID]
	return conceptSelection{
		Concept:             concept,
		State:               stateFor(graph.Domain, concept, states, now, learnerID),
		Reason:              fmt.Sprintf("misconception lock: active misconception severity=%.3f", best.Severity),
		ActiveMisconception: true,
		Misconception:       best,
	}, true
}

func overloadEscapeConcept(graph core.DomainGraph, states map[string]core.LearnerState, recent []core.Interaction, now time.Time, learnerID string, failures int) conceptSelection {
	conceptByID := make(map[string]core.Concept, len(graph.Concepts))
	for _, concept := range graph.Concepts {
		conceptByID[concept.ID] = concept
	}
	ordered := append([]core.Interaction(nil), recent...)
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].CreatedAt.Equal(ordered[j].CreatedAt) {
			return ordered[i].ID < ordered[j].ID
		}
		return ordered[i].CreatedAt.After(ordered[j].CreatedAt)
	})
	for _, interaction := range ordered {
		if interaction.LearnerID != learnerID || interaction.Success {
			continue
		}
		if concept, ok := conceptByID[interaction.ConceptID]; ok {
			return conceptSelection{
				Concept: concept,
				State:   stateFor(graph.Domain, concept, states, now, learnerID),
				Reason:  fmt.Sprintf("overload escape: %d consecutive failures", failures),
			}
		}
	}
	concepts := append([]core.Concept(nil), graph.Concepts...)
	sort.Slice(concepts, func(i, j int) bool {
		if concepts[i].Name == concepts[j].Name {
			return concepts[i].ID < concepts[j].ID
		}
		return concepts[i].Name < concepts[j].Name
	})
	concept := concepts[0]
	return conceptSelection{
		Concept: concept,
		State:   stateFor(graph.Domain, concept, states, now, learnerID),
		Reason:  fmt.Sprintf("overload escape: %d consecutive failures", failures),
	}
}

func recentConceptWindow(recent []core.Interaction, limit int) map[string]bool {
	result := map[string]bool{}
	for i, interaction := range recent {
		if limit > 0 && i >= limit {
			break
		}
		result[interaction.ConceptID] = true
	}
	return result
}

func earliestDue(concepts []core.Concept, states map[string]core.LearnerState, now time.Time) (conceptSelection, bool) {
	var best conceptSelection
	var dueAt time.Time
	for _, concept := range concepts {
		state, ok := states[concept.ID]
		if !ok || state.DueAt == nil || state.CardState == core.ReviewNew {
			continue
		}
		if state.DueAt.After(now) {
			continue
		}
		if best.Concept.ID == "" || state.DueAt.Before(dueAt) || (state.DueAt.Equal(dueAt) && concept.ID < best.Concept.ID) {
			retention := Retention(state.Stability, state.DueAt, now)
			state.Retention = retention
			best = conceptSelection{Concept: concept, State: state}
			dueAt = *state.DueAt
		}
	}
	return best, best.Concept.ID != ""
}

func lowestRetention(concepts []core.Concept, states map[string]core.LearnerState, now time.Time) (conceptSelection, bool) {
	var best conceptSelection
	bestRetention := math.Inf(1)
	for _, concept := range concepts {
		state, ok := states[concept.ID]
		if !ok || state.Mastery < MasteryThreshold {
			continue
		}
		state.Retention = Retention(state.Stability, state.DueAt, now)
		if state.Retention < bestRetention || (state.Retention == bestRetention && concept.ID < best.Concept.ID) {
			bestRetention = state.Retention
			best = conceptSelection{Concept: concept, State: state}
		}
	}
	return best, best.Concept.ID != ""
}

func stateFor(domain core.Domain, concept core.Concept, states map[string]core.LearnerState, now time.Time, learnerID string) core.LearnerState {
	state, ok := states[concept.ID]
	if !ok {
		return DefaultLearnerState(domain.TenantID, learnerID, domain.ID, concept.ID, now)
	}
	state.Retention = Retention(state.Stability, state.DueAt, now)
	return state
}

func prerequisitesSatisfied(prereqs []string, states map[string]core.LearnerState, now time.Time) bool {
	for _, prereq := range prereqs {
		state, ok := states[prereq]
		if !ok {
			return false
		}
		state.Retention = Retention(state.Stability, state.DueAt, now)
		if state.Mastery < PrerequisiteThreshold {
			return false
		}
	}
	return true
}

func evaluatePhase(concepts []core.Concept, states map[string]core.LearnerState, now time.Time) core.Phase {
	if len(concepts) == 0 {
		return core.PhaseInstruction
	}
	mastered := 0
	for _, concept := range concepts {
		state, ok := states[concept.ID]
		if !ok {
			return core.PhaseDiagnostic
		}
		if state.Reps == 0 {
			return core.PhaseDiagnostic
		}
		state.Retention = Retention(state.Stability, state.DueAt, now)
		if state.Mastery >= MasteryThreshold {
			mastered++
		}
		if state.Mastery >= MasteryThreshold && state.Retention < RetentionReviewThreshold {
			return core.PhaseMaintenance
		}
	}
	if mastered == len(concepts) {
		return core.PhaseMaintenance
	}
	return core.PhaseInstruction
}

func selectActivity(state core.LearnerState, reason, intent string, phase core.Phase, activeMisconception bool) core.ActivityType {
	if intent == "assessment" {
		return core.ActivityAssessment
	}
	if activeMisconception {
		return core.ActivityMisconception
	}
	if phase == core.PhaseDiagnostic || intent == "diagnostic" {
		return core.ActivityAssessment
	}
	if intent == "review" || reason == "critical review bypass: due review selected" || state.Retention < RetentionReviewThreshold && state.CardState != core.ReviewNew {
		return core.ActivityReview
	}
	switch {
	case state.Mastery < 0.30:
		return core.ActivityExplanation
	case state.Mastery < 0.70:
		return core.ActivityGuidedPractice
	case state.Mastery < MasteryThreshold:
		return core.ActivityFreePractice
	case state.Mastery >= 0.95 && state.Retention >= 0.85:
		return core.ActivityTransfer
	default:
		return core.ActivityAssessment
	}
}

func findActiveMisconception(misconceptions []core.Misconception, conceptID, description string) (core.Misconception, bool) {
	for _, misconception := range misconceptions {
		if misconception.Status == "ACTIVE" && misconception.ConceptID == conceptID && misconception.Description == description {
			return misconception, true
		}
	}
	return core.Misconception{}, false
}

func activeMisconceptionsForConcept(misconceptions []core.Misconception, conceptID string) []core.Misconception {
	var result []core.Misconception
	for _, misconception := range misconceptions {
		if misconception.Status == "ACTIVE" && misconception.ConceptID == conceptID {
			result = append(result, misconception)
		}
	}
	return result
}

func allowedVariants(activityType core.ActivityType) []string {
	switch activityType {
	case core.ActivityExplanation:
		return []string{"brief_explanation", "worked_example", "socratic_probe"}
	case core.ActivityGuidedPractice:
		return []string{"scaffolded_exercise", "hinted_problem", "debugging_case"}
	case core.ActivityFreePractice:
		return []string{"zpd_practice", "challenge_problem", "reflection_prompt"}
	case core.ActivityReview:
		return []string{"retrieval_practice", "spaced_recall", "error_correction"}
	case core.ActivityAssessment:
		return []string{"mastery_challenge", "feynman_prompt", "transfer_probe"}
	case core.ActivityMisconception:
		return []string{"error_diagnosis", "counterexample", "repair_exercise"}
	case core.ActivityTransfer:
		return []string{"transfer_probe", "novel_context", "feynman_teach_back"}
	case core.ActivityRest:
		return []string{"recovery_prompt", "metacognitive_check", "reduced_load_review"}
	default:
		return []string{"runtime_instruction"}
	}
}

func newEvent(tenantID, eventType, aggregateType, aggregateID string, now time.Time, payload map[string]any) core.Event {
	eventID := ids.New()
	actorUserID := ""
	if value, ok := payload["actor_user_id"].(string); ok {
		actorUserID = value
	}
	return core.Event{
		TenantID:      tenantID,
		ID:            eventID,
		SchemaVersion: 1,
		ActorUserID:   actorUserID,
		CorrelationID: eventID,
		EventType:     eventType,
		AggregateType: aggregateType,
		AggregateID:   aggregateID,
		Payload:       payload,
		OccurredAt:    now,
	}
}
