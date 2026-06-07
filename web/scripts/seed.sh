#!/usr/bin/env bash
# Seeds the LORE backend (JWT mode) with real users, memberships (roles), and the
# LECTURE fixtures. Writes non-secret ids to web/.gen/seed.json. The Next app mints
# per-user LORE tokens via the bootstrap secret at login.
# Requires: LORE_BOOTSTRAP_TOKEN (must match the backend's). Re-runnable.
set -euo pipefail
BASE="${LORE_BASE:-http://127.0.0.1:8080}"
BOOT="${LORE_BOOTSTRAP_TOKEN:-boot-dev-secret}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/.gen/seed.json"
R=$RANDOM
j() { jq -r "$1"; }
# bootstrap-authenticated calls (bootstrap bypasses all auth on the backend)
bpost() { curl -s "$BASE$1" -H "X-LORE-Bootstrap-Token: $BOOT" -H 'Content-Type: application/json' -d "$2"; }
bput()  { curl -s -X PUT "$BASE$1" -H "X-LORE-Bootstrap-Token: $BOOT" -H 'Content-Type: application/json' -d "$2"; }

echo "→ tenant"
TENANT_ID=$(curl -s "$BASE/v1/tenants" -H 'Content-Type: application/json' -d '{"name":"Acme Learning","slug":"acme-'"$R"'"}' | j .id)
T="/v1/tenants/$TENANT_ID"

echo "→ program + cohort"
PROGRAM_ID=$(bpost "$T/programs" '{"name":"Backend Engineering 2026"}' | j .id)
COHORT_ID=$(bpost "$T/cohorts" '{"program_id":"'"$PROGRAM_ID"'","name":"Go-Spring-24"}' | j .id)

# create a user + membership(role); echoes the user id
make_user() { # email name role
  local EMAIL="$1" NAME="$2" ROLE="$3" USERID
  USERID=$(curl -s "$BASE/v1/users" -H 'Content-Type: application/json' -d '{"email":"'"$EMAIL"'","name":"'"$NAME"'"}' | j .id)
  bpost "$T/memberships" '{"user_id":"'"$USERID"'","role":"'"$ROLE"'"}' >/dev/null
  echo "$USERID"
}

echo "→ users + memberships (roles)"
ADMIN_ID=$(make_user "admin@acme-$R.test" "S. Aalto" "TENANT_ADMIN")
TRAINER_ID=$(make_user "kohler@acme-$R.test" "R. Köhler" "TRAINER")
L1=$(make_user "amara@acme-$R.test" "Amara Okafor" "LEARNER")
L2=$(make_user "diego@acme-$R.test" "Diego Santos" "LEARNER")
L3=$(make_user "liam@acme-$R.test" "Liam Chen" "LEARNER")
L4=$(make_user "noor@acme-$R.test" "Noor Haddad" "LEARNER")

echo "→ LLM config (instruction_only — runs without an LLM)"
bput "$T/llm-configurations" '{"provider":"instruction_only","model":"tenant-runtime","temperature":0.2,"max_tokens":512}' >/dev/null
bput "$T/llm-configurations?scope_type=learner&scope_id=$L1" '{"provider":"instruction_only","model":"learner-runtime"}' >/dev/null

echo "→ domain Go Backend (concept DAG)"
DOMAIN_ID=$(bpost "$T/domains" '{
  "owner_id":"'"$TRAINER_ID"'","name":"Go Backend","source":"TRAINER",
  "concepts":[
    {"id":"http-handlers","name":"HTTP handlers","difficulty":0.4},
    {"id":"persistence","name":"Persistence","difficulty":0.7},
    {"id":"transactions","name":"Transactions","difficulty":0.8},
    {"id":"middleware","name":"Middleware","difficulty":0.5},
    {"id":"auth-jwt","name":"Auth (JWT)","difficulty":0.6},
    {"id":"migrations","name":"Migrations","difficulty":0.55},
    {"id":"concurrency","name":"Concurrency","difficulty":0.75},
    {"id":"channels","name":"Channels","difficulty":0.7}
  ],
  "dependencies":[
    {"parent_concept_id":"http-handlers","child_concept_id":"persistence"},
    {"parent_concept_id":"persistence","child_concept_id":"transactions"},
    {"parent_concept_id":"http-handlers","child_concept_id":"middleware"},
    {"parent_concept_id":"middleware","child_concept_id":"auth-jwt"},
    {"parent_concept_id":"persistence","child_concept_id":"migrations"},
    {"parent_concept_id":"concurrency","child_concept_id":"channels"}
  ]
}' | j '.domain.id // .id')

