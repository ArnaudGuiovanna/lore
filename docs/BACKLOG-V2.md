# Backlog post-audit — issues pour rendre LORE exploitable par un OF

Issues dérivées de l'audit [`docs/ANALYSE-LMS-OF.md`](ANALYSE-LMS-OF.md) (maturité ~3,5/10).
Chaque issue : **priorité** (P0 bloquant · P1 OF Qualiopi/financé · P2 maturité), **problème** (avec
preuve), **critères d'acceptation**, **dépendances**, **statut**. On traite **les 3 bloquants d'abord**,
le **multi-tenant** étant une exigence centrale.

Légende statut : `TODO` · `WIP` · `DONE`.

---

## P0 — Bloquants (à lever pour un usage OF sérieux, même hors financement)

### B-01 · Diffuser le VRAI contenu généré à l'apprenant  — P0 · **bloquant #1** · `TODO`
**Problème** : `web/components/learner/NowWorkbench.tsx` rend un échafaudage Go-banking **codé en dur**
pour tout concept/domaine et n'appelle jamais `listGeneratedContent/getGeneratedContent`. La diffusion
de contenu est un *prop de démo* (la `GeneratedContent` persistée par le runtime est invisible).
**Acceptation** : à l'étape « Now », l'apprenant reçoit le contenu réellement produit par le runtime —
le front appelle `POST /tutor-instructions/{id}/generate` puis affiche la `GeneratedContent` (provider/
modèle marqués) ; l'échafaudage n'est qu'un fallback explicite quand `provider=instruction_only` ; le
contenu varie par concept/domaine. Vérifié e2e.
**Dépend de** : —

### B-02 · Frontend multi-tenant : tenant de session, plus de seed  — P0 · **bloquant #3 (PIVOT)** · `TODO`
**Problème** : `web/lib/api.ts` utilise `seed().tenantId` (instance = un seul OF). Les surfaces lisent
cohorte/domaine/syllabus depuis `.gen/seed.json`. Pas de console SUPER_ADMIN, pas de switch tenant.
**Acceptation** : toutes les requêtes tenant-scoped utilisent `session.tenantId` ; les ressources
(cohortes/domaines/syllabus/roster) sont **listées depuis le backend scopé au tenant**, pas le seed ;
un **SUPER_ADMIN** peut lister/choisir un tenant (console + switch) ; plusieurs OF coexistent sur une
instance, chacun ne voit que ses données (vérifié : deux tenants isolés). Le seed reste un *bootstrap
de démo* uniquement.
**Dépend de** : B-04 (endpoints de liste backend).

