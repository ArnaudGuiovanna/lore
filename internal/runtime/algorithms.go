package runtime

import (
	"math"
	"time"

	"lore/internal/core"
)

const (
	MasteryThreshold         = 0.85
	PrerequisiteThreshold    = 0.70
	RetentionReviewThreshold = 0.72
	defaultPLearn            = 0.18
	defaultPForget           = 0.02
	defaultPSlip             = 0.10
	defaultPGuess            = 0.20
)

func Clamp01(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func clamp(v, min, max float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return min
	}
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func DefaultLearnerState(tenantID, learnerID, domainID, conceptID string, now time.Time) core.LearnerState {
	return core.LearnerState{
		TenantID:   tenantID,
		LearnerID:  learnerID,
		DomainID:   domainID,
		ConceptID:  conceptID,
		Mastery:    0.05,
		Retention:  0,
		Confidence: 0.25,
		Ability:    0,
		PLearn:     defaultPLearn,
		PForget:    defaultPForget,
		PSlip:      defaultPSlip,
		PGuess:     defaultPGuess,
		Stability:  0,
		Difficulty: 5,
		CardState:  core.ReviewNew,
		UpdatedAt:  now,
	}
}

func BKTUpdate(state core.LearnerState, correct bool) core.LearnerState {
	pMastery := Clamp01(state.Mastery)
	pLearn := clamp(state.PLearn, 0, 1)
	pForget := clamp(state.PForget, 0, 1)
	pSlip := clamp(state.PSlip, 0, 0.5)
	pGuess := clamp(state.PGuess, 0, 0.5)

	var posterior float64
	if correct {
		pCorrectMastery := 1 - pSlip
		pCorrectNotMastery := pGuess
		denom := pCorrectMastery*pMastery + pCorrectNotMastery*(1-pMastery)
		if denom <= 1e-9 {
			denom = 1e-9
		}
		posterior = pCorrectMastery * pMastery / denom
	} else {
		pIncorrectMastery := pSlip
		pIncorrectNotMastery := 1 - pGuess
		denom := pIncorrectMastery*pMastery + pIncorrectNotMastery*(1-pMastery)
		if denom <= 1e-9 {
			denom = 1e-9
		}
		posterior = pIncorrectMastery * pMastery / denom
	}

	state.Mastery = Clamp01(posterior*(1-pForget) + (1-posterior)*pLearn)
	state.PLearn = pLearn
	state.PForget = pForget
	state.PSlip = pSlip
	state.PGuess = pGuess
	return state
}

func Retention(stability float64, dueAt *time.Time, now time.Time) float64 {
	if stability <= 0 {
		return 0
	}
	if dueAt == nil {
		return 1
	}
	daysOverdue := now.Sub(*dueAt).Hours() / 24
	if daysOverdue <= 0 {
		return 1
	}
	return Clamp01(math.Exp(-daysOverdue / math.Max(stability, 0.25)))
}

func ApplyReviewSchedule(state core.LearnerState, success bool, score float64, now time.Time) core.LearnerState {
	score = Clamp01(score)
	state.Reps++
	state.LastInteractionAt = &now
	state.UpdatedAt = now

	switch {
	case !success || score < 0.40:
		state.Lapses++
		state.CardState = core.ReviewRelearning
		state.Stability = math.Max(0.25, state.Stability*0.55)
		state.Difficulty = clamp(state.Difficulty+0.65, 1, 10)
		state.Retention = 0.25
		state.DueAt = &now
	case score < 0.70:
		state.CardState = core.ReviewLearning
		state.Stability = math.Max(0.75, state.Stability*1.10+0.50)
		state.Difficulty = clamp(state.Difficulty+0.20, 1, 10)
		due := now.Add(24 * time.Hour)
		state.DueAt = &due
		state.Retention = Retention(state.Stability, state.DueAt, now)
	case score < 0.90:
		state.CardState = core.ReviewReview
		state.Stability = math.Max(1.25, state.Stability*1.55+1.00)
		state.Difficulty = clamp(state.Difficulty-0.10, 1, 10)
		days := int(math.Round(math.Max(2, state.Stability*1.5)))
		due := now.Add(time.Duration(days) * 24 * time.Hour)
		state.DueAt = &due
		state.Retention = Retention(state.Stability, state.DueAt, now)
	default:
		state.CardState = core.ReviewReview
		state.Stability = math.Max(2.50, state.Stability*2.00+2.00)
		state.Difficulty = clamp(state.Difficulty-0.25, 1, 10)
		days := int(math.Round(math.Max(4, state.Stability*2)))
		due := now.Add(time.Duration(days) * 24 * time.Hour)
		state.DueAt = &due
		state.Retention = Retention(state.Stability, state.DueAt, now)
	}

	state.Confidence = Clamp01(0.30 + state.Mastery*0.45 + float64(state.Reps)*0.03)
	state.Ability = clamp(state.Ability+(score-0.60)*0.35, -3, 3)
	return state
}
