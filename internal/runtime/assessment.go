package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"lore/internal/core"
)

const assessmentKindCorrectedMinimal = "corrected_minimal"

type assessmentScore struct {
	Score       float64
	Items       []core.AssessmentItem
	Corrections []core.AssessmentCorrection
}

func (e *Engine) SubmitAssessment(ctx context.Context, cmd core.AssessmentSubmissionCommand) (core.StateDelta, error) {
	delta, completed, err := e.PrepareAssessmentSubmissionDelta(ctx, cmd)
	if err != nil {
		return core.StateDelta{}, err
	}
	if err := e.store.SaveInteractionDelta(ctx, delta, completed); err != nil {
		return core.StateDelta{}, err
	}
	return delta, nil
}

func (e *Engine) PrepareAssessmentSubmissionDelta(ctx context.Context, cmd core.AssessmentSubmissionCommand) (core.StateDelta, core.Activity, error) {
	if cmd.TenantID == "" || cmd.LearnerID == "" || cmd.ActivityID == "" {
		return core.StateDelta{}, core.Activity{}, fmt.Errorf("%w: tenant_id, learner_id and activity_id are required", core.ErrInvalidInput)
	}
	if len(cmd.Answers) == 0 {
		return core.StateDelta{}, core.Activity{}, fmt.Errorf("%w: corrected assessment answers are required", core.ErrInvalidInput)
	}
	if err := validateOptionalProbability("score", cmd.SelfReportedScore); err != nil {
		return core.StateDelta{}, core.Activity{}, err
	}
	if err := validateOptionalProbability("confidence", cmd.Confidence); err != nil {
		return core.StateDelta{}, core.Activity{}, err
	}
	activity, instruction, err := e.store.GetActivity(ctx, cmd.TenantID, cmd.ActivityID)
	if err != nil {
		return core.StateDelta{}, core.Activity{}, err
	}
	if activity.LearnerID != cmd.LearnerID {
		return core.StateDelta{}, core.Activity{}, fmt.Errorf("%w: activity learner does not match command learner", core.ErrTenantMismatch)
	}
	if activity.ActivityType != core.ActivityAssessment {
		return core.StateDelta{}, core.Activity{}, fmt.Errorf("%w: activity is not an assessment", core.ErrInvalidInput)
	}

	result, err := e.scoreAssessment(ctx, activity, instruction, cmd)
	if err != nil {
		return core.StateDelta{}, core.Activity{}, err
	}
	payload := copyMap(cmd.Payload)
	payload["evidence_type"] = "corrected_assessment"
	payload["score_source"] = "runtime_correction"
	payload["assessment_kind"] = assessmentKind(instruction)
	payload["answers"] = cmd.Answers
	payload["runtime_score"] = result.Score
	if cmd.SelfReportedSuccess != nil {
		payload["self_reported_success"] = *cmd.SelfReportedSuccess
	}
	if cmd.SelfReportedScore != nil {
		payload["self_reported_score"] = *cmd.SelfReportedScore
	}
	if cmd.Confidence != nil {
		payload["confidence"] = *cmd.Confidence
	}

	delta, completed, err := e.PrepareInteractionDelta(ctx, core.InteractionCommand{
		TenantID:   cmd.TenantID,
		LearnerID:  cmd.LearnerID,
		ActivityID: cmd.ActivityID,
		Success:    result.Score >= 0.60,
		Score:      result.Score,
		Feedback:   cmd.Feedback,
		Payload:    payload,
	})
	if err != nil {
		return core.StateDelta{}, core.Activity{}, err
	}
	enrichAssessmentEvidence(&delta, result, cmd, assessmentKind(instruction))
	return delta, completed, nil
}

func (e *Engine) scoreAssessment(ctx context.Context, activity core.Activity, instruction core.TutorInstruction, cmd core.AssessmentSubmissionCommand) (assessmentScore, error) {
	graph, err := e.store.GetDomainGraph(ctx, activity.TenantID, activity.DomainID)
	if err != nil {
		return assessmentScore{}, err
	}
	concept, ok := findConcept(graph, activity.ConceptID)
	if !ok {
		return assessmentScore{}, fmt.Errorf("%w: assessment concept", core.ErrNotFound)
	}
	items := assessmentItemsFromContext(instruction.Context)
	if len(items) == 0 {
		items = assessmentItemsFor(concept, graph)
	}
	itemByID := make(map[string]core.AssessmentItem, len(items))
	for _, item := range items {
		itemByID[item.ID] = item
	}
	answerByItem := make(map[string]core.AssessmentAnswer, len(cmd.Answers))
	for _, answer := range cmd.Answers {
		answer.ItemID = strings.TrimSpace(answer.ItemID)
		if answer.ItemID == "" {
			return assessmentScore{}, fmt.Errorf("%w: answer item_id is required", core.ErrInvalidInput)
		}
		if _, ok := itemByID[answer.ItemID]; !ok {
			return assessmentScore{}, fmt.Errorf("%w: unknown assessment item %q", core.ErrInvalidInput, answer.ItemID)
		}
		if _, exists := answerByItem[answer.ItemID]; exists {
			return assessmentScore{}, fmt.Errorf("%w: duplicate assessment answer %q", core.ErrInvalidInput, answer.ItemID)
		}
		answerByItem[answer.ItemID] = answer
	}

	var awarded, possible float64
	corrections := make([]core.AssessmentCorrection, 0, len(items))
	for _, item := range items {
		points := item.Points
		if points <= 0 {
			points = 1
		}
		expected := firstNonEmpty(item.ConceptID, activity.ConceptID)
		answer := answerByItem[item.ID]
		givenChoice := strings.TrimSpace(answer.ChoiceID)
		givenAnswer := strings.TrimSpace(answer.Answer)
		correct := normalizeAssessmentAnswer(givenChoice) == normalizeAssessmentAnswer(expected)
		if !correct && givenAnswer != "" {
			correct = normalizeAssessmentAnswer(givenAnswer) == normalizeAssessmentAnswer(concept.Name) ||
				normalizeAssessmentAnswer(givenAnswer) == normalizeAssessmentAnswer(expected)
		}
		pointsAwarded := 0.0
		if correct {
			pointsAwarded = points
		}
		awarded += pointsAwarded
		possible += points
		corrections = append(corrections, core.AssessmentCorrection{
			ItemID:           item.ID,
			ExpectedChoiceID: expected,
			GivenChoiceID:    givenChoice,
			GivenAnswer:      givenAnswer,
			Correct:          correct,
			PointsAwarded:    pointsAwarded,
			PointsPossible:   points,
		})
	}
	score := 0.0
	if possible > 0 {
		score = Clamp01(awarded / possible)
	}
	return assessmentScore{Score: score, Items: items, Corrections: corrections}, nil
}

