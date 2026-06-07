# Parcours APPRENANT — lecture générative + provenance du parcours

> **Rôle : LEARNER** (Amara Okafor, `learner-1`) · langage **LECTURE** · du login à la fin de session
> _« Tu lis ton parcours — et tu peux voir d'où il vient, sans pouvoir le changer. »_

- **Snapshot figé** : [`html/journey-apprenant.html`](html/journey-apprenant.html) (≈ 2247 lignes)
- **Version vivante** : `/mockups/variants/journey-apprenant.html`
- **Identité** : amara@acme.test · rôle **dérivé de la membership** · tenant Acme · cohorte Go-Spring-24 · `instruction_only`

---

## 1. Le parcours (étapes)

0. **Login** — sign-in LORE (email + SSO/OIDC), puis beat de **résolution de session** : vérif RS256 (verify-only) → lookup membership → **rôle dérivé LEARNER** → scope cohorte + résolution tutor = `instruction_only`.
1. **NOW** — atelier de lecture LECTURE : vide amorcé par **une** intention runtime (« repair persistence before advancing — retention 0.38, review overdue 2d », marque `runtime decided`, note de récupération de surcharge). `⏎` / `/start` → prise plein-écran qui **streame** la pratique au rythme de lecture (colonne ~62ch Newsreader, bloc Go aéré). learner-1 étant `instruction_only`, le **fallback** (scaffold runtime numéroté, marques ambre) est le chemin par défaut — fidèle à son override.
2. **Delta dans la colonne** — après soumission de la preuve : maîtrise 0.41 → 0.47, misconception toujours active, rétention reprogrammée, `transactions` toujours verrouillé. Jamais une modale.
3. **Reviews** — file de révisions espacées FSRS (due/overdue).
4. **Progress** — signaux honnêtes maîtrise/rétention/calibration (pas de barres de vanité) + état de surcharge + prérequis verrouillé.
5. **History** — timeline de snapshots pédagogiques (before/observation/after/rationale).
6. **Fin** — clôture sereine, repli sur une seule ligne calme.

## 2. L'ajout de cette étape : la PROVENANCE (lecture seule)

L'apprenant peut désormais **voir que son parcours vient du syllabus de sa cohorte**, sans pouvoir le modifier.

- **Sur NOW** : un ruban discret « from your cohort's syllabus · Production-grade Go persistence » + un bouton **« › why this path? »**.
- Le bouton déplie un **panneau de lignée** LECTURE, calme, replié par défaut (révélé à la demande, charge cognitive non augmentée). Chaîne verticale :

```
cohorte Go-Spring-24
   └─ syllabus « Production-grade Go persistence » (syl-7f3c)
        rédigé par le formateur R. Köhler · adaptation_mode GUIDED · via SyllabusBound
        └─ ce concept « persistence »
             sert l'OBJECTIF {persistence}
             et l'ACQUIS « writes a handler that persists in a transaction and rolls back on error »
             └─ le RUNTIME a planifié cette étape (runtime decided)
                  └─ le contenu est instruction-only / runtime-authored
                     (le LLM, quand il est actif, ne remplit que le contenu — jamais le chemin)
```

- **Repris sur PROGRESS** : titre « Your path — and where you stand on it », bannière « generated from the syllabus of Go-Spring-24 », et une ligne « serves … » sous chaque concept le reliant à l'objectif/acquis qu'il sert (ou marquant honnêtement les prérequis ajoutés par le runtime et le travail de rétention hors-objectif).

## 3. Fidélité au modèle

- **Lecture seule, assumée** : chip « read-only » + ligne de clôture « You can see this lineage; only your trainer can change it. » Aucun contrôle d'authoring n'est introduit côté apprenant.
- **Lignée réelle vs trace présentationnelle** : le lien cohorte → syllabus est **réel** (binding `SyllabusBound`, `syl-7f3c`, `GUIDED`). Le mapping activité → objectif/acquis est honnêtement présenté comme une **trace de provenance** (pas un champ stocké : le runtime planifie sur le graphe de concepts).
- **Append-only rappelé** : le pied du panneau précise qu'un syllabus n'est jamais édité en place — une révision du formateur **forke une version** et **rebind** la cohorte, et l'état de l'apprenant (maîtrise/révisions/snapshots) est **préservé** pendant que le runtime re-planifie. → cf. [02-formateur.md](02-formateur.md).
- **Runtime-first** : la lignée sépare explicitement « runtime decided » (cohorte, binding, planification de l'étape sur le DAG en pesant maîtrise/rétention/misconception) du nœud de contenu jetable « instruction-only ».

## 4. Interaction signature (vérifiée en navigateur)

« why this path? » sur NOW ouvre/ferme le panneau de lignée en vanilla JS : reveal max-height/opacity, `aria-expanded`, chevron, scroll-into-view ; `Escape` referme et rend le focus ; auto-repli au retour sur NOW. _Vérifié live : hidden→visible, aria-expanded false→true, 5 nœuds de lignée, 5 lignes « serves » sur Progress, repli propre. 0 erreur JS (hors CDN polices)._

## 5. États / accessibilité

Reveal collapsé par défaut, `prefers-reduced-motion`, `focus-visible`, `ol/region/aria` sémantiques, retour focus sur fermeture. Provenance additive — la boucle de lecture existante est intacte.

---

_Verdict critique : 9/10 — objectif atteint, append-only fidèle, runtime-first, LECTURE cohérent, parcours complet, 0 erreur JS._
