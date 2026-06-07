# Guide formateur — LORE

Ce guide explique le travail du **formateur** dans LORE. Il insiste d'abord sur le
modèle, car il est différent d'un LMS classique.

## 1. Le modèle IA-first : vous ne construisez pas de cours

Dans LORE, **vous n'assemblez pas de cours, de ressources, de SCORM ni de quiz**.
Vous faites deux choses :

1. vous **rédigez un syllabus** — une *intention* pédagogique : un titre, une
   description, des **objectifs** et des **acquis visés** (outcomes) ;
2. vous **rattachez** ce syllabus à une **cohorte** (le *binding*).

À partir de là, le **moteur pédagogique** et le LLM **génèrent le parcours de
chaque apprenant** : sélection du prochain concept, planification d'activité,
mise à jour de la maîtrise, planification des révisions, détection des
misconceptions et des alertes. **Le moteur est la source de vérité** : ni
l'interface, ni le LLM, ni vous ne décidez « manuellement » de la progression.
Si le LLM est indisponible, le moteur retombe sur un contenu *instruction-only*
et reste utilisable.

Votre rôle au quotidien est donc d'**autoriser l'intention** (le syllabus) puis de
**superviser** la santé de la cohorte et d'**intervenir** quand le moteur signale
un problème — pas de produire du contenu.

Public : rôle `TRAINER`. Espace : `/trainer`.

---

## 2. Rédiger un syllabus

Un syllabus est porté par le backend et créé via votre console formateur
(`POST /api/syllabi`). Il contient :

- un **titre** et une **description** (l'intention) ;
- des **objectifs** (`objectives`) ;
- des **acquis visés** (`outcomes`).

Exemple de syllabus (issu de la démo) : *« Production-grade Go persistence »* —
*« Author durable, transactional persistence for a Go backend… »*, avec des
acquis comme « ouvrir et réutiliser un pool de connexions sans fuite »,
« encadrer des écritures multi-étapes dans une transaction avec rollback
correct », etc.

Le syllabus s'appuie sur un **domaine** (un graphe de concepts, le DAG) déjà
défini dans le tenant : c'est l'ossature de la console formateur. Les objectifs
référencent des concepts de ce domaine.

---

## 3. Rattacher une cohorte (binding) et le parcours se génère

Une fois le syllabus prêt, **rattachez-le à une cohorte**
(`POST /api/syllabi/bind`) en précisant :

- `target_type` (ex. `COHORT`) et `target_id` (l'id de la cohorte) ;
- l'**`adaptation_mode`** (ex. `GUIDED`) — le degré d'adaptation laissé au moteur.

Le rattachement émet `SyllabusBound`. **À partir de ce binding, le moteur + le LLM
génèrent le parcours de chaque apprenant inscrit** dans la cohorte. Vous n'avez
rien d'autre à « publier ».

> Les **programmes**, **cohortes** et **inscriptions** sont gérés par
> l'administrateur (voir le [Guide administrateur](guide-administrateur.md)). Vous
> rattachez votre intention pédagogique à une cohorte qu'il a préparée.

---

## 4. Versions et re-rattachement

Un syllabus a une **version**. Faire évoluer l'intention (nouveaux objectifs,
acquis reformulés) crée une nouvelle version ; le **re-rattachement** (rebind)
relie la cohorte à la version voulue. Le moteur prend en compte le binding
courant pour générer le parcours. Le graphe de domaine (DAG) porte aussi un
**`graph_version`** : faire évoluer les concepts/dépendances en change la version,
ce qui est tracé.

---

## 5. Superviser la santé de la cohorte et les alertes

La console `/trainer` agrège, **en lecture directe depuis le moteur** :

- le **graphe de domaine** (concepts + dépendances) — l'ossature ;
- des **analytics de cohorte** (maîtrise moyenne, misconceptions actives…) —
  **calculés par le moteur** (BKT), jamais recalculés par l'interface ;
- les **alertes** : révisions dues, faible rétention, plateau, dérive de ZPD,
  surcharge, prêt-à-évaluer, risque apprenant, misconception — avec
  déduplication par tenant.

Pour chaque apprenant, la console montre : concepts suivis, maîtrise moyenne,
rétention moyenne, cartes en *relearning*, révisions dues, alertes ouvertes, et
si une **misconception active** existe (alerte de type *misconception* ouverte —
c'est ce qui rend disponible une intervention de **réparation**).

---

## 6. Inspecter un apprenant

Depuis la console, ouvrez le détail d'un apprenant pour voir son **état runtime**
(par concept : maîtrise, rétention, état de carte), ses **snapshots
pédagogiques** (l'observation + la décision prises par le moteur, p. ex. le type
d'erreur d'une misconception) et ses **alertes**. Vous **observez** la décision du
moteur ; vous ne réécrivez pas la progression.

---

## 7. Émargement (attendance)

Espace : `/trainer/emargement` (« Émargement / Attendance »).

1. Choisissez une **date de session** pour la cohorte.
2. Pour chaque apprenant inscrit, marquez **présent / absent**. La présence est
   persistée (`POST /api/attendance`, horodatée et marquée *trainer-marked*).
3. La *roster* réunit les apprenants inscrits (issus des événements
   `LearnerEnrolled` de la cohorte) avec leurs noms.

**Feuille d'émargement PDF.** Téléchargez la *feuille d'émargement* d'une session
via `GET /api/attendance/sheet?cohort=<id>&date=YYYY-MM-DD` : un PDF A4 français
listant les apprenants et leur statut, en-tête OF + cohorte. Réservé aux rôles
formateur/administrateur.

---

## 8. Délivrer une attestation

Une **attestation de fin de formation (PDF)** est générée à partir de l'**état
réel** du moteur :

- `GET /api/certificates?learnerId=<id>` ;
- un formateur (ou admin) peut télécharger l'attestation de **tout apprenant de
  son tenant** (un apprenant ne peut récupérer **que la sienne**).

Le PDF contient l'organisation, l'apprenant, le **titre du programme** (le
syllabus rattaché), la **période** (de la première à la dernière interaction
enregistrée) et les **concepts** avec leur maîtrise/rétention, triés du plus
maîtrisé au moins maîtrisé. Les données sont **réelles** (lues depuis l'état du
moteur et le graphe de domaine), jamais inventées.

---

## 9. Récapitulatif

| Tâche | Où / Comment |
|-------|--------------|
| Rédiger un syllabus (intention) | console `/trainer` → `POST /api/syllabi` |
| Rattacher une cohorte (binding) | `POST /api/syllabi/bind` (émet `SyllabusBound`) |
| Versionner / re-rattacher | nouvelle version du syllabus + rebind |
| Superviser cohorte + alertes | `/trainer` (analytics + alertes du moteur) |
| Inspecter un apprenant | détail apprenant (états, snapshots, alertes) |
| Émargement + feuille PDF | `/trainer/emargement`, `/api/attendance/sheet` |
| Attestation PDF | `/api/certificates?learnerId=…` |

Voir aussi : [Guide administrateur](guide-administrateur.md),
[Guide apprenant](guide-apprenant.md).
</content>
