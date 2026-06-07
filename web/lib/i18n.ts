// Lightweight French string dictionary + a tiny `t()` helper.
//
// LORE ships French-by-default (the users are French training organizations —
// organismes de formation). This is deliberately NOT a heavy i18n routing
// framework: it is a single FR dictionary plus a pure, server+client-safe lookup.
// Most surfaces translate strings inline; this module centralises the SHARED and
// REPEATED strings (role labels, provenance marks, common verbs) so they stay
// consistent everywhere.
//
// Runtime-first vocabulary is kept meaningful in French:
//   - "décidé par le runtime" (runtime-decided)
//   - "généré par le LLM" (llm-generated)
//   - "instruction seule" / "instruction-only" (the instruction-only fallback)
// Short technical marks may stay bilingual where that is clearer for operators.

export const fr = {
  // Provenance marks (the single distinction the UI must always make visible).
  "mark.runtime": "décidé par le runtime",
  "mark.llm": "généré par le LLM",
  "mark.fallbk": "instruction seule",

  // Role labels (role is derived from membership, never requested).
  "role.learner": "Apprenant",
  "role.trainer": "Formateur",
  "role.admin": "Administrateur",
  "role.tenant_admin": "Administrateur",
  "role.super_admin": "Super-administrateur",

  // Common actions / states reused across surfaces.
  "action.retry": "Réessayer",
  "action.back": "Retour",
  "action.cancel": "Annuler",
  "action.confirm": "Confirmer",
  "action.save": "Enregistrer",
  "action.saving": "Enregistrement…",
  "action.signOut": "Se déconnecter",
  "state.offline": "hors ligne",
  "state.loading": "Chargement…",

  // The recurring honesty line: the runtime didn't answer.
  "runtime.noAnswer": "Le runtime n'a pas répondu.",
} as const;

export type MessageKey = keyof typeof fr;

// Pure, synchronous, server + client safe. Supports {var} interpolation.
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let s: string = fr[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}
