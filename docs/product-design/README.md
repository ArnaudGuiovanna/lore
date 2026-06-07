# Product Design — Itérations ZEN (lecture & charge cognitive)

Quatre propositions de design front pour **LORE** (LMS headless, runtime-first), toutes dérivées de
la direction retenue **ZEN** : _« le prompt est le runtime »_ poussé à son extrême le plus calme et
le plus lisible — la réponse se **génère plein-écran** pour faciliter la lecture et réduire la charge
cognitive.

Chaque itération pousse un **levier de charge cognitive distinct**, mais partage le même cœur :
vide amorcé par **une** intention runtime · coups **sanctionnés** (jamais un chat libre) · génération
**streamée** comme héros · marques discrètes **runtime-decided vs llm-generated** · **fallback
instruction-only** (survie sans LLM) · boucle _preuve → delta → intention suivante_ comme un souffle.

Scénario commun (fixture) : **Amara Okafor** doit réparer le concept `persistence`
(misconception `forgot-tx-rollback`) avant de débloquer `transactions`, en **récupération de surcharge**.

| # | Product design | Levier de charge cognitive | Doc | Mockup figé |
|---|---|---|---|---|
| 01 | **LECTURE** — l'essai typographié | **Flux** : une colonne ~62ch, lecture continue | [01-LECTURE.md](01-LECTURE.md) | [html/focus-zen-lecture.html](html/focus-zen-lecture.html) |
| 02 | **PROJECTEUR** — la lecture guidée au faisceau | **Attention** : une seule unité éclairée à la fois | [02-PROJECTEUR.md](02-PROJECTEUR.md) | [html/focus-zen-spotlight.html](html/focus-zen-spotlight.html) |
| 03 | **SOUFFLE** — un battement par écran | **Segmentation** : une idée par écran | [03-SOUFFLE.md](03-SOUFFLE.md) | [html/focus-zen-souffle.html](html/focus-zen-souffle.html) |
| 04 | **VEILLEUSE** — l'environnement de lecture apaisé | **Environnement** : charge sensorielle / contraste | [04-VEILLEUSE.md](04-VEILLEUSE.md) | [html/focus-zen-nuit.html](html/focus-zen-nuit.html) |

## Comment lire ces quatre

Les leviers ne sont pas concurrents au même niveau :

- **LECTURE · PROJECTEUR · SOUFFLE** sont trois **traitements de la surface de lecture** (flux continu /
  attention focalisée / segmentation) — on en **choisit un**.
- **VEILLEUSE** est un levier **orthogonal** (environnement sensoriel + accessibilité) — c'est une
  **couche à fusionner** par-dessus le traitement choisi.

**Piste de fusion évoquée** : **PROJECTEUR** comme base (le levier d'attention colle au contexte de
récupération de surcharge d'Amara) **+ les contrôles de confort de VEILLEUSE** (taille / mesure /
nuit-sépia) par-dessus. _Décision laissée ouverte._

## Statut

- Les 4 mockups sont **figés** dans [`html/`](html/) (snapshots indépendants des versions vivantes
  servies sous `docs/mockups/variants/`).
- Vérifiés en navigateur réel (streaming reading-paced, fallback, boucle, contrôles de confort) —
  0 erreur JS hors favicon. Verdicts critique : **91–93 / 100**, confort de lecture **9/10**, charge
  cognitive **9/10**.
- Empreintes d'intégrité : voir `html/SHA256SUMS.txt`.

## Parcours par rôle (direction retenue : LECTURE)

LECTURE a été retenue et étendue à tout le produit en **parcours complets par rôle** (login → fin),
documentés et figés dans [`journeys/`](journeys/) :

- [journeys/README.md](journeys/README.md) — vue d'ensemble + le **modèle syllabus** qui structure tout
  (le formateur rédige le syllabus → attache une cohorte → le runtime+LLM génèrent le parcours).
- [Apprenant](journeys/01-apprenant.md) — lecture générative + **provenance** (cohorte → syllabus → objectif/acquis, lecture seule).
- [Formateur](journeys/02-formateur.md) — **syllabus-first** + cycle de versions (éditer = forker une v2 append-only, historique, **rebind** avec review d'impact).
- [Administrateur](journeys/03-admin.md) — plan de contrôle, **sans** propriété du syllabus.

## Cadre de référence

Voir le [Front Product Design Workflow](../front-product-design-workflow.md) du dépôt et la
[galerie complète](../mockups/index.html) (19 maquettes, toutes directions).
