# PROJECTEUR — la lecture guidée au faisceau

> **Itération ZEN · levier de charge cognitive : l'ATTENTION**
> _« Jamais plus d'une idée pleinement éclairée. Tout le reste se retire. »_

- **Mockup figé** : [`html/focus-zen-spotlight.html`](html/focus-zen-spotlight.html)
- **Version vivante** (funnel) : `/mockups/variants/focus-zen-spotlight.html`
- **Persona** : Amara Okafor (learner-1) · Acme Learning › Backend Engineering 2026 › Go-Spring-24
- **Contexte runtime** : réparer `persistence` (0.41 ↓, rétention 0.38, révision en retard 2 j, misconception `forgot-tx-rollback`) avant `transactions`. **Récupération de surcharge** — d'où la pertinence pédagogique d'un faisceau qui ne montre qu'une chose à la fois.

---

## 1. Positionnement

PROJECTEUR décompose la lecture en **unités adressables** (chaque phrase ; chaque ligne de code ;
chaque étape de scaffold ; chaque ligne de delta). À tout instant, **exactement une unité est
pleinement éclairée** ; le déjà-lu **se retire** (opacité basse, léger flou — présent pour le
contexte) ; le non-révélé est **absent** (`display:none`). Un pointeur-faisceau (`spotIdx`) avance
unité par unité : l'apprenante ne tient **jamais plus d'une idée en mémoire de travail**.

## 2. La thèse (levier : attention)

> La charge extrinsèque vient de l'attention divisée. La réponse la plus radicale n'est pas d'aérer
> mais de **retirer physiquement** tout sauf l'idée courante. Le faisceau supprime le balayage,
> l'angoisse de défilement et la tentation de sauter en avant. Et — point décisif pour la charge —
> **le tempo est rendu à l'apprenante** : avancer/reculer à la main abaisse encore la charge.

## 3. Spécification de lecture (concrète)

| Paramètre | Valeur |
|---|---|
| Corps de lecture | **Spectral 21 px**, interligne **1.78** |
| Mesure | **62 caractères** (centre de la cible 58–68) |
| Texte éclairé | `#f3efe6` doux sur salle de lecture quasi-noire **`#0e1311`** |
| Texte retiré (lu) | `#6f7a73` à **opacité 0.34 + flou 0.4 px** (contexte sans concurrence) |
| Marges | 96 px haut / 140 px bas · rythme paragraphe 1.15 em |
| Cadence | **longueur-consciente** : 520 ms + 230 ms/mot (1.2–4.2 s/unité), code 0.65–0.95 s/ligne, `scrollIntoView({block:'center'})` recentre le faisceau |
| Pilotage | **Espace/Entrée** avance · **↑** recule · **P/clic** bascule l'auto |
| Repère | filet de progression 2 px (sans chiffres de vanité) ; « n / total » uniquement dans la pastille de tempo |

**Polices** : Spectral (toute la prose) · Spline Sans Mono (code, commandes, statut, métriques). _Aucune police générique._

## 4. Le parcours (états)

1. **Vide (salle sombre)** — une ligne d'intention runtime, marque `runtime decided`, pastilles-métriques, note de surcharge, un champ d'invocation à caret clignotant. Le focus **assombrit tout le chrome** (`.dim` → opacité 0.1) : ne restent que la ligne + le champ.
2. **Focus** — la liste des **7 coups bornés** se révèle inline (les indisponibles grisés tant qu'aucune pratique n'existe).
3. **Lecture au faisceau** — `/start` : prise plein-écran, statut « generating… · claude · temp 0.2 » → marque `llm generated`, puis les phrases d'intro éclairées **une à une**.
4. **Faisceau sur le code** — la fonction Go `RecordEnrollment` buggée révélée **ligne par ligne** (la ligne d'erreur « sans `tx.Rollback()` » marquée), sous la même loi de retrait.
5. **Pied résolu** — 6 chips de coups + **une seule question focalisée** et un champ pré-rempli (le correctif `tx.Rollback()`).
6. **Delta d'état** — voile, lignes **éclairées une à une** (maîtrise 0.41 → 0.47, misconception toujours active, rétention reprogrammée, `transactions` verrouillé) → repli (souffle) vers l'intention suivante.
7. **Fallback instruction-only** — `/fallback` (mode ambre `instruction_only`) : la même tâche en **scaffold numéroté `00–05`**, **éclairé étape par étape** sous la même loi. Statut « runtime author · instruction_only ».

## 5. Correspondance runtime ↔ interface

| Signal runtime | Traitement UI |
|---|---|
| `RuntimeDecision` | Ligne d'intention + `runtime decided` ; `/why` éclaire une rationale **runtime, autoritaire** |
| `TutorInstruction` → LLM | Prose/code au faisceau, marque discrète `llm generated` |
| `LearnerState` | Pastilles discrètes, retraitables |
| `PedagogicalSnapshot` (delta) | Lignes de delta éclairées une à une sur voile |
| Fournisseur off | Scaffold runtime au faisceau, zéro modèle |

## 6. Ce qui empêche le glissement en chatbot

Le faisceau **n'a pas de champ ouvert** : les seules entrées sont les 7 coups bornés (révélés au
focus, grisés si non disponibles) et la réponse de preuve. Même l'aide (`/explain-differently`,
`/example`, `/stuck`) lance un nouveau passage au faisceau, pas une conversation.

## 7. Forces / arbitrages / quand la choisir

- **Forces** : la **plus forte réduction de charge** (une idée à la fois, littéralement) ; tempo rendu à l'apprenante ; parfaite pour un apprenant fatigué / en surcharge — **exactement le cas d'Amara**.
- **Arbitrages** : peut frustrer un lecteur rapide ; l'auto-avance demande un bon calibrage de cadence ; revue arrière limitée à ce qui est « retiré ».
- **À choisir quand** : le contexte pédagogique exige une **concentration maximale** (diagnostic, réparation, récupération de surcharge).

## 8. Questions ouvertes

- Réglage utilisateur de la vitesse d'auto-avance (lent / moyen / manuel) ?
- Mémoriser la préférence auto/manuel par apprenant ?
- Combiner avec la **palette nocturne** de VEILLEUSE pour le confort prolongé ?

---

_Vérifié en navigateur : au `/start`, 1 seule unité éclairée, le déjà-lu retiré à opacité 0.34, code + badge LLM présents, 0 erreur JS (hors favicon). Verdict critique : score 91 — confort de lecture 9/10, charge cognitive 9/10. **Recommandé comme base** pour le contexte de récupération de surcharge._
