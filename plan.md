# LORE

## Learning Orchestration Runtime Engine

### Multi-Tenant Learning Operating System

Version 1.2

---

# Vision

LORE est un Learning Operating System.

Contrairement aux LMS traditionnels, LORE ne gère pas principalement des contenus pédagogiques.

LORE orchestre l'apprentissage.

Le système pilote :

* les domaines d'apprentissage
* les graphes de concepts
* les cohortes
* les apprenants
* les révisions
* les évaluations
* les recommandations pédagogiques

Le contenu pédagogique est généré dynamiquement à partir d'instructions produites par le Runtime Pédagogique.

Le Runtime est la source de vérité.

Le LLM est un moteur de génération interchangeable.

---

# Positionnement

## LMS Classique

```txt
Cours
→ Modules
→ Leçons
→ Quiz
→ Certification
```

Le contenu est central.

---

## LORE

```txt
Objectif
→ Domaine
→ Graphe de concepts
→ Runtime pédagogique
→ Activités générées
→ Maîtrise
```

L'apprentissage est central.

---

# Principes Fondateurs

## Runtime First

Le Runtime décide :

* quoi apprendre
* quand apprendre
* comment apprendre
* quand réviser
* quand évaluer

Le LLM n'est jamais décisionnaire.

---

## Multi-Tenant Native

Toutes les entités métier appartiennent à un tenant.

Aucune donnée métier ne peut exister sans :

```go
TenantID uuid.UUID
```

---

## Headless First

Interfaces :

```txt
REST
gRPC
Events
```

Aucune interface utilisateur imposée.

---

## Local First

LORE doit fonctionner immédiatement après installation.

Aucune dépendance cloud obligatoire.

---

## LLM Agnostic

Le Runtime ne dépend d'aucun fournisseur.

Support natif :

```txt
Ollama
OpenAI
Anthropic
Gemini
Mistral
Custom
```

---

# Architecture

```txt
Platform

├── Tenant
├── Identity
├── Learning
├── Runtime
├── Analytics
├── Notification
└── LLM Gateway
```

Mode de déploiement :

```txt
Modular Monolith
```

---

# Stack Technique

Langage :

```txt
Go 1.25+
```

Base :

```txt
PostgreSQL
```

Cache :

```txt
Redis
```

Messaging :

```txt
NATS JetStream
```

Observabilité :

```txt
OpenTelemetry
Prometheus
Grafana
Loki
```

Authentification :

```txt
OIDC
OAuth2
JWT
```

Persistence :

```txt
SQLC
```

---

# Pourquoi pas S3

LORE ne stocke pas :

```txt
SCORM
Vidéos
Audio
Bibliothèques PDF
```

LORE stocke :

```txt
Graphes de concepts
Learner Models
Interactions
Tutor Instructions
Generated Content
Évaluations
Traces pédagogiques
Événements
```

Toutes ces données sont textuelles ou structurées.

PostgreSQL suffit pour V1.

---

# Bounded Contexts

## Tenant

Responsable :

```txt
Tenants
Sous-tenants
Plans
Facturation
```

```go
type Tenant struct {
    ID uuid.UUID
    ParentID *uuid.UUID

    Name string
    Slug string

    Status string
}
```

---

## Identity

Responsable :

```txt
Utilisateurs
Memberships
Rôles
Permissions
```

```go
type User struct {
    ID uuid.UUID

    Email string
    Name string
}
```

```go
type Membership struct {
    UserID uuid.UUID
    TenantID uuid.UUID

    Role string
}
```

Rôles :

```txt
SUPER_ADMIN
TENANT_ADMIN
TRAINER
LEARNER
```

---

## Learning

Responsable :

```txt
Programs
Cohorts
Syllabi
Domains
Concepts
Assessments
```

---

# Syllabus

Le syllabus est l'intention pédagogique.

Peut être créé par :

```txt
Formateur
Administrateur
Apprenant
IA
```

---

## Syllabus

```go
type Syllabus struct {
    ID uuid.UUID

    TenantID uuid.UUID

    Title string
    Description string

    Objectives json.RawMessage
    Outcomes json.RawMessage
}
```

---

## Syllabus Binding

Associe un syllabus à :

