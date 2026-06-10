# Backlog OF - rendre LORE exploitable par un organisme de formation

Source : audit [`docs/ANALYSE-LMS-OF.md`](docs/ANALYSE-LMS-OF.md), maturite estimee actuelle : environ **3,5 / 10** pour un usage LMS d'OF francais.

Objectif de ce backlog : transformer LORE d'un runtime pedagogique AI-first prometteur en outil exploitable par un OF, avec priorisation stricte des blocages produit, evaluation, conformite, exploitation et multi-tenant.

Legende :

- `P0` : bloquant pour un usage OF serieux, meme hors financement.
- `P1` : necessaire pour un OF Qualiopi, certifiant ou finance.
- `P2` : maturite produit, integrations, accessibilite et exploitation avancee.
- Statut initial : `[ ]` a faire.

---

## Principes de priorisation

1. Ne pas commencer par les integrations financeurs tant que le contenu, l'evaluation et le tenant ne sont pas fiables.
2. Tout item P0 doit avoir des tests automatises ou une verification end-to-end.
3. Le seed de demo doit rester un bootstrap de demonstration, jamais la source de verite produit.
4. Les preuves OF doivent etre exportables : l'outbox brute ne suffit pas.
5. Les fonctionnalites OF doivent etre tenant-scopees des leur premiere implementation.

---

## Avancement courant

