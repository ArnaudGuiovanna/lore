# Parcours FORMATEUR — syllabus-first + cycle de versions

> **Rôle : TRAINER** (R. Köhler, cohort lead Go-Spring-24) · langage **LECTURE** · console d'intervention
> _« Tu ne construis pas de cours. Tu rédiges une intention, tu attaches une cohorte — LORE génère le parcours. »_

- **Snapshot figé** : [`html/journey-formateur.html`](html/journey-formateur.html) (≈ 3433 lignes)
- **Version vivante** : `/mockups/variants/journey-formateur.html`
- **Identité** : kohler@acme.test · rôle **dérivé** TRAINER · tenant Acme · cohorte Go-Spring-24

---

## 1. Le parcours (11 étapes, syllabus-first)

0. **Login** → résolution de session → **rôle dérivé TRAINER**.
1. **Design the learning** — cadrage explicite : _« You don't build courses. You design the learning. »_ (no course builder / no resource uploads / no manual ordering). Liste des syllabi existants : 1 lié/live (`Production-grade Go persistence`, `syl-7f3c · v1`), 1 draft. CTA « Author a new syllabus ».
2. **Author syllabus** — Title, Description, **Objectives** (chips validés contre le DAG Go Backend), **Outcomes** mesurables. `POST /v1/tenants/acme/syllabi`. Note « No courses. No resources. Intent only. »
3. **Attach a cohort** — `target_type` **COHORT · Go-Spring-24** (PROGRAM/LEARNER aussi), `adaptation_mode` **GUIDED** (défaut) / SELF_DIRECTED. Le binding **active** la génération.
4. **Generate the parcours** — _« The binding fires. The parcours materializes. »_ Le runtime ordonne 5 concepts sur le DAG (**runtime decided**), le LLM streame le cadrage par activité (**llm generated**, regenerate), avec note de fallback instruction-only.
5–10. **Console d'intervention** (réutilisée) : Cohort health (KPIs + roster trié par signal) → Alerts (groupées par action) → Inspection (Diego LearnerAtRisk : before/observation/after/rationale, marques runtime/LLM) → Intervention (action **sanctionnée**, jamais éditer la maîtrise ; « assign repair » bloqué car pas de misconception active) → Track & resolve (at-risk 2→1) → End.

## 2. L'ajout de cette étape : authoring approfondi (édition / versions / rebind)

Implémenté comme un **sous-flux hors-stepper** (`screen-v1/v2/v3`, navigateur `gotoScreen()`) accessible depuis l'étape 1 via **« Manage / edit »** et **« Version history »** sur la carte live — pour ne pas casser le parcours linéaire 11 étapes.

### a. Éditer = forker une v2 (append-only)
Ouvre `syl-7f3c · v1` (lié à Go-Spring-24) pré-rempli ; on ajoute l'objectif `migrations` et on resserre l'acquis rollback. **Save** :
- écrit un **nouveau** `Syllabus` (`syl-9a21 · v2`, id propre) et émet **`SyllabusCreated`** ;
- **v1 reste byte-identique** (copy explicite « Saving does not overwrite v1 ») ;
- v2 apparaît dans le **rail d'historique** comme draft **non lié**.

### b. Historique de versions
Rail montrant **v1** (live, binding → ici) et **v2** (draft, unbound), `created_at`, auteur (R. Köhler), ce qui a changé. Tant qu'on ne **rebind** pas, **rien ne change pour les apprenants** : le binding de Go-Spring-24 pointe toujours v1.

### c. Diff v1 → v2
Objectif `migrations` **ajouté**, acquis rollback **resserré**, acquis inchangé conservé — avec la trace d'événement `SyllabusCreated` et la note « v1 untouched / v2 unbound draft ».

### d. Rebind de la cohorte avec review d'impact
Action significative, **human-in-the-loop** : déplacer le binding de Go-Spring-24 de **v1 → v2** (nouvel événement **`SyllabusBound`**).
- **Review-state** avant Apply : résumé du diff + impact « **Affects 18 learners. The runtime will re-plan the parcours from v2. In-flight mastery, retention and snapshots are PRESERVED — the runtime owns durable state; only the forward intent changes.** » (3 chips de préservation).
- **Confirmation obligatoire** qui **gate le bouton Apply** (vérifié : disabled → enabled).
- Apply → streame une **re-planification** runtime (5 concepts réordonnés, `migrations` inséré en prérequis de `persistence`, `transactions` « reframed », concepts maîtrisés badgés « mastery reused ») et émet **`SyllabusBound`** + **`ParcoursReplanRequested`** + `TutorInstruction`. La carte live de l'étape 1 passe à `syl-9a21 · v2`.

## 3. Fidélité au modèle

- **Append-only, jamais d'overwrite** : pas de PUT, pas de champ version sur l'enregistrement ; « version » est un concept produit. Rollback = rebind vers v1 (qui reste en historique, unbound).
- **Runtime-first** : le runtime possède l'état durable ; le rebind **préserve** maîtrise (BKT)/rétention (FSRS)/snapshots — seule l'intention en avant change. Le formateur **n'édite jamais** la maîtrise ; Apply **demande** le rebind, le runtime re-planifie.
- **Lignée par le binding** : c'est ce binding que l'apprenant voit en provenance (cf. [01-apprenant.md](01-apprenant.md)).
- **Marques** : « runtime decided » (ordre re-planifié, autoritaire) vs « llm generated » (cadrage par activité, jetable).

## 4. Interaction signature (vérifiée en navigateur)

edit v1 → +`migrations` + resserrement d'un acquis → **Save forks v2** (`syl-9a21`, `SyllabusCreated`, v1 intacte) → diff → **rebind v1→v2** → review d'impact → **confirmation obligatoire gate l'Apply** → Apply streame la re-planification et émet `SyllabusBound` + `ParcoursReplanRequested` → carte live mise à jour. _Vérifié end-to-end, 0 erreur JS._

---

_Verdict critique : 95/100 — objectif atteint, append-only fidèle, runtime-first (état préservé), human-in-the-loop (gate de confirmation), LECTURE cohérent, parcours toujours complet, 0 erreur JS._