func assessmentItemsFor(concept core.Concept, graph core.DomainGraph) []core.AssessmentItem {
	choices := []core.AssessmentChoice{{ID: concept.ID, Label: concept.Name}}
	decoys := append([]core.Concept(nil), graph.Concepts...)
	sort.Slice(decoys, func(i, j int) bool {
		if decoys[i].Name == decoys[j].Name {
			return decoys[i].ID < decoys[j].ID
		}
		return decoys[i].Name < decoys[j].Name
	})
	for _, candidate := range decoys {
		if candidate.ID == concept.ID {
			continue
		}
		choices = append(choices, core.AssessmentChoice{ID: candidate.ID, Label: candidate.Name})
		if len(choices) >= 3 {
			break
		}
	}
	choices = append(choices, core.AssessmentChoice{ID: "not_sure", Label: "I am not sure yet"})
	sort.Slice(choices, func(i, j int) bool {
		if choices[i].Label == choices[j].Label {
			return choices[i].ID < choices[j].ID
		}
		return choices[i].Label < choices[j].Label
	})
	return []core.AssessmentItem{{
		ID:        "concept-check",
		Kind:      "single_choice",
		ConceptID: concept.ID,
		Prompt:    "Select the concept demonstrated by this assessment item.",
		Choices:   choices,
		Points:    1,
	}}
}

func assessmentItemsFromContext(context map[string]any) []core.AssessmentItem {
	raw, ok := context["assessment_items"]
	if !ok {
		return nil
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	var items []core.AssessmentItem
	if err := json.Unmarshal(data, &items); err != nil {
		return nil
	}
	return items
}

func enrichAssessmentEvidence(delta *core.StateDelta, result assessmentScore, cmd core.AssessmentSubmissionCommand, kind string) {
	if delta.Evaluation.Rubric == nil {
		delta.Evaluation.Rubric = map[string]any{}
	}
	delta.Evaluation.Rubric["assessment_kind"] = kind
	delta.Evaluation.Rubric["evidence_type"] = "corrected_assessment"
	delta.Evaluation.Rubric["score_source"] = "runtime_correction"
	delta.Evaluation.Rubric["items"] = result.Items
	delta.Evaluation.Rubric["answers"] = cmd.Answers
	delta.Evaluation.Rubric["correction"] = result.Corrections
	if cmd.SelfReportedSuccess != nil {
		delta.Evaluation.Rubric["self_reported_success"] = *cmd.SelfReportedSuccess
	}
	if cmd.SelfReportedScore != nil {
		delta.Evaluation.Rubric["self_reported_score"] = *cmd.SelfReportedScore
	}
	if cmd.Confidence != nil {
		delta.Evaluation.Rubric["confidence"] = *cmd.Confidence
	}
	if delta.Snapshot.Observation == nil {
		delta.Snapshot.Observation = map[string]any{}
	}
	delta.Snapshot.Observation["evidence_type"] = "corrected_assessment"
	delta.Snapshot.Observation["score_source"] = "runtime_correction"
	delta.Snapshot.Observation["corrected_score"] = result.Score
	for i := range delta.Events {
		if delta.Events[i].EventType != "AssessmentCompleted" {
			continue
		}
		if delta.Events[i].Payload == nil {
			delta.Events[i].Payload = map[string]any{}
		}
		delta.Events[i].Payload["evidence_type"] = "corrected_assessment"
		delta.Events[i].Payload["score_source"] = "runtime_correction"
		delta.Events[i].Payload["corrected"] = true
	}
}

func assessmentKind(instruction core.TutorInstruction) string {
	if kind, ok := instruction.Context["assessment_kind"].(string); ok && strings.TrimSpace(kind) != "" {
		return kind
	}
	return assessmentKindCorrectedMinimal
}

func findConcept(graph core.DomainGraph, conceptID string) (core.Concept, bool) {
	for _, concept := range graph.Concepts {
		if concept.ID == conceptID {
			return concept, true
		}
	}
	return core.Concept{}, false
}

func validateOptionalProbability(name string, value *float64) error {
	if value == nil {
		return nil
	}
	if *value < 0 || *value > 1 {
		return fmt.Errorf("%w: %s must be in [0,1]", core.ErrInvalidInput, name)
	}
	return nil
}

func copyMap(in map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range in {
		out[key] = value
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func normalizeAssessmentAnswer(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
