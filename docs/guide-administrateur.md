# Guide administrateur — LORE

Ce guide explique, pas à pas, comment un **administrateur d'organisme de
formation (OF)** met LORE en service et l'exploite : première installation,
invitation des formateurs et apprenants, création des programmes et cohortes,
inscriptions, configuration du LLM, supervision, et conformité RGPD.

> **Le modèle de LORE en une phrase.** LORE est un LMS **IA-first** : un formateur
> n'assemble pas des cours, il **rédige un syllabus** (intention + objectifs +
> acquis visés) et **rattache une cohorte** ; le **moteur pédagogique** et le LLM
> génèrent ensuite le *parcours* de chaque apprenant. Le moteur est toujours la
> source de vérité — l'interface et le LLM ne décident jamais de la progression.

Public : administrateur (rôle `TENANT_ADMIN`). Pour l'installation technique du
serveur, voir le [Guide de déploiement](deploiement.md). Pour le rôle formateur,
voir le [Guide formateur](guide-formateur.md).

---

## 1. Prérequis

- LORE est déployé et accessible (voir le [Guide de déploiement](deploiement.md)).
  En une commande : `./deploy/up.sh` (ou `make prod-up`).
- Vous disposez du **jeton opérateur** `LORE_BOOTSTRAP_TOKEN` (dans `deploy/.env`).
  Il est **indispensable** pour la première installation.

---

## 2. Première installation : l'assistant de configuration

À la toute première visite, le système est **vide** (aucune donnée de
production). LORE vous redirige vers l'assistant `/setup`.

1. Ouvrez l'application (`https://votre-domaine` ou `http://localhost`).
2. L'assistant **« Première installation »** s'affiche. Renseignez :
   - le **nom de l'organisation** (le *tenant*) ;
   - le **nom**, l'**e-mail** et le **mot de passe** du premier administrateur
     (mot de passe ≥ 10 caractères, à confirmer) ;
   - le **jeton opérateur** (`LORE_BOOTSTRAP_TOKEN`).
3. Validez. L'assistant crée le tenant, le compte administrateur
   (`TENANT_ADMIN`) avec un **vrai mot de passe** (pas de réinitialisation forcée
   pour ce compte), ouvre votre session et vous dépose sur `/admin`.

> **Sécurité.** Le jeton opérateur ne transite jamais vers le navigateur : il est
> vérifié côté serveur. Une fois un administrateur créé, `/setup` est **verrouillé**
> (redirection vers `/login`) : impossible de ré-initialiser le système.