- `B-01` : partiellement implemente. Le workbench appelle la generation backend et affiche le contenu persiste avec provenance. Le fallback local reste uniquement en cas d'absence/erreur de generation.
- `B-02` : implemente cote backend. Les endpoints de listes tenant-scopees existent pour tenants, learners, programs, cohorts, enrollments, syllabi et domains, avec tests.
- `B-03` : implemente pour les surfaces authentifiees principales. `tpath` utilise le tenant de session, les pages learner/admin/trainer chargent programmes/cohortes/domaines/apprenants/inscriptions/syllabi depuis le backend, et le seed ne reste qu'en fallback explicite demo/setup/credentials.
- `B-04` : implemente pour les nouveaux deploiements prod et les re-runs. Le compose prod cree/force un role applicatif `NOSUPERUSER` distinct du superuser Postgres.
- `B-05` : implemente pour le socle actuel. Le backend refuse un `JWT_SECRET` absent/faible en `LORE_ENV=production`, rate-limit l'emission de tokens, et le login web applique un lockout IP+email. Durcissement restant : les deux rate-limiters derivent l'IP de `X-Forwarded-For` sans liste de proxys de confiance (spoofable si l'app est exposee sans Caddy en frontal ; non exploitable dans la topologie compose supportee ou Caddy reecrit XFF et ou l'API n'est pas publiee) — ajouter une config trusted-proxy + un plafond par identifiant independant de l'IP.
- `B-06` : implemente pour le flux minimal. Le runtime genere des items corriges, calcule le score cote serveur, bloque les assessments via `/interactions`, et le workbench soumet via `/assessments/{id}/submit`.
- `B-07` : partiellement implemente. `CohortAnalytics` agrege le temps/heures a partir des activites demarrees/terminees et expose un CSV par cohorte. Il manque pause/reprise et UI admin/formateur dediee.
- `B-12` : partiellement implemente cote backend. CRUD/archive users/programs/cohorts/enrollments, sessions planifiees, audit admin et migration RLS existent. Il manque import CSV, exports CSV/Excel complets et UI admin complete.
- `B-21` : partiellement implemente. `/metrics` est protege par token, le compose prod genere/exige `LORE_METRICS_TOKEN`, Caddy ajoute des headers de securite, `SECURITY.md` existe, et la doc deploiement couvre davantage backup/restore/HA. Il manque backup sidecar/cron automatique et restauration automatisee en CI.

Verification du tour courant :

- `GOCACHE=/tmp/go-build-cache go test ./...`
- `npm run build` dans `web/`
- `git diff --check`
- `sh -n deploy/up.sh`
- `sh -n deploy/postgres-init/001_lore_app_user.sh`
- `docker-compose -f deploy/docker-compose.prod.yml config` avec variables prod factices

---

## P0 - Bloquants d'exploitation OF

### B-01 - Diffuser le vrai contenu genere a l'apprenant

**Probleme audit** : `web/components/learner/NowWorkbench.tsx` affiche un echafaudage code en dur, identique quel que soit le concept/domaine, et n'appelle pas les endpoints de contenu genere.

**Taches**

- [ ] Remplacer l'echafaudage statique par un chargement du contenu genere persiste.
- [ ] Appeler les APIs de generation/lecture de contenu depuis l'ecran apprenant.
- [ ] Afficher la provenance du contenu : provider, modele, instruction, date.
- [ ] Gerer explicitement le mode `instruction_only` comme fallback de demo.
- [ ] Ajouter un etat vide clair quand aucun contenu n'existe encore.
- [ ] Couvrir le flux par test e2e apprenant.

**Acceptation**

- Un apprenant voit un contenu different selon le concept et le domaine.
- Le contenu rendu correspond a la `GeneratedContent` persistee par le runtime.
- Aucun texte Go-banking code en dur n'apparait hors fallback de demo.

---

### B-02 - Ajouter les endpoints backend de liste tenant-scopees

**Probleme audit** : le frontend reconstruit cohortes, domaines, programmes et inscriptions depuis le seed ou l'outbox, faute d'endpoints de liste propres.

**Taches**

- [ ] Ajouter `GET /v1/tenants` pour `SUPER_ADMIN`.
- [ ] Ajouter les listes tenant-scopees : cohortes, programmes, domaines, syllabi, memberships, learners.
- [ ] Appliquer les droits par role : super-admin, admin OF, formateur, apprenant.
- [ ] S'assurer que toutes les listes respectent le tenant courant.
- [ ] Ajouter tests Go d'autorisation et d'isolation tenant.
- [ ] Documenter les endpoints.

**Acceptation**

- Le frontend peut afficher les donnees d'un OF sans lire `.gen/seed.json`.
- Deux tenants sur la meme instance ne voient jamais les donnees l'un de l'autre.

---

### B-03 - Remplacer le tenant seed par le tenant de session dans le frontend

**Probleme audit** : `web/lib/api.ts` utilise `seed().tenantId`, ce qui rend le produit mono-tenant cote UI.

**Taches**

- [ ] Introduire une source de session fiable contenant `tenantId`, `userId` et `role`.
- [ ] Remplacer tous les appels a `seed().tenantId` dans les chemins API.
- [ ] Charger cohortes, roster, programmes et syllabus depuis les endpoints backend.
- [ ] Ajouter une console `SUPER_ADMIN` minimale pour lister et choisir un tenant.
- [ ] Ajouter un switch tenant trace pour les profils autorises.
- [ ] Conserver le seed uniquement comme donnees de demo ou bootstrap local.
- [ ] Ajouter tests e2e multi-tenant.

**Acceptation**

- Une instance peut servir plusieurs OF.
- Un admin OF ne voit que son tenant.
- Un super-admin peut changer de tenant sans modifier le seed ni redemarrer l'app.

**Depend de** : B-02.

---

### B-04 - Corriger l'isolation RLS en production

**Probleme audit** : `deploy/postgres-init` retire le privilege `SUPERUSER` en dev, mais n'est pas monte dans `docker-compose.prod.yml`. En production, l'utilisateur applicatif peut contourner `FORCE RLS`.

**Taches**

- [ ] Monter les scripts d'initialisation Postgres necessaires dans le compose prod.
- [ ] Garantir que le role applicatif est `NOSUPERUSER`.
- [ ] Verifier que `FORCE ROW LEVEL SECURITY` est effectif sur les tables tenant-scopees.
- [ ] Ajouter un test d'integration Postgres qui echoue si le role applicatif contourne RLS.
- [ ] Documenter la verification manuelle d'une base prod existante.

**Acceptation**

- Une requete sans contexte tenant ne retourne pas de donnees tenant.
- Le role applicatif prod ne peut pas bypasser RLS.

---

### B-05 - Fermer l'authentification et ajouter anti-bruteforce

**Probleme audit** : `JWT_SECRET` vide ouvre les routes ; aucun rate-limit ou lockout au login.

**Taches**

- [ ] Refuser le demarrage en mode non-dev si `JWT_SECRET` est absent ou faible.
- [ ] Ajouter un mode dev explicite pour les environnements locaux.
- [ ] Ajouter rate-limit par IP et identifiant sur le login.
- [ ] Ajouter lockout temporaire apres echecs repetes.
- [ ] Journaliser les tentatives suspectes sans exposer de secrets.
- [ ] Ajouter tests unitaires et integration HTTP.

**Acceptation**

- Une configuration prod dangereuse ne demarre pas.
- Le brute force login est ralenti et observable.

---

### B-06 - Creer une evaluation corrigee minimale

**Probleme audit** : la maitrise repose sur une auto-declaration de l'apprenant. `BKTUpdate(correct)` prend cette declaration comme preuve de bonne reponse.

**Taches**

- [ ] Definir un modele d'item corrige : QCM, reponse courte ou exercice simple.
- [ ] Ajouter une API de planification d'evaluation.
- [ ] Ajouter une API de soumission corrigee cote runtime.
- [ ] Brancher l'ecran apprenant sur cette evaluation.
- [ ] Distinguer explicitement auto-ressenti, confiance et score corrige.
- [ ] Persister le score, les items, les reponses et la correction.
- [ ] Alimenter BKT/maitrise avec les resultats corriges, pas l'auto-declaratif.
- [ ] Ajouter tests e2e et tests runtime.

**Acceptation**

- Un OF peut produire une preuve minimale d'acquisition.
- La maitrise ne peut plus etre validee uniquement par declaration apprenant.

**Depend de** : B-01, B-03.

---

### B-07 - Suivre le temps et les heures de formation

**Probleme audit** : LORE ne suit pas les heures ni le temps de connexion, ce qui bloque attestation, BPF, FOAD et financeurs.

**Taches**

- [ ] Definir les evenements de debut, pause, reprise et fin d'activite.
- [ ] Agreger le temps par apprenant, cohorte, session, programme et periode.
- [ ] Exclure ou plafonner les temps manifestement inactifs.
- [ ] Exposer un resume temps/heures dans les vues admin et formateur.
- [ ] Ajouter export CSV.
- [ ] Ajouter tests sur les agregations.

**Acceptation**

- Un admin peut exporter les heures suivies par apprenant et par cohorte.
- Les attestations peuvent consommer une duree fiable.

**Depend de** : B-03.

---

## P1 - OF Qualiopi, certifiant ou finance

### B-08 - Export Qualiopi / RNQ audit-ready

**Probleme audit** : aucun export mappe aux indicateurs Qualiopi/RNQ n'existe ; l'outbox brute n'est pas un livrable auditeur.

**Taches**

- [ ] Mapper les donnees LORE aux indicateurs RNQ applicables.
- [ ] Produire un export CSV et PDF par cohorte/session.
- [ ] Inclure positionnement, adaptation du parcours, assiduite, evaluations, appreciations, reclamations.
- [ ] Ajouter une page admin de telechargement.
- [ ] Tracer qui a genere l'export et quand.

**Acceptation**

- Un OF peut remettre un dossier de preuves lisible sans requete technique.

---

### B-09 - Rendre l'attestation conforme

**Probleme audit** : l'attestation actuelle est honnete mais incomplete : pas d'heures, SIRET, NDA, objectifs, signataire/cachet reel, liaison faible au syllabus/cohorte reels.

**Taches**

- [ ] Ajouter les champs legaux de l'organisme : raison sociale, SIRET, NDA, adresse.
- [ ] Ajouter signataire, qualite du signataire et cachet/signature.
- [ ] Inclure objectifs, programme, dates et duree en heures.
- [ ] Lier l'attestation aux donnees reelles de cohorte, session et syllabus.
- [ ] Ajouter hash/verrouillage de version.
- [ ] Ajouter tests PDF et snapshot.

**Acceptation**

- L'attestation est exploitable administrativement par un OF.

**Depend de** : B-03, B-07.

---

### B-10 - Ajouter documents contractuels OF

**Probleme audit** : aucune convention, contrat de formation, devis, programme ou reglement interieur n'est gere.

**Taches**

- [ ] Modeliser les documents OF par tenant.
- [ ] Generer programme de formation, convention, contrat, devis et reglement interieur.
- [ ] Versionner les documents remis.
- [ ] Lier chaque document aux apprenants, cohortes ou clients concernes.
- [ ] Ajouter export PDF.

**Acceptation**

- Un dossier administratif complet peut etre constitue depuis LORE.

---

### B-11 - Ajouter satisfaction a chaud, a froid et reclamations

**Probleme audit** : aucune enquete de satisfaction ni registre de reclamations, requis pour les indicateurs RNQ concernes.

**Taches**

- [ ] Creer des questionnaires de satisfaction a chaud.
- [ ] Creer des questionnaires a froid planifiables apres formation.
- [ ] Ajouter un registre des reclamations tenant-scope.
- [ ] Ajouter workflows de traitement et statut.
- [ ] Inclure ces donnees dans l'export Qualiopi.

**Acceptation**

- Un OF peut prouver le recueil et le traitement des appreciations/reclamations.

---

### B-12 - CRUD admin complet et sessions planifiees

**Probleme audit** : pas de list/update/delete reelles, pas de sessions/seances, pas d'import CSV, gestion quotidienne impossible.

**Taches**

- [ ] Ajouter CRUD utilisateurs.
- [ ] Ajouter CRUD cohortes.
- [ ] Ajouter CRUD inscriptions et transferts.
- [ ] Ajouter sessions/seances avec date, heure, capacite, lieu ou visio.
- [ ] Ajouter import CSV apprenants et inscriptions.
- [ ] Ajouter exports CSV/Excel presence, progression, completion.
- [ ] Ajouter audit log admin.

**Acceptation**

- Un admin peut corriger, desinscrire, transferer et planifier sans intervention technique.

**Depend de** : B-02, B-03.

---

### B-13 - Ajouter test de positionnement

**Probleme audit** : aucun test d'entree presentable et archivable.

**Taches**

- [ ] Creer un flux de positionnement avant entree en formation.
- [ ] Associer le positionnement aux objectifs et pre-requis.
- [ ] Archiver resultat, date, version et criteres.
- [ ] Permettre au formateur de consulter et commenter.
- [ ] Inclure le resultat dans l'export Qualiopi.

**Acceptation**

- Un OF peut justifier l'adaptation initiale du parcours.

---

### B-14 - Completer RGPD et effacement backend

**Probleme audit** : export RGPD present cote web, mais effacement partiel ; traces runtime Go non supprimees ; couche legale incomplete.

**Taches**

- [ ] Ajouter endpoint backend d'effacement complet tenant-scope.
- [ ] Supprimer ou anonymiser traces runtime, events, snapshots, evaluations et contenus personnels.
- [ ] Ajouter politique de retention et purge planifiee.
- [ ] Ajouter registre de traitements par tenant.
- [ ] Documenter DPA, hebergement UE et responsabilites.
- [ ] Ajouter export lisible pour la personne concernee.

**Acceptation**

- Une demande RGPD peut etre traitee sans laisser de donnees personnelles dans le runtime.

---

### B-15 - Connecter financeurs et BPF

**Probleme audit** : aucun modele/export BPF, aucun connecteur CPF/EDOF, OPCO ou France Travail/Kairos.

**Taches**

- [ ] Modeliser les donnees requises pour BPF.
- [ ] Ajouter export BPF annuel.
- [ ] Ajouter champs financeur, dossier, statut, prise en charge.
- [ ] Concevoir connecteurs EDOF/CPF, OPCO et France Travail/Kairos.
- [ ] Journaliser les synchronisations financeurs.

**Acceptation**

- Un OF finance peut produire les donnees administratives minimales attendues.

**Depend de** : B-07, B-08, B-09, B-12.

---

## P2 - Maturite produit et exploitation

### B-16 - Curation formateur du contenu genere

**Probleme audit** : le formateur ne controle pas vraiment ce qui est enseigne ; aucune validation, edition ou version de contenu.

**Taches**

- [ ] Ajouter une file de revue du contenu genere.
- [ ] Permettre edition, approbation, rejet et republication.
- [ ] Versionner le contenu approuve.
- [ ] Ajouter bibliotheque reutilisable par tenant.
- [ ] Tracer auteur, validateur et date de validation.

**Acceptation**

- Un formateur peut assumer la responsabilite pedagogique du contenu diffuse.

---

### B-17 - Ajouter ressources pedagogiques

**Probleme audit** : pas d'upload/distribution de supports PDF, video, SCORM/H5P ou ressources externes.

**Taches**

- [ ] Ajouter upload de fichiers par tenant.
- [ ] Associer ressources a programme, module, concept ou session.
- [ ] Gerer droits d'acces par role et cohorte.
- [ ] Ajouter preview/telechargement.
- [ ] Evaluer SCORM/H5P ou alternatives selon priorite produit.

**Acceptation**

- Un OF peut diffuser ses propres supports sans sortir de LORE.

---

### B-18 - Communication apprenant/formateur

**Probleme audit** : communication quasi absente hors e-mail d'invitation.

**Taches**

- [ ] Ajouter messagerie formateur-apprenant.
- [ ] Ajouter annonces de cohorte.
- [ ] Ajouter notifications et relances.
- [ ] Ajouter reset mot de passe self-service.
- [ ] Ajouter preferences de notification.

**Acceptation**

- Un formateur peut suivre et relancer les apprenants depuis LORE.

---

### B-19 - Accessibilite RGAA

**Probleme audit** : pas d'audit RGAA/WCAG, pas d'axe en CI, pas de declaration d'accessibilite.

**Taches**

- [ ] Lancer un audit RGAA/WCAG.
- [ ] Corriger navigation clavier, landmarks, skip-link et contrastes.
- [ ] Ajouter tests axe en CI.
- [ ] Rediger declaration d'accessibilite.
- [ ] Documenter limites et plan de correction.

**Acceptation**

- LORE peut etre presente avec une declaration d'accessibilite exploitable.

---

### B-20 - Integrations standards LMS et SSO

**Probleme audit** : OIDC verify-only incomplet ; pas de SAML, LTI, xAPI/LRS, webhooks signes.

**Taches**

- [ ] Completer OIDC : discovery, JWKS, rotation, validation `iss/aud`.
- [ ] Etudier puis prioriser SAML et FranceConnect.
- [ ] Ajouter webhooks signes et retries.
- [ ] Evaluer xAPI/LRS et LTI selon besoins clients.
- [ ] Documenter scopes, claims et rotation de secrets.

**Acceptation**

- LORE peut s'integrer proprement dans un SI formation.

---

### B-21 - Durcir exploitation production

**Probleme audit** : sauvegardes manuelles, `/metrics` non protege, HSTS/CSP absents, pas de HA ni `SECURITY.md`.

**Taches**

- [ ] Automatiser sauvegardes Postgres et fichiers generes.
- [ ] Ajouter restauration testee.
- [ ] Proteger `/metrics`.
- [ ] Ajouter HSTS/CSP dans Caddy.
- [ ] Documenter HA/replication ou limites mono-noeud.
- [ ] Ajouter `SECURITY.md` et procedure de divulgation.

**Acceptation**

- Une exploitation prod basique est documentee, sauvegardee et testable.

---

### B-22 - Reporting operationnel OF

**Probleme audit** : les dashboards actuels ne produisent pas les exports utiles a la gestion OF.

**Taches**

- [ ] Ajouter taux de completion par cohorte/session.
- [ ] Ajouter progression par apprenant.
- [ ] Ajouter alertes retard/inactivite.
- [ ] Ajouter tableau des evaluations et scores.
- [ ] Ajouter exports CSV/Excel filtrables.

**Acceptation**

- Un responsable pedagogique peut piloter une cohorte sans requete technique.

---

## Ajouts v3 - couverture LMS generaliste

Source : cadrage produit (juin 2026) listant les elements de base attendus d'un
LMS agentique. Les blocs deja couverts par B-01..B-22 ne sont pas dupliques ;
les items ci-dessous comblent les trous restants.

### B-23 - Inscription self-service et en masse

**Probleme** : inscription uniquement unitaire par un admin ; pas d'auto-inscription par lien/code de cohorte, import CSV toujours manquant (reste de B-12).

**Taches**

- [ ] Lien/code d'invitation par cohorte avec expiration.
- [ ] Auto-inscription apprenant avec validation admin optionnelle.
- [ ] Import CSV apprenants + inscriptions (consolide le reste de B-12).
- [ ] Desinscription et transfert en masse.
- [ ] Journaliser ces operations dans l'audit log admin.

**Acceptation**

- Un OF remplit une cohorte de 50 apprenants sans saisie unitaire.

---

### B-24 - Parcours editoriaux sequences au-dessus du runtime

**Probleme** : le parcours est implicite (DAG de concepts + decisions runtime). Pas de modules/sequences visibles, pas de deblocage conditionnel lisible, pas de structure blended (presentiel + asynchrone) navigable.

**Taches**

- [ ] Modeliser modules/sequences lies au syllabus : ordre, prerequis, conditions de deblocage.
- [ ] Rattacher aux modules : activites runtime, evaluations, ressources (B-17), sessions presentiel/visio.
- [ ] Vue apprenant du parcours : progression par module, modules verrouilles/ouverts, prochaine etape.
- [ ] Vue formateur d'edition du parcours (sequencage, conditions).
- [ ] Conditions de completion par module alimentant attestation (B-09) et reporting (B-22).

**Acceptation**

- Un formateur construit un parcours sequence blended visible ; le runtime adaptatif opere a l'interieur des modules sans casser le sequencage.

**Depend de** : B-16 (curation) souhaitable, B-17 pour les ressources.

---

### B-25 - Planning, calendrier et visioconference

**Probleme** : les sessions existent (date, lieu, URL video) mais sans vue calendrier, sans export, sans integration visio reelle.

**Taches**

- [ ] Vue calendrier admin/formateur/apprenant (sessions, echeances d'evaluation).
- [ ] Export ICS par utilisateur et par cohorte.
- [ ] Champs visio structures (Teams, Zoom, BBB) + bouton rejoindre depuis LORE.
- [ ] Relier la presence en session visio a l'emargement (B-07).
- [ ] Rappels automatiques avant session (depend des notifications B-18).

**Acceptation**

- Le planning d'une cohorte est consultable et exportable ; une session synchrone se rejoint en un clic.

---

### B-26 - Banque de questions, devoirs et correction manuelle

**Probleme** : l'evaluation se limite au concept-check genere (B-06). Pas de banque de questions par tenant, pas de devoirs deposes, pas de correction manuelle.

**Taches**

- [ ] Banque de questions tenant-scopee (QCM, reponse courte), editable formateur, versionnee.
- [ ] Assemblage de quiz/examens depuis la banque, lies aux concepts du domaine.
- [ ] Devoirs avec depot de fichier et date limite.
- [ ] File de correction manuelle formateur : note, feedback, statut.
- [ ] Fusionner les scores manuels dans le runtime (BKT) et les preuves (B-08).

**Acceptation**

- Un formateur evalue avec ses propres questions et corrige des devoirs ; les notes alimentent progression, preuves et attestations.

**Depend de** : B-06 (fait), B-16.

---

### B-27 - Permissions granulaires et role gestionnaire

**Probleme** : 4 roles fixes ; pas de distinction gestionnaire administratif vs admin technique, pas de multi-roles, pas de permissions par capacite.

**Taches**

- [ ] Matrice de permissions par capacite (gerer users, gerer parcours, voir reporting, exporter preuves...).
- [ ] Role GESTIONNAIRE (administratif sans configuration technique).
- [ ] Multi-roles par utilisateur et par tenant.
- [ ] Verifications backend par capacite, pas seulement par role.

**Acceptation**

- Un gestionnaire gere inscriptions et documents sans acces a la configuration technique.

---

### B-28 - Consentement et base legale RGPD

**Probleme** : B-14 couvre export/effacement, mais pas le recueil du consentement ni les mentions legales par tenant.

**Taches**

- [ ] CGU/mentions/politique de confidentialite par tenant, versionnees.
- [ ] Recueil et registre des consentements a la premiere connexion.
- [ ] Acces self-service de la personne a ses donnees (lie a l'export B-14).

**Acceptation**

- Le consentement est trace et opposable ; les mentions sont a jour par tenant.

**Depend de** : B-14.

---

## Chantier transverse UX - ecrans, navigation, parcours utilisateurs

**Probleme** : les ecrans actuels sont des surfaces de demonstration honnetes mais pas un produit : navigation minimale, hierarchisation faible, console admin rudimentaire, pas d'onboarding, parcours utilisateurs incomplets.

Ce chantier est transverse : chaque vague fonctionnelle doit livrer ses ecrans au niveau cible, en s'appuyant sur `docs/product-design` et `docs/front-product-design-workflow.md`.

### UX-01 - Architecture d'information et navigation

- [ ] Arborescence cible par role : menus, sous-menus, breadcrumbs, recherche.
- [ ] Apprenant : accueil / mon parcours / agenda / evaluations / documents / messages.
- [ ] Formateur : cohortes / parcours / correction / emargement / rapports / messages.
- [ ] Admin-gestionnaire : utilisateurs / inscriptions / catalogue / sessions / conformite (preuves, attestations, satisfaction) / parametres.
- [ ] Hierarchiser chaque ecran : action principale unique, informations secondaires repliees.

### UX-02 - Design system et etats

- [ ] Tokens (couleurs, typo, espacements) et composants partages (tables, formulaires, modales, toasts).
- [ ] Etats vides, chargement et erreur systematiques sur chaque ecran.
- [ ] Responsive (tablette minimum) ; jalons RGAA en lien avec B-19.

### UX-03 - Parcours utilisateurs de bout en bout

- [ ] Onboarding premiere connexion par role (apprenant invite -> mot de passe -> consentement -> parcours).
- [ ] Parcours admin : creer programme -> cohorte -> inscrire -> planifier -> suivre -> exporter preuves, sans impasse.
- [ ] Parcours formateur : construire parcours -> suivre cohorte -> corriger -> emarger -> rapport.
- [ ] Tests e2e par parcours (pas seulement par ecran).

**Acceptation globale UX**

- Un utilisateur de chaque role accomplit ses taches courantes sans documentation ni aide exterieure.

---

## Ordre recommande d'execution

### Vague A - rendre le socle utilisable et sur

- [ ] B-02 - Endpoints de liste backend.
- [ ] B-04 - RLS prod.
- [ ] B-05 - Auth fail-closed et anti-bruteforce.
- [ ] B-01 - Vrai contenu dans l'UI apprenant.

### Vague B - sortir du mode demo mono-tenant

- [ ] B-03 - Tenant de session frontend.
- [ ] B-12 - CRUD admin minimal et sessions.
- [ ] B-07 - Suivi du temps.

### Vague B' - rendre le produit navigable (UX + parcours visibles)

Transverse : a partir d'ici, chaque vague livre ses ecrans au niveau UX cible.

- [ ] UX-01 - Architecture d'information et navigation par role.
- [ ] UX-02 - Design system et etats.
- [ ] B-24 - Parcours editoriaux sequences.
- [ ] B-23 - Inscription self-service et en masse.
- [ ] B-25 - Planning, calendrier, visio.

### Vague C - produire des preuves pedagogiques

- [ ] B-06 - Evaluation corrigee.
- [ ] B-26 - Banque de questions, devoirs, correction manuelle.
- [ ] B-13 - Positionnement.
- [ ] B-22 - Reporting operationnel.
- [ ] UX-03 - Parcours utilisateurs de bout en bout.

### Vague D - rendre le dossier OF defendable

- [ ] B-08 - Export Qualiopi/RNQ.
- [ ] B-09 - Attestation conforme.
- [ ] B-10 - Documents contractuels.
- [ ] B-11 - Satisfaction et reclamations.
- [ ] B-14 - RGPD complet.

### Vague D' - conformite des personnes

- [ ] B-28 - Consentement et base legale RGPD.
- [ ] B-27 - Permissions granulaires et role gestionnaire.

### Vague E - rendre le produit scalable et integrable

- [ ] B-15 - Financeurs et BPF.
- [ ] B-16 - Curation formateur.
- [ ] B-17 - Ressources pedagogiques.
- [ ] B-18 - Communication.
- [ ] B-19 - RGAA.
- [ ] B-20 - Integrations LMS/SSO (OIDC complet, SAML, SCORM/xAPI/LRS, webhooks).
- [ ] B-21 - Exploitation production.

---

## Definition of done globale

LORE peut etre considere exploitable par un OF francais quand :

- un apprenant consomme un contenu reel, tenant-scope, non hard-code ;
- une evaluation corrigee produit une preuve d'acquisition ;
- les heures, presences, progressions et attestations sont exportables ;
- un admin gere utilisateurs, cohortes, inscriptions, sessions et corrections courantes ;
- la production est fail-closed, tenant-isolee et sauvegardee ;
- un dossier Qualiopi/RNQ peut etre exporte sans manipulation technique ;
- les obligations RGPD minimales sont traitees de bout en bout ;
- le seed de demo n'est plus dans le chemin critique produit.
