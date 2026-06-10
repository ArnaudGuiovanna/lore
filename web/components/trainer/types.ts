// Shared view-model types for the trainer surface. Server + client safe (types only).
import type { Alert, LearnerState, PedagogicalSnapshot } from "@/lib/types";

// Backend analytics/cohorts/{id} shape (flat object).
export interface CohortAnalytics {
  tenant_id: string;
  cohort_id: string;
  learner_count: number;
  state_count: number;
  average_mastery: number;
  active_misconceptions: number;
  // FOAD training time (B-07): paused intervals excluded, per-activity capped.
  training_time_seconds?: number;
  training_hours?: number;
  learner_time?: TrainingTimeSummary[];
  [k: string]: unknown;
}

// Per-learner training time as aggregated by the backend (B-07).
export interface TrainingTimeSummary {
  tenant_id: string;
  program_id: string;
  cohort_id: string;
  learner_id: string;
  activity_count: number;
  training_time_seconds: number;
  training_hours: number;
}

// One learner's rolled-up runtime signal for the cohort roster + inspection.
export interface LearnerRow {
  id: string;
  name: string;
  tracked: number;
  avgMastery: number | null;
  avgRetention: number | null;
  relearning: number;
  due: number;
  openAlerts: number;
  // The runtime's own open alerts for this learner (drives the sanctioned-action picker).
  alerts: Alert[];
  // Does the runtime track an ACTIVE misconception? (gates "assign repair").
  hasMisconception: boolean;
  states: LearnerState[];
  snapshots: PedagogicalSnapshot[];
}

// A syllabus version as the trainer surface models it (append-only product concept).
export interface SeedSyllabus {
  id: string;
  title: string;
  description: string;
  objectives: string[]; // concept ids drawn from the domain DAG
  outcomes: string[];
  version: number;
  bound: boolean;
  createdAt?: string;
}