Si une démo a été *seedée* (voir [Guide de déploiement §8](deploiement.md#8-seed-de-démonstration)),
le système n'est pas vide : connectez-vous plutôt via `/login`.

---

## 3. Inviter des formateurs et des apprenants

Depuis la console d'administration (`/admin`), section **Identités / membres**.

1. Choisissez **Inviter un utilisateur**.
2. Renseignez **e-mail**, **nom** et **rôle** : `TENANT_ADMIN`, `TRAINER` ou
   `LEARNER`. (Un administrateur de tenant ne peut **pas** accorder `SUPER_ADMIN`,
   réservé à l'opérateur via le jeton bootstrap.)
3. Validez. LORE :
   - crée l'utilisateur et son *membership* (le rôle découle du *membership*) ;
   - génère un **mot de passe temporaire** ;
   - **« délivre » l'invitation par e-mail** (lien de connexion + mot de passe
     temporaire) : par **SMTP** si configuré, sinon le message est écrit dans la
     **console serveur** (*dev outbox*) ;
   - **affiche une fois** le mot de passe temporaire dans l'interface, pour que
     vous puissiez le transmettre vous-même si besoin.

**Premier login forcé.** Tout utilisateur invité est marqué
`mustChangePassword` : à sa première connexion, il est **confiné** à la page
`/account/password` et doit **définir son propre mot de passe** avant d'accéder à
son espace. Le rôle détermine l'espace d'arrivée (`/learner`, `/trainer`,
`/admin`).

> **E-mails.** Pour de vrais envois, définissez `SMTP_*` et `PUBLIC_APP_URL`
> (URL publique pour les liens) — voir [Guide de déploiement §4](deploiement.md#4-variables-denvironnement).
> Sans SMTP, récupérez le mot de passe temporaire dans les logs (`make prod-logs`)
> ou via l'affichage unique dans l'interface.

**Re-grade de rôle.** Dans la liste des membres, vous pouvez modifier le rôle de
chaque membre (sauf vous-même et un `SUPER_ADMIN`).

---

## 4. Créer des programmes et des cohortes

Toujours dans `/admin`, section **Structure de l'organisation**.

1. **Créer un programme** : un nom suffit. (Émet l'événement `ProgramCreated`.)
2. **Créer une cohorte** sous un programme : programme, nom, **date de début** et
   **date de fin** (les deux sont **obligatoires**). (Émet `CohortCreated`.)

Une cohorte est le contenant qui réunit des apprenants et auquel un formateur
**rattachera** son syllabus.

---

## 5. Inscrire des apprenants

Section **Inscriptions** de `/admin`.

1. Sélectionnez une **cohorte** et un **apprenant**.
2. Validez. LORE inscrit l'apprenant (`POST .../cohorts/{cohort}/enrollments`),
   ce qui émet `LearnerEnrolled`. L'apprenant apparaît alors dans la *roster* de
   la cohorte, avec son état runtime (maîtrise moyenne, révisions dues) dès qu'il
   a des traces.

> Les apprenants à inscrire proviennent de la liste des apprenants connus du
> tenant (créés via invitation).

---

## 6. Et l'**autorat** ? (rappel du modèle IA-first)

La création du **syllabus** (intention/objectifs/acquis), le rattachement à une
cohorte et la supervision pédagogique relèvent du **formateur**, pas de
l'administrateur. Vous fournissez la structure (programmes, cohortes,
inscriptions) ; le formateur fournit l'intention pédagogique. Voir le
[Guide formateur](guide-formateur.md). Le moteur génère ensuite le parcours de
chaque apprenant — **vous n'assemblez pas de cours**.

---

## 7. Configurer le LLM (portées)

Dans `/admin`, la **matrice de configuration LLM** permet de définir le
fournisseur, le modèle, la température et la limite de jetons, par **portée** :
**tenant → programme → cohorte → apprenant**. La résolution applique la
configuration **la plus spécifique** disponible (apprenant > cohorte > programme >
tenant).

- Le défaut sûr est `instruction_only` : le moteur fonctionne **sans** appel LLM.
- Pour activer la génération, choisissez un fournisseur (`ollama`, `openai`,
  `anthropic`, `gemini`, `mistral`, `custom`) ; les clés API se règlent côté
  backend (voir [Guide de déploiement §6](deploiement.md#6-llm-optionnel)).
- En cas d'échec d'un appel LLM, LORE retombe sur le contenu *instruction-only*.

> Les URL de base LLM configurables passent par un client HTTP durci (pas de
> redirection, blocage des destinations privées/loopback) ; les clés voyagent en
> en-tête, jamais dans l'URL.

---

## 8. Superviser : l'outbox d'événements et les alertes

La console `/admin` affiche :

- une **vue d'ensemble** runtime : maîtrise moyenne de la cohorte, alertes
  ouvertes (dont *high/critical*) — ces agrégats sont **calculés par le moteur**
  (BKT / planificateur de révisions), jamais recalculés par l'interface ;
- l'**outbox d'événements** : la trace durable des événements de domaine
  (`ProgramCreated`, `CohortCreated`, `LearnerEnrolled`, `SyllabusCreated`,
  `SyllabusBound`, …) avec leur horodatage. C'est la base d'un export de
  traçabilité (type Qualiopi).

Le **détail par apprenant** et les interventions pédagogiques (ex. réparation de
misconception) relèvent surtout du [Guide formateur](guide-formateur.md).

---

## 9. RGPD : export et effacement

Accès : `/admin/rgpd` (« RGPD / Données personnelles »). Réservé aux rôles
`TENANT_ADMIN` / `SUPER_ADMIN`.

### Export (droit d'accès / portabilité)

`GET /api/admin/rgpd/export?userId=…` produit un **bundle JSON téléchargeable**
agrégeant tout ce que LORE détient sur la personne :

- l'enregistrement d'identifiant (e-mail, nom, rôle — **sans le hachage de mot de
  passe**) et le *membership* ;
- les **traces du moteur** : état d'apprentissage, cartes de révision dues,
  snapshots pédagogiques, alertes la concernant — **pseudonymisées** par
  identifiant apprenant (`learner_id`) ;
- les lignes d'**émargement** ;
- les éventuels *tombstones* d'effacement antérieurs.

### Effacement (droit à l'oubli)

`POST /api/admin/rgpd/erase` (corps `{ userId }`) **anonymise** les données
nominatives que LORE contrôle côté web :

- l'identifiant de connexion (e-mail/nom **caviardés**, mot de passe brouillé,
  ligne conservée) ;
- les lignes d'**émargement** (re-clés vers un pseudonyme, conservées) ;
- un **tombstone** d'audit est enregistré (aucune donnée nominative).

> **Honnêteté.** Les traces du moteur (états, snapshots) sont déjà
> **pseudonymisées** par `learner_id` (aucune donnée nominative) ; elles ne sont
> **pas supprimées** ici (le backend en est propriétaire et n'expose pas
> d'endpoint d'effacement). L'interface et le bundle d'export le disent
> explicitement. Un administrateur ne peut pas s'effacer lui-même.

---

## 10. Où vivent les données et sauvegardes

- **Postgres** (volume `pgdata`) : tenants, programmes, cohortes, états du moteur,
  événements, snapshots.
- **Magasin d'identifiants** (volume `web-gen`, ou tables `lore_web_credentials` /
  `lore_attendance` / `lore_rgpd_erasures` si `DATABASE_URL` est défini côté web) :
  mots de passe (bcrypt), émargement, *tombstones* RGPD.

Sauvegardez régulièrement :

```sh
make backup-db                                   # pg_dump -> ./backups/
make restore-db FILE=backups/lore-<horodatage>.sql.gz
```

Pensez à sauvegarder aussi le volume `web-gen` (identifiants/émargement) et
`deploy/.env`. Détails : [Guide de déploiement §7](deploiement.md#7-où-vivent-les-données-sauvegardes-et-restauration).

---

## 11. Tâches récapitulatives

| Tâche | Où |
|-------|----|
| Première installation (org + admin) | `/setup` (jeton opérateur requis) |
| Inviter formateurs/apprenants | `/admin` → Identités |
| Créer programmes / cohortes | `/admin` → Structure |
| Inscrire des apprenants | `/admin` → Inscriptions |
| Configurer le LLM par portée | `/admin` → Matrice LLM |
| Superviser (alertes, outbox) | `/admin` |
| Export / effacement RGPD | `/admin/rgpd` |
| Sauvegardes | `make backup-db` / `make restore-db` |

Voir aussi : [Guide formateur](guide-formateur.md), [Guide apprenant](guide-apprenant.md),
[Guide de déploiement](deploiement.md).
</content>