```txt
Programme
Cohorte
Apprenant
```

```go
type SyllabusBinding struct {
    ID uuid.UUID

    SyllabusID uuid.UUID

    TargetType string
    TargetID uuid.UUID

    AdaptationMode string
}
```

Modes :

```txt
STRICT
GUIDED
FREE
```

---

# Domaines d'Apprentissage

## Domaine Canonique

```txt
Syllabus
→ Domain
→ Concept Graph
```

---

## Domaine Personnel

Créé librement par un apprenant.

Exemples :

```txt
Apprendre Kubernetes
Apprendre Rust
Apprendre le piano
```

---

## Domain

```go
type Domain struct {
    ID uuid.UUID

    TenantID uuid.UUID

    OwnerID uuid.UUID

    Name string
    Description string

    Source string
}
```

Sources :

```txt
SYLLABUS
TRAINER
LEARNER
IMPORT
```

---

# Concept Graph

Cœur du modèle pédagogique.

```go
type Concept struct {
    ID uuid.UUID

    TenantID uuid.UUID

    DomainID uuid.UUID

    Name string
    Description string

    Difficulty float64
}
```

```go
type Dependency struct {
    ParentConceptID uuid.UUID
    ChildConceptID uuid.UUID
}
```

Contraintes :

```txt
DAG obligatoire
Cycles interdits
```

---

# Runtime

Le produit principal.

---

# Learner Model

```go
type LearnerState struct {
    TenantID uuid.UUID

    LearnerID uuid.UUID
    ConceptID uuid.UUID

    Mastery float64
    Retention float64
    Confidence float64
    Ability float64

    LastInteractionAt time.Time
}
```

---

# Misconceptions

```go
type Misconception struct {
    ID uuid.UUID

    TenantID uuid.UUID

    ConceptID uuid.UUID

    Description string

    Severity float64
}
```

---

# Review Engine

Algorithme :

```txt
FSRS
```

```go
type ReviewCard struct {
    TenantID uuid.UUID

    LearnerID uuid.UUID
    ConceptID uuid.UUID

    DueAt time.Time

    Stability float64
    Difficulty float64
}
```

---

# Learning Trace Store

Actif stratégique de LORE.

---

## Interaction

```go
type Interaction struct {
    ID uuid.UUID

    TenantID uuid.UUID

    LearnerID uuid.UUID

    ActivityID uuid.UUID

    Payload json.RawMessage

    CreatedAt time.Time
}
```

---

## Evaluation

```go
type Evaluation struct {
    ID uuid.UUID

    InteractionID uuid.UUID

    Score float64

    Feedback string
}
```

---

# Runtime Pipeline

```txt
Load Learner State

Update Mastery

Update Retention

Detect Misconceptions

Compute Reviews

Select Concept

Select Activity

Generate Tutor Instruction

Generate Content

Persist Trace

Emit Events
```

---

# Activity Types

```txt
EXPLANATION

SOCRATIC_DIALOGUE

GUIDED_PRACTICE

FREE_PRACTICE

REVIEW

ASSESSMENT

REFLECTION

TRANSFER

PROJECT

SIMULATION
```

---

# Tutor Instruction

Produit par le Runtime.

```go
type TutorInstruction struct {
    TenantID uuid.UUID

    LearnerID uuid.UUID

    ConceptID uuid.UUID

    ActivityType string

    Difficulty float64

    Constraints []string

    Context map[string]any
}
```

---

# Generated Content

Produit par le LLM.

```go
type GeneratedContent struct {
    ID uuid.UUID

    InstructionID uuid.UUID

    Provider string

    Model string

    Content string

    CreatedAt time.Time
}
```

---

# Cohorts

## Program

```go
type Program struct {
    ID uuid.UUID

    TenantID uuid.UUID

    Name string
}
```

---

## Cohort

```go
type Cohort struct {
    ID uuid.UUID

    TenantID uuid.UUID

    ProgramID uuid.UUID

    Name string

    StartDate time.Time
    EndDate time.Time
}
```

---

# Analytics

## Learner

```txt
Mastery
Retention
Confidence
Reviews
Objectives
```

## Trainer

```txt
Cohort Health
Misconceptions
At Risk Learners
Recommendations
```