echo "→ syllabus + binding to cohort"
SYLLABUS_ID=$(bpost "$T/syllabi" '{
  "title":"Production-grade Go persistence",
  "description":"From HTTP handlers to correct transactional persistence.",
  "objectives":{"concepts":["http-handlers","persistence","transactions","auth-jwt"]},
  "outcomes":{"statements":["writes a handler that persists in a transaction and rolls back on error","reasons about retention of prerequisite concepts"]}
}' | j .id)
bpost "$T/syllabi/$SYLLABUS_ID/bindings" '{"target_type":"COHORT","target_id":"'"$COHORT_ID"'","adaptation_mode":"GUIDED"}' >/dev/null

# enroll learner (user_id is the learner id) + plan an activity + record evidence
seed_learner() { # learnerId score success errorType
  local LID="$1" SCORE="$2" SUCCESS="$3" ERR="$4" ACT
  bpost "$T/cohorts/$COHORT_ID/enrollments" '{"learner_id":"'"$LID"'"}' >/dev/null || true
  ACT=$(bpost "$T/learners/$LID/activities/next" '{"domain_id":"'"$DOMAIN_ID"'"}' | j '.activity.id // .id // empty')
  if [ -n "$ACT" ] && [ "$ACT" != "null" ]; then
    local body='{"learner_id":"'"$LID"'","activity_id":"'"$ACT"'","success":'"$SUCCESS"',"score":'"$SCORE"'}'
    [ -n "$ERR" ] && body='{"learner_id":"'"$LID"'","activity_id":"'"$ACT"'","success":'"$SUCCESS"',"score":'"$SCORE"',"error_type":"'"$ERR"'"}'
    bpost "$T/interactions" "$body" >/dev/null
  fi
}
echo "→ enrollments + runtime state"
seed_learner "$L1" 0.41 false forgot-tx-rollback
seed_learner "$L2" 0.29 false ""
seed_learner "$L3" 0.58 true  ""
seed_learner "$L4" 0.88 true  ""

mkdir -p "$(dirname "$OUT")"
cat > "$OUT" <<JSON
{
  "base": "$BASE",
  "tenantId": "$TENANT_ID",
  "tenantSlug": "acme",
  "tenantName": "Acme Learning",
  "programId": "$PROGRAM_ID",
  "cohortId": "$COHORT_ID",
  "cohortName": "Go-Spring-24",
  "domainId": "$DOMAIN_ID",
  "syllabusId": "$SYLLABUS_ID",
  "users": [
    {"id": "$ADMIN_ID", "email": "admin@acme-$R.test", "name": "S. Aalto", "role": "TENANT_ADMIN"},
    {"id": "$TRAINER_ID", "email": "kohler@acme-$R.test", "name": "R. Köhler", "role": "TRAINER"},
    {"id": "$L1", "email": "amara@acme-$R.test", "name": "Amara Okafor", "role": "LEARNER"},
    {"id": "$L2", "email": "diego@acme-$R.test", "name": "Diego Santos", "role": "LEARNER"},
    {"id": "$L3", "email": "liam@acme-$R.test", "name": "Liam Chen", "role": "LEARNER"},
    {"id": "$L4", "email": "noor@acme-$R.test", "name": "Noor Haddad", "role": "LEARNER"}
  ],
  "learners": [
    {"id": "$L1", "name": "Amara Okafor"},
    {"id": "$L2", "name": "Diego Santos"},
    {"id": "$L3", "name": "Liam Chen"},
    {"id": "$L4", "name": "Noor Haddad"}
  ]
}
JSON
echo "✓ seeded (JWT mode) → $OUT"
