# SOUFFLE — un battement par écran

> **Itération ZEN · levier de charge cognitive : la SEGMENTATION (chunking)**
> _« Une idée par écran. Jamais deux. La boucle comme une respiration. »_

- **Mockup figé** : [`html/focus-zen-souffle.html`](html/focus-zen-souffle.html)
- **Version vivante** (funnel) : `/mockups/variants/focus-zen-souffle.html`
- **Persona** : Amara Okafor (learner-1) · Acme Learning › Backend Engineering 2026 › Go-Spring-24
- **Contexte runtime** : réparer `persistence` (0.41 ↓, rétention 0.38, révision en retard 2 j, misconception `forgot-tx-rollback`) avant `transactions`. **Récupération de surcharge.**

---

## 1. Positionnement

SOUFFLE éclate l'activité en **battements plein-écran discrets**, exactement **une idée par écran**,
avancés un à la fois. Détail d'implémentation qui porte le sens : **un seul battement est monté dans
le DOM** à la fois — les autres n'existent pas encore. L'espace est maximal, rien ne rivalise :
chaque écran est une seule pensée calme (situation → la fonction buggée seule → la question → le
champ de preuve seul → le delta d'état). La boucle « inspire / expire » est rendue **littérale**.

## 2. La thèse (levier : segmentation)

> Le chunking abaisse la charge en bornant ce que la mémoire de travail doit tenir à un instant donné.
> En ne montrant **jamais plus que la pièce courante**, on supprime l'attention divisée **et**
> l'angoisse de défilement d'un long lecteur. L'orientation passe par un **lisseré de points discret
> (« n / total »)**, pas des métriques de vanité.

## 3. Spécification de lecture (concrète)

| Paramètre | Valeur |
|---|---|
| Corps de lecture | **Newsreader 22 px**, interligne **1.74**, graisse 370 |
| Mesure | **~62 ch** (prose) / **~34 ch** (idées courtes, `.idea.measure`) |
| Titres / question | **Fraunces** 30–33 px, italiques opsz-tuned |
| Bloc de code | Spline Sans Mono 14.5 px, interligne 1.85, carte sombre aérée (max 560 px), révélé ligne par ligne |
| Encre / fond | `#211f1a` sur papier chaud `#f4efe6` (élevé mais non agressif) |
| Cadence | **~44–50 ms/mot** + souffle 300 ms après phrase, 150 ms après virgule (≠ le dump rapide de la ZEN d'origine) |
| Navigation | **Espace/Entrée/→** avance · **←** recule |
| Transition | fondu croisé + léger glissement vertical (un souffle) |

**Polices** : Newsreader (prose) · Fraunces (intention/titres/question) · Spline Sans Mono (code, statuts, badges, raccourcis). _Aucune police générique._

## 4. Le parcours (états)

1. **Vide** — vide ZEN canonique : intention runtime, champ d'invocation + caret, badge `runtime decided`, pastilles/note de surcharge retraitables. `/` révèle les **7 coups** inline ; Entrée sur champ vide = `/start`.
2. **Battement 1/5 — la situation** : prose Newsreader aérée, **streamée** depuis `claude temp 0.2`, badge `llm generated`, affordance « breathe in / Space », 4 points discrets.
3. **Battement 2/5 — le code seul** : la fonction `RecordEnrollment` buggée **seule** dans une carte sombre aérée, révélée ligne par ligne, branche d'erreur « ← leaks the tx: no `tx.Rollback()` » surlignée.
4. **Battement 3/5 — la question** : en Fraunces italique (« where must the rollback go — and what should the function still return? »), vaste blanc.
5. **Battement 4/5 — la preuve seule** : champ pré-amorcé du correctif quasi-correct, « submit evidence ⌘⏎ ».
6. **Battement 5/5 — le delta** : plein écran (maîtrise 0.41 → 0.47, misconception toujours active, rétention 0.38 → 0.52, surcharge maintenue, `transactions` verrouillé), note de clôture streamée.
7. **Souffle de clôture** — flash « void cleared · runtime selecting next move… » → repli vers une nouvelle intention (« tighten the rollback on persistence · mastery 0.47 »).
8. **Fallback instruction-only** — `/fallback` (ambre, `instruction_only`) : un **battement d'intro runtime** + un **battement scaffold 6 étapes numérotées**, puis mêmes battements question/preuve/delta.

> **Particularité** : les coups sanctionnés **n'ouvrent pas un panneau** — ils **insèrent un battement
> supplémentaire** dans la séquence (point ambre discret). Même l'aide reste « une idée par écran ».

## 5. Correspondance runtime ↔ interface

| Signal runtime | Traitement UI |
|---|---|
| `RuntimeDecision` | Intention en battement / repli ; séquence de battements pilotée par le runtime |
| `TutorInstruction` → LLM | Battement prose streamé, badge `llm generated` |
| `LearnerState` / `Snapshot` | Battement de delta dédié, jamais de barres de vanité |
| `Misconception` | Ligne « toujours active » du battement delta |
| Fournisseur off | Séquence reconstruite en scaffold runtime numéroté |

## 6. Ce qui empêche le glissement en chatbot

Pas de zone de saisie libre : `/` ouvre le jeu borné de coups, Entrée sur vide lance `/start`, et la
prose libre n'a de sens que dans le **battement de preuve**. Les coups d'aide **insèrent des
battements**, ils ne dialoguent pas.

## 7. Forces / arbitrages / quand la choisir

- **Forces** : la plus **rassurante et structurée** ; progression limpide ; excellente pour **découper une procédure** ou guider pas-à-pas.
- **Arbitrages** : plus de clics ; casse légèrement le flux d'une prose continue ; sur les battements les plus hauts, la ligne de kicker peut friser le lisseré de points (cosmétique, non bloquant). Code (1473 lignes) au-dessus de la cible, surtout du CSS pour les nombreux layouts de battements.
- **À choisir quand** : contenu **procédural / séquentiel**, ou public ayant besoin d'un cadre fort et d'un sentiment de progression net.

## 8. Questions ouvertes

- Permettre un mode « tout voir » optionnel pour les apprenants avancés ?
- Réglage du nombre de battements selon la complexité de la TutorInstruction ?
- Réconcilier les battements avec un éventuel besoin de relecture transversale ?

---

_Vérifié en navigateur : streaming ralenti (78 ms/mot après correctif), avancement Espace/→, indicateur de battement, code + badge LLM, 0 erreur JS (hors favicon). Bug corrigé en revue : le champ du vide gardait le focus et avalait Espace/Entrée → `field.blur()` rend le clavier au stepper. Verdict critique : score 91 — confort de lecture 9/10, charge cognitive 9/10._
