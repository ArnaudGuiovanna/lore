# Parcours par rôle — du login à la fin (langage LECTURE)

Trois parcours utilisateur complets pour **LORE** (LMS headless, runtime-first), dans la direction
de design retenue **LECTURE** (papier chaud, Newsreader/Fraunces/Spline Sans Mono, calme éditorial,
faible charge cognitive). Chaque parcours va de la **page de connexion** (auth LORE, rôle **dérivé de
la membership**, jamais demandé par le client) jusqu'à sa fin.

| Rôle | Doc | Snapshot figé | Surface |
|---|---|---|---|
| **Apprenant** | [01-apprenant.md](01-apprenant.md) | [html/journey-apprenant.html](html/journey-apprenant.html) | Lecture générative + **provenance** du parcours |
| **Formateur** | [02-formateur.md](02-formateur.md) | [html/journey-formateur.html](html/journey-formateur.html) | **Syllabus-first** : authoring → bind → génération + **versions/rebind** |
| **Administrateur** | [03-admin.md](03-admin.md) | [html/journey-admin.html](html/journey-admin.html) | Plan de contrôle (sans propriété du syllabus) |

## Le modèle qui structure tout : le syllabus

LORE n'est pas un LMS de cours/ressources. Le pivot du produit est le **syllabus**, et il appartient
au **FORMATEUR** :

```
FORMATEUR rédige un syllabus (intention : title, description, objectives, outcomes — PAS de cours,
   PAS de ressources)
        └─ attache une cohorte  (SyllabusBinding: target_type=COHORT, adaptation_mode=GUIDED)
                └─ le RUNTIME + LLM génèrent le parcours sur le graphe de concepts
                        ├─ runtime décide l'ordre/progression  («runtime decided»)
                        └─ LLM remplit le contenu par activité   («llm generated», jetable)
                                └─ APPRENANT lit son parcours, et peut en VOIR la provenance
                                   (lecture seule : cohorte → syllabus → objectif/acquis)
```

- **Append-only** : un syllabus est immuable. Endpoints réels : `POST /v1/tenants/{t}/syllabi`
  (event `SyllabusCreated`) et `POST /v1/tenants/{t}/syllabi/{id}/bindings` (event `SyllabusBound`).
  Il n'y a **ni PUT ni champ version** : « éditer » = **forker une nouvelle version** (nouveau
  `Syllabus`) puis **rebind** la cohorte. Le versioning est un concept produit par-dessus l'append-only.
- **Runtime-first** : le runtime possède l'état durable (mastery BKT, rétention FSRS, snapshots). Un
  rebind change l'**intention en avant** ; l'état en cours est **préservé**, le runtime re-planifie.
- **Admin ≠ propriétaire du syllabus** : l'admin gère tenant/identité/structure-org/graphe/LLM/outbox,
  et voit les bindings en **lecture seule** pour la gouvernance.

Voir aussi le mémo de session `lore-syllabus-role-model` et le
[Front Product Design Workflow](../../front-product-design-workflow.md) du dépôt.

## Statut

- Snapshots figés dans [`html/`](html/) (identiques aux versions servies sous
  `docs/mockups/variants/`), empreintes dans `html/SHA256SUMS.txt`.
- Vérifiés en navigateur réel (login → rôle dérivé, interactions signature de chaque rôle, provenance,
  fork v2 + rebind). 0 erreur JS hors favicon/CDN polices. Verdicts critique : 92–95 / 100.
