# VEILLEUSE — l'environnement de lecture apaisé

> **Itération ZEN · levier de charge cognitive : l'ENVIRONNEMENT / la charge SENSORIELLE**
> _« Baisser la lumière, pas l'information. Lire longtemps sans fatigue. »_

- **Mockup figé** : [`html/focus-zen-nuit.html`](html/focus-zen-nuit.html)
- **Version vivante** (funnel) : `/mockups/variants/focus-zen-nuit.html`
- **Persona** : Amara Okafor (learner-1) · Acme Learning › Backend Engineering 2026 › Go-Spring-24
- **Contexte runtime** : réparer `persistence` (0.41 ↓, rétention 0.38, révision en retard 2 j, misconception `forgot-tx-rollback`) avant `transactions`. **Récupération de surcharge** — un apprenant fatigué doit pouvoir lire confortablement, longtemps.

---

## 1. Positionnement

Là où les trois autres règlent le **flux**, l'**attention** ou la **segmentation**, VEILLEUSE
abaisse la **charge sensorielle et de contraste de tout le canevas**. Par défaut : **NUIT** — encre
blanc-cassé chaud (`#e8ddc9`) sur charbon chaud profond (`#1a1714`), contraste doux mais lisible,
jamais le noir/blanc agressif. Une lueur ambiante chaude (respiration radiale sur 16 s), une légère
vignette interne et un grain quasi-invisible (~4.5 %) donnent de l'atmosphère sans bruit. **C'est la
seule variante avec de vrais contrôles de confort** qui mutent la lecture en direct.

## 2. La thèse (levier : environnement)

> Toute la charge n'est pas cognitive : une partie est **sensorielle** (luminance, contraste,
> scintillement, densité visuelle). En réglant l'**environnement de lecture** — palette chaude, faible
> contraste, espace maximal, mouvement minimal — on permet une lecture **soutenue** sans fatigue
> oculaire. La maîtrise est rendue à l'apprenant via des **contrôles réels**, pas décoratifs.

## 3. Spécification de lecture (concrète)

| Paramètre | Valeur |
|---|---|
| Corps de lecture | **Spectral**, **21 px par défaut (réglable 18–24 px)**, graisse 300 (trait doux) |
| Interligne | **1.78** (échelle 1.70–1.86 avec la taille) |
| Mesure | **réglable** : narrow 54ch / **calm 62ch** / wide 68ch (`--measure`) |
| Espacement paragraphe | 1.35 em · divulgation **une idée à la fois** |
| Bloc de code | panneau chaud `#15120f`, mots-clés ambre, fonctions sauge, commentaire d'erreur rose sourd, interligne 1.85 (jamais terminal-sur-noir) |
| Cadence | **la plus lente de la famille** : 46 ms/mot + pauses phrase 320 ms |
| Rythme vertical | padding takeover 108 px+, 42 px jusqu'au pied |

**Contrôles de confort (réels, vérifiés)** — dock de coin :
- **A− / A+** → écrit `--rsize` / `--rlead` (taille **18–24 px**)
- **Mesure** → narrow / calm / wide (`--measure`)
- **Palette** → **nuit / sépia** (bascule un jeu de variables CSS ; sépia = fond `rgb(233,221,196)`)

`prefers-reduced-motion` **et** `prefers-reduced-transparency` retirent gracieusement lueur et grain.

**Polices** : Spectral (lecture + intention) · Spline Sans Mono (code, commandes, métriques). _Aucune police générique._

## 4. Le parcours (états)

1. **Vide nocturne** — le vide le plus aéré de la famille (stage padding 140 px) : intention runtime en **Spectral 35 px** (emphase italique ambre), 4 pastilles-métriques, note de surcharge, champ d'invocation à caret. Lueur + vignette + grain en arrière-plan (z-0). Le chrome **chute à 10 % d'opacité** dès que l'apprenant agit (focus mode).
2. **Coups** — liste inline sobre des 7 coups révélée au focus (navigable clavier).
3. **Prise de lecture (LLM)** — `/start` : statut « generating… · claude · temp 0.2 » → colonne Spectral aérée streamée avec fondus « blur-in », code Go doucement teinté, statut résolu en marque discrète `llm generated`.
4. **Contrôles de confort** — dock de coin : A−/A+, mesure, nuit/sépia — **mutent la lecture immédiatement**.
5. **Preuve + delta** — correctif pré-rempli, puis voile de delta apaisé (maîtrise 0.41 → 0.47, misconception toujours active, rétention reprogrammée, `transactions` verrouillé).
6. **Fallback instruction-only** — `/fallback` (point rose, `instruction_only`) : la même tâche en **scaffold numéroté 6 étapes**, streamé dans le **même environnement sépia/nuit reposant**. Badgé « instruction-only · runtime authored ».
7. **Intention suivante** — flash de souffle puis repli vers une nouvelle ligne d'intention.

## 5. Correspondance runtime ↔ interface

| Signal runtime | Traitement UI |
|---|---|
| `RuntimeDecision` | Intention Spectral + emphase ambre, marque `runtime decided` |
| `TutorInstruction` → LLM | Colonne streamée, marque discrète `llm generated` |
| `LearnerState` | Pastilles discrètes, retraitables |
| `PedagogicalSnapshot` (delta) | Voile de delta reposant |
| Fournisseur off | Scaffold runtime numéroté dans le même environnement |

## 6. Ce qui empêche le glissement en chatbot

Mêmes garde-fous ZEN/COMMAND : pas de champ ouvert, jeu borné de 7 coups révélé au focus, prose
libre uniquement comme preuve. Les contrôles de confort agissent sur la **présentation**, jamais sur
la nature des entrées.

## 7. Forces / arbitrages / quand la choisir

- **Forces** : **le plus confortable sensoriellement** ; **seule variante avec accessibilité réelle** (taille / mesure / thème) ; deux palettes reposantes sur un même système de variables ; cadence la plus humaine.
- **Arbitrages** : le levier « environnement » est **orthogonal** aux trois autres — ce n'est pas une vraie concurrente mais plutôt une **couche à fusionner** dans la variante gagnante.
- **À choisir quand** : sessions **longues**, lecture du soir, apprenant fatigué / en surcharge, ou besoin d'accessibilité.

## 8. Questions ouvertes

- **Fusion recommandée** : appliquer les contrôles de confort + palette nuit/sépia **par-dessus PROJECTEUR** (attention) ou LECTURE (flux).
- Détection auto du thème (heure / `prefers-color-scheme`) ?
- Persistance des préférences de confort par apprenant (côté profil) ?

---

_Vérifié en navigateur : contrôle de taille réel **19.5 px → 22.5 px**, bascule de thème (fond `rgb(26,23,20)` → `rgb(64,59,52)`), streaming + badge LLM + code, 0 erreur JS (hors favicon). Verdict critique : score 93 — confort de lecture 9/10, charge cognitive 9/10._
