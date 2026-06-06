package runtime

import (
	"sort"
	"time"

	"lore/internal/core"
	"lore/internal/ids"
)

func ComputeAlerts(states []core.LearnerState, recent []core.Interaction, now time.Time) []core.Alert {
	var alerts []core.Alert
	for _, state := range states {
		retention := Retention(state.Stability, state.DueAt, now)
		if state.DueAt != nil && !state.DueAt.After(now) && state.CardState != core.ReviewNew {
			alerts = append(alerts, core.Alert{
				TenantID:          state.TenantID,
				ID:                ids.New(),
				LearnerID:         state.LearnerID,
				ConceptID:         state.ConceptID,
				AlertType:         "ReviewDue",
				Severity:          "warning",
				Status:            "OPEN",
				Payload:           map[string]any{"due_at": state.DueAt, "retention": retention},
				RecommendedAction: "schedule immediate review",
				CreatedAt:         now,
				UpdatedAt:         now,
			})
			continue
		}
		if state.CardState != core.ReviewNew && retention < RetentionReviewThreshold {
			alerts = append(alerts, core.Alert{
				TenantID:          state.TenantID,
				ID:                ids.New(),
				LearnerID:         state.LearnerID,
				ConceptID:         state.ConceptID,
				AlertType:         "LowRetention",
				Severity:          "warning",
				Status:            "OPEN",
				Payload:           map[string]any{"retention": retention},
				RecommendedAction: "prefer retrieval practice before new content",
				CreatedAt:         now,
				UpdatedAt:         now,
			})
		}
		if state.Mastery >= MasteryThreshold {
			alerts = append(alerts, core.Alert{
				TenantID:          state.TenantID,
				ID:                ids.New(),
				LearnerID:         state.LearnerID,
				ConceptID:         state.ConceptID,
				AlertType:         "ConceptMastered",
				Severity:          "info",
				Status:            "OPEN",
				Payload:           map[string]any{"mastery": state.Mastery},
				RecommendedAction: "plan mastery assessment or transfer probe",
				CreatedAt:         now,
				UpdatedAt:         now,
			})
		}
		if state.Reps >= 4 && state.Mastery < 0.55 {
			alerts = append(alerts, core.Alert{
				TenantID:          state.TenantID,
				ID:                ids.New(),
				LearnerID:         state.LearnerID,
				ConceptID:         state.ConceptID,
				AlertType:         "Plateau",
				Severity:          "warning",
				Status:            "OPEN",
				Payload:           map[string]any{"mastery": state.Mastery, "reps": state.Reps},
				RecommendedAction: "switch strategy and inspect learner evidence before adding new practice",
				CreatedAt:         now,
				UpdatedAt:         now,
			})
		}
		if state.Reps >= 2 && ((state.Ability <= -0.75 && state.Difficulty >= 7) || (state.Ability >= 0.75 && state.Difficulty <= 3)) {
			alerts = append(alerts, core.Alert{
				TenantID:          state.TenantID,
				ID:                ids.New(),
				LearnerID:         state.LearnerID,
				ConceptID:         state.ConceptID,
				AlertType:         "ZPDDrift",
				Severity:          "warning",
				Status:            "OPEN",
				Payload:           map[string]any{"ability": state.Ability, "difficulty": state.Difficulty},
				RecommendedAction: "retune activity difficulty toward the learner's current zone",
				CreatedAt:         now,
				UpdatedAt:         now,
			})
		}
	}

	failuresByLearner := map[string]int{}
	for _, interaction := range recent {
		if !interaction.Success {
			failuresByLearner[interaction.LearnerID]++
		}
	}
	for learnerID, failures := range failuresByLearner {
		if failures >= 3 {
			tenantID := ""
			for _, interaction := range recent {
				if interaction.LearnerID == learnerID {
					tenantID = interaction.TenantID
					break
				}
			}
			alerts = append(alerts, core.Alert{
				TenantID:          tenantID,
				ID:                ids.New(),
				LearnerID:         learnerID,
				AlertType:         "LearnerAtRisk",
				Severity:          "critical",
				Status:            "OPEN",
				Payload:           map[string]any{"recent_failures": failures},
				RecommendedAction: "reduce difficulty and inspect misconceptions",
				CreatedAt:         now,
				UpdatedAt:         now,
			})
		}
	}
	for learnerID, failures := range consecutiveFailuresByLearner(recent) {
		if failures < 3 {
			continue
		}
		tenantID := ""
		for _, interaction := range recent {
			if interaction.LearnerID == learnerID {
				tenantID = interaction.TenantID
				break
			}
		}
		alerts = append(alerts, core.Alert{
			TenantID:          tenantID,
			ID:                ids.New(),
			LearnerID:         learnerID,
			AlertType:         "Overload",
			Severity:          "critical",
			Status:            "OPEN",
			Payload:           map[string]any{"consecutive_failures": failures},
			RecommendedAction: "pause new content and plan a recovery activity",
			CreatedAt:         now,
			UpdatedAt:         now,
		})
	}
	return alerts
}

func consecutiveFailuresByLearner(recent []core.Interaction) map[string]int {
	ordered := append([]core.Interaction(nil), recent...)
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].CreatedAt.Equal(ordered[j].CreatedAt) {
			return ordered[i].ID < ordered[j].ID
		}
		return ordered[i].CreatedAt.After(ordered[j].CreatedAt)
	})
	failures := map[string]int{}
	seenSuccess := map[string]bool{}
	for _, interaction := range ordered {
		if seenSuccess[interaction.LearnerID] {
			continue
		}
		if interaction.Success {
			seenSuccess[interaction.LearnerID] = true
			continue
		}
		failures[interaction.LearnerID]++
	}
	return failures
}
