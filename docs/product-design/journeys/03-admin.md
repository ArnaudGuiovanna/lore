# Parcours ADMINISTRATEUR — plan de contrôle (sans propriété du syllabus)

> **Rôle : TENANT_ADMIN** (S. Aalto) · langage **LECTURE** · plan de contrôle
> _« L'admin configure le système d'exploitation de l'apprentissage — mais ne rédige pas les syllabus. »_

- **Snapshot figé** : [`html/journey-admin.html`](html/journey-admin.html) (≈ 1567 lignes)
- **Version vivante** : `/mockups/variants/journey-admin.html`
- **Identité** : admin@acme.test · rôle **dérivé** TENANT_ADMIN · tenant **Acme Learning** (scope toujours visible)

---

## 1. Le parcours (étapes)

0. **Login** → résolution de session (frontière **OIDC verify-only** : sur SSO, l'IdP signe en RS256, LORE **vérifie** seulement) → **rôle dérivé TENANT_ADMIN**.
1. **Overview** — Acme Learning en bref, chip de scope toujours présent.
2. **Identity & memberships** — utilisateurs + rôles (SUPER_ADMIN / TENANT_ADMIN / TRAINER / LEARNER) ; rôles **accordés par membership** ; note de frontière OIDC verify-only ; seul le bootstrap/super-admin peut accorder SUPER_ADMIN.
3. **Org structure** — **programs › cohorts › enrollment** (gens/conteneurs). _(cf. §2 : recadré pour retirer la propriété du syllabus.)_
4. **Domain graph** — vue lecture/gouvernance du DAG « Go Backend » (cycle-safe).
5. **LLM configuration matrix** — hiérarchie **tenant › program › cohort › learner**, résolution **most-specific-first** ; défaut tenant `anthropic/claude` temp 0.2, override `learner-1` = `instruction_only`.
6. **Edit · review** — édition d'un scope (provider/model/temperature/max_tokens) avec **review-state avant save** : diff de champ + impact + confirmation obligatoire (discipline des changements dangereux).
7. **Event outbox** — moniteur des événements émis (published/unpublished), avec démonstrateur tx-rollback.
8. **End** — config appliquée, événement émis.

## 2. La correction du modèle : l'admin ne possède PAS le syllabus

Étape **Org structure** recadrée (l'admin ne crée/édite pas de syllabus — les **formateurs** le font, cf. [02-formateur.md](02-formateur.md)) :

- Kicker « **org structure · programs › cohorts › enrollment** » ; dek « you do not author syllabi ».
- Sous-arbre **Enrollment** (lead R. Köhler + apprenants Amara/Diego/Liam/Noor + 14 autres, pastilles de rôle).
- Sous-arbre **« Bound syllabi (read-only) »** : le binding rédigé par le formateur « Production-grade Go persistence » avec un chip **view-only** `COHORT · GUIDED` et des lignes mono (`syllabus_binding`, `target_type=COHORT`, `target_id`, auteur R. Köhler).
- Bandeau : « **Syllabi are authored by trainers (Trainer console), not by the admin** … You see the binding here read-only for governance — there is no create-syllabus or edit-binding affordance … Your levers are programs, cohorts and enrollment. »
- Événement outbox `SyllabusBound` annoté « by trainer kohler » (n'implique pas une action admin).
- **Aucune** affordance create/new/author/edit-binding syllabus (vérifié par inspection du fichier).

## 3. Fidélité au modèle

- **Scope tenant toujours visible** ; rôle dérivé de la membership.
- **Frontière OIDC verify-only** (RS256, LORE vérifie, n'émet pas).
- **Changements dangereux** (config LLM) derrière un **review-state + confirmation**.
- **Admin ≠ propriétaire du syllabus** : visibilité gouvernance en lecture seule uniquement.

## 4. Interaction signature

Login → rôle TENANT_ADMIN → scope Acme → **matrice LLM** (hiérarchie) → **édition avec review-state** (diff + impact + confirmation) → Apply → **événement émis** dans l'outbox. (Pilotage automatique partiel ; flux vérifié par la passe de critique + inspection du fichier.)

---

_Verdict critique : 95/100 — admin non-propriétaire du syllabus, aucune création/édition, scope visible, runtime-first, LECTURE cohérent, parcours complet, 0 erreur JS._
