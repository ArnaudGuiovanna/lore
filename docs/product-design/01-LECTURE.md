# LECTURE — l'essai typographié

> **Itération ZEN · levier de charge cognitive : le FLUX de lecture**
> _« L'activité n'est pas une interface à opérer : c'est un texte à lire. »_

- **Mockup figé** : [`html/focus-zen-lecture.html`](html/focus-zen-lecture.html)
- **Version vivante** (funnel) : `/mockups/variants/focus-zen-lecture.html`
- **Persona** : Amara Okafor (learner-1) · Acme Learning › Backend Engineering 2026 › cohorte Go-Spring-24
- **Contexte runtime** : réparer `persistence` (maîtrise 0.41 ↓, rétention 0.38, révision en retard de 2 j, misconception `forgot-tx-rollback`) avant de débloquer `transactions`. Apprenante en **récupération de surcharge** après 2 échecs.

---

## 1. Positionnement

LECTURE traite la révélation plein-écran de ZEN comme **un essai long-form magnifiquement composé**.
Le contenu généré par le runtime n'est pas découpé en cartes, panneaux ou étapes : il **coule de haut en
bas dans une seule colonne**, au rythme de la lecture. On baisse la charge cognitive non pas en
fragmentant, mais en supprimant tout ce qui n'est pas le texte — l'acte d'apprendre redevient un acte
de **lecture continue**, pas l'opération d'une UI.

## 2. La thèse (levier : flux)

> Le coût cognitif d'une page vient autant de **ce qui entoure le texte** que du texte lui-même.
> En retirant panneaux, métriques de vanité et changements de contexte (modales), l'œil ne décroche
> jamais : il descend la colonne d'un seul mouvement. La décision runtime est **rétrogradée en
> chapô discret** au-dessus de la lecture ; la preuve et le delta d'état sont **repliés dans la même
> colonne**, donc aucun saut de contexte.

## 3. Spécification de lecture (concrète)

| Paramètre | Valeur |
|---|---|
| Mesure (longueur de ligne) | **~62 caractères** (colonne 39 em ≈ 741 px à 21 px) |
| Corps de lecture | **Newsreader 21 px**, interligne **1.72**, tracking +0.002em |
| Espacement paragraphe | 1.5 em · lettrine **Fraunces** sur l'attaque |
| Marges | 130 px haut / 200 px bas · gouttières latérales aérées |
| Bloc de code | sombre, padding 28×30 px, interligne 1.8 (jamais cramé) |
| Cadence de streaming | **~46 ms/mot**, pause phrase 260 ms, virgule 120 ms, inter-paragraphe ~420 ms |
| Contraste | chaud, élevé **mais doux** |

**Polices** : Newsreader (corps, le héros) · Fraunces (chapô / dek / lettrine, optical-size) · Spline Sans Mono (marques runtime/LLM, code, champ de commande, métriques). _Aucune police générique (Inter/Roboto/system-ui)._

## 4. Le parcours (états)

1. **Vide** — page calme centrée verticalement : une marque `runtime decided` entre deux filets, l'intention runtime en **chapô Fraunces**, une rangée de pastilles-métriques discrètes, la note de récupération de surcharge, et un seul caret/champ avec un murmure (« press ⏎ to begin »). _Aucun contenu apprenant pré-rendu._
2. **Coups sanctionnés** — au focus (ou `/`), une liste bornée de **7 coups** se révèle sous le champ (navigable au clavier), jamais une zone de chat ouverte.
3. **Prise plein-écran (génération)** — `/start` fait disparaître le vide (`.gone`) ; statut « generating from TutorInstruction · claude · temp 0.2 » → 6 paragraphes + bloc Go aéré + la question, **streamés mot à mot au rythme de lecture**, le statut se résolvant en marque discrète « llm generated ».
4. **Preuve** — un champ sobre **continue la colonne** (pas de modale). Le rail de coups vit en pied de page **faible, auto-masqué après 2.6 s**, ne réapparaissant que sur intention réelle (pointeur en bas / touche).
5. **Delta d'état** — révélé comme une **section de clôture sereine dans la colonne** : 5 lignes BKT/FSRS/misconception/gate (maîtrise 0.41 → 0.47, misconception toujours active, rétention reprogrammée, `transactions` toujours verrouillé) + un passage italique de clôture.
6. **Repli** — tout se replie vers un nouveau chapô runtime réécrit.
7. **Fallback instruction-only** — `/fallback` éteint le LLM (accent ambre, `instruction_only`) ; le runtime **ré-écrit la même tâche** en scaffold numéroté (6 étapes, compteurs `0x`), à pleine mesure lisible, avec le même champ de preuve. _L'UI survit sans LLM._

## 5. Correspondance runtime ↔ interface

| Signal runtime | Traitement UI |
|---|---|
| `RuntimeDecision` (intention) | Chapô Fraunces autoritaire + marque `runtime decided` |
| `TutorInstruction` → contenu LLM | Prose streamée, marque discrète `llm generated` (jetable, régénérable) |
| `LearnerState` (mastery/retention) | Pastilles-métriques discrètes au-dessus, jamais des barres de vanité |
| `Misconception` | Ligne de delta « toujours active » |
| Bascule fournisseur off | `/fallback` → scaffold runtime numéroté |

## 6. Ce qui empêche le glissement en chatbot

Les entrées sont strictement **(a)** le jeu borné de 7 coups sanctionnés et **(b)** la réponse de preuve.
La liste de coups n'apparaît qu'à l'intention et reste navigable au clavier — **jamais un champ
« demandez-moi n'importe quoi »**. La prose libre n'a de sens que comme preuve.

## 7. Forces / arbitrages / quand la choisir

- **Forces** : lecture la plus naturelle et fluide ; idéale pour du **contenu explicatif long** ; zéro rupture de flux (lecture → preuve → delta → repli dans un seul défilement).
- **Arbitrages** : sur de très longs blocs, l'œil peut se perdre faute de guidage ponctuel ; demande une bonne hygiène de longueur côté génération.
- **À choisir quand** : le contenu est principalement narratif/conceptuel et qu'on veut une expérience « lire un essai qui enseigne ».

## 8. Questions ouvertes

- Plafonner la longueur générée par écran pour éviter le mur de texte ?
- Ajouter un repère de progression de lecture **non-vaniteux** (filet fin) sans casser le flux ?
- Fusion possible avec les **contrôles de confort** de VEILLEUSE (taille/mesure) ?

---

_Vérifié en navigateur : Newsreader 21px / interligne 1.72 / colonne ~62ch, streaming + badge LLM + code, 0 erreur JS (hors favicon). Verdict critique : score 93 — confort de lecture 9/10, charge cognitive 9/10._