## Admin

```txt
Usage
Engagement
Completion
Billing
```

---

# Alert Engine

```txt
LearnerStuck

RepeatedMisconception

LowRetention

ReviewOverdue

AssessmentRisk

InactiveLearner

CohortBehindSchedule
```

---

# LLM Gateway

Le Runtime ne connaît jamais un modèle ou un provider.

---

## Interface

```go
type Generator interface {
    Generate(
        ctx context.Context,
        instruction TutorInstruction,
    ) (GeneratedContent, error)
}
```

---

# Configuration LLM par Défaut

LORE est distribué avec :

```yaml
llm:
  default_provider: ollama
  default_model: gemma4
```

---

# Politique de Plateforme

Provider officiel :

```txt
Ollama
```

Modèle officiel :

```txt
gemma4
```

LORE doit fonctionner immédiatement après installation avec :

```txt
PostgreSQL
Redis
NATS
Ollama
Gemma4
LORE
```

Aucune clé API requise.

---

# Hiérarchie de Configuration LLM

```txt
Platform
 └── Tenant
      └── Program
           └── Cohort
                └── Learner
```

Chaque niveau peut surcharger :

```go
type LLMConfiguration struct {
    TenantID *uuid.UUID

    Provider string
    Model string

    Temperature float64
    MaxTokens int
}
```

---

# Providers Supportés

```txt
Ollama

OpenAI

Anthropic

Gemini

Mistral

Custom
```

---

# Event Architecture

Tous les événements contiennent :

```go
type EventMetadata struct {
    TenantID uuid.UUID

    UserID uuid.UUID

    CorrelationID string

    Timestamp time.Time
}
```

---

# Events

```txt
TenantCreated

UserCreated

SyllabusCreated

DomainCreated

ConceptCreated

ActivityStarted

ActivityCompleted

ReviewDue

ReviewCompleted

AssessmentCompleted

ConceptMastered

MisconceptionDetected

LearnerAtRisk
```

Transport :

```txt
NATS JetStream
```

---

# Sécurité Multi-Tenant

Toutes les tables métier :

```sql
tenant_id UUID NOT NULL
```

Isolation :

```txt
PostgreSQL Row Level Security
```

Activée sur toutes les tables métier.

---

# API REST

```http
POST /tenants

POST /users

POST /syllabi
POST /syllabi/{id}/bind

POST /domains
POST /concepts

POST /cohorts

POST /interactions

GET /learners/{id}/next-activity
GET /learners/{id}/state

GET /analytics/cohorts/{id}

GET /alerts
```

---

# API gRPC

```txt
TenantService

IdentityService

LearningService

RuntimeService

AnalyticsService
```

---

# Structure Go

```txt
cmd/
 └── lore/

internal/

 ├── tenant/
 ├── identity/
 ├── learning/
 ├── runtime/
 │
 │   ├── mastery/
 │   ├── retention/
 │   ├── misconception/
 │   ├── planner/
 │   ├── scheduler/
 │   ├── orchestration/
 │   └── trace/
 │
 ├── analytics/
 ├── notification/
 ├── llm/
 │   ├── ollama/
 │   │   └── gemma4/
 │   ├── openai/
 │   ├── anthropic/
 │   ├── gemini/
 │   ├── mistral/
 │   └── custom/
 │
 └── shared/

sql/
migrations/
api/
deploy/
```

---

# Déploiement Minimal

```txt
Docker Compose

├── lore
├── postgres
├── redis
├── nats
└── ollama
     └── gemma4
```

---

# Objectif V1

```txt
Modular Monolith

Multi-Tenant Native

PostgreSQL First

Event Driven

Local First

Ollama First

Gemma4 Default

LLM Agnostic

Runtime First
```

---

# Résumé

Moodle est un environnement d'apprentissage.

LORE est un moteur d'orchestration pédagogique.

Le contenu est généré et remplaçable.

Les actifs stratégiques sont :

* le graphe de concepts
* le learner model
* le runtime pédagogique
* les traces d'apprentissage
* les algorithmes de maîtrise et de révision
* l'orchestration des cohortes

Le provider par défaut est Ollama, et le modèle par défaut est Gemma4.