### B-03 · Corriger l'isolation RLS en production  — P0 · **bloquant** · `TODO`
**Problème** : `deploy/postgres-init` (qui retire le SUPERUSER de l'utilisateur applicatif) n'est monté
que dans `deploy/docker-compose.yml` (dev), pas dans `docker-compose.prod.yml` → `FORCE RLS` ne tient
pas en prod ; il ne reste que le scoping applicatif `WHERE tenant_id=$1`.
**Acceptation** : la stack prod utilise un rôle PG **NOSUPERUSER** et `FORCE ROW LEVEL SECURITY` est
effectif (un test prouve qu'une requête sans `app.tenant_id` ne voit rien / l'isolation tient).
**Dépend de** : —

### B-04 · Backend : endpoints de liste scopés tenant  — P0 (support B-02) · `TODO`
**Problème** : pas de `GET` liste pour tenants (super-admin), cohortes, domaines, syllabus, memberships
(`GET /memberships` renvoie `null`; cohortes/programmes déduits de l'outbox). Le frontend ne peut pas
être multi-tenant proprement sans ces listes.
**Acceptation** : `GET /v1/tenants` (SUPER_ADMIN), `GET /v1/tenants/{t}/cohorts|programs|domains|syllabi|
memberships` renvoient les ressources du tenant ; autorisés par rôle ; testés (Go).
**Dépend de** : —

### B-05 · Auth fail-closed + anti-bruteforce  — P0 · **bloquant** · `TODO`
**Problème** : `JWT_SECRET` vide ⇒ routes ouvertes (pas de refus de boot) ; aucun rate-limit/lockout au
login.
**Acceptation** : le backend **refuse de démarrer** sans `JWT_SECRET` fort en mode non-dev ; le login
applique un **rate-limit + lockout** (par IP/identifiant). Tests.
**Dépend de** : —

### B-06 · Évaluation corrigée minimale (preuve d'acquisition)  — P0 · **bloquant #2** · `TODO`
**Problème** : la « maîtrise » est **auto-déclarative** (radio succès + confiance) ; `BKTUpdate(correct)`
prend la déclaration apprenant pour bonne réponse → preuve d'acquisition impossible.
**Acceptation** : au moins une activité d'évaluation présente des **items corrigés côté runtime**
(via `assessments/plan` + `assessments/{id}/submit`) ; le score n'est plus l'auto-déclaratif ; le
résultat est tracé et présentable.
**Dépend de** : B-01 (diffusion), B-02 (tenant).

### B-07 · Suivi du temps (heures / connexion)  — P0 (prérequis BPF/attestation) · `TODO`
**Problème** : le runtime ne suit aucun temps ; pas d'export tabulaire.
**Acceptation** : agrégation `StartedAt/CompletedAt` → temps par apprenant/cohorte (heures) ; exposé en
UI + export CSV.
**Dépend de** : B-02.

---

## P1 — Indispensables pour un OF Qualiopi / financé

- **B-08 · Export traçabilité Qualiopi/RNQ** (CSV/PDF, mappé aux 32 indicateurs, téléchargeable). `TODO`
- **B-09 · Attestation conforme** : durée en heures, objectifs/programme, SIRET, NDA, signataire/cachet ; liée au syllabus/cohorte réels (plus de titre codé en dur `lineage.ts`). `TODO`
- **B-10 · Documents contractuels** : convention/contrat de formation, programme, devis, règlement intérieur. `TODO`
- **B-11 · Satisfaction à chaud/à froid** + registre des réclamations (indicateurs RNQ 30-31). `TODO`
- **B-12 · CRUD admin complet** (update/delete users/cohortes/inscriptions) + **sessions/séances** (date/capacité/salle) + **import CSV** + **export tabulaire** (CSV/Excel). `TODO`
- **B-13 · Test de positionnement** présentable et archivable à l'entrée. `TODO`
- **B-14 · Effacement RGPD complet** (endpoint backend d'effacement des traces runtime) + couche légale (consentement, rétention/purge, registre des traitements, DPA, hébergement UE documenté). `TODO`
- **B-15 · Multi-tenant produit avancé** : console SUPER_ADMIN complète, gestion du cycle de vie tenant, switch/impersonation tracée. `TODO`

---

## P2 — Maturité, intégrations, accessibilité

- **B-16 · Conformité RGAA** : audit + déclaration d'accessibilité, axe en CI, skip-link, contrastes. `TODO`
- **B-17 · Communication** : messagerie formateur↔apprenant, annonces cohorte, notifications/relances, reset mot de passe self-service. `TODO`
- **B-18 · Curation formateur** : revue/validation/édition/versionnement du contenu généré + bibliothèque réutilisable. `TODO`
- **B-19 · Ressources** : upload/distribution de supports (PDF/vidéo) selon le public (réévaluer la thèse AI-first). `TODO`
- **B-20 · Intégrations & exploitation** : SSO OIDC complet (découverte/JWKS/rotation, `iss/aud`)/SAML/FranceConnect, webhooks signés, connecteurs financeurs (EDOF/OPCO/France Travail), xAPI/LRS, LTI ; sauvegardes automatisées, HA, HSTS/CSP, `/metrics` protégé, SECURITY.md. `TODO`

---

## Ordre d'exécution (vagues)

1. **Vague A (fondation des bloquants)** — B-04 (listes backend), B-03+B-05 (sécurité prod : RLS + auth fail-closed + anti-bruteforce), B-01 (diffusion du contenu). *(agents en worktrees, file-disjoints)*
2. **Vague B (multi-tenant produit)** — B-02 (frontend tenant de session + listes + console/switch SUPER_ADMIN), B-07 (temps). *(après B-04)*
3. **Vague C** — B-06 (évaluation corrigée). *(après B-01/B-02)*
4. **P1 puis P2** — par itérations, flux `staging → main`.
