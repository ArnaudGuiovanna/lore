import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import { BACKEND_BASE } from "@/lib/config";
import type { CohortEnrollment, SatisfactionSurvey, SurveyResponse } from "@/lib/types";

// B-11 — « Mon avis » : les enquêtes des cohortes de l'apprenant, avec son
// éventuelle réponse. La liste brute vient du jeton apprenant ; le filtrage
// par inscription et la lecture de SA réponse (endpoint staff côté backend)
// passent par le tiers web de confiance (secret bootstrap), strictement
// rétrécis à l'apprenant authentifié — le navigateur ne voit jamais la
// réponse d'un autre apprenant.

export interface LearnerSurveyRow {
  survey: SatisfactionSurvey;
  open: boolean;
  my_response: SurveyResponse | null;
}

async function bootGet<T>(path: string, boot: string): Promise<T | null> {
  try {
    const res = await fetch(`${BACKEND_BASE}${path}`, {
      headers: { "X-LORE-Bootstrap-Token": boot },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function isOpen(survey: SatisfactionSurvey, now: number): boolean {
  if (survey.archived_at) return false;
  if (survey.opens_at && now < Date.parse(survey.opens_at)) return false;
  if (survey.closes_at && now > Date.parse(survey.closes_at)) return false;
  return true;
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "LEARNER") {
    return NextResponse.json({ error: "réservé aux apprenants" }, { status: 403 });
  }
  const r = await api.get<SatisfactionSurvey[]>(tpath("/surveys"));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  const surveys = Array.isArray(r.data) ? r.data : [];

  const boot = process.env.LORE_BOOTSTRAP_TOKEN || "";
  const tenant = encodeURIComponent(session.tenantId);

  // Cohortes où l'apprenant est inscrit (lecture de confiance, par cohorte vue).
  const cohortIds = Array.from(new Set(surveys.map((s) => s.cohort_id).filter(Boolean)));
  const enrolled = new Set<string>();
  if (boot) {
    await Promise.all(
      cohortIds.map(async (cid) => {
        const rows = await bootGet<CohortEnrollment[]>(
          `/v1/tenants/${tenant}/cohorts/${encodeURIComponent(cid)}/enrollments`,
          boot
        );
        if ((rows ?? []).some((e) => e.learner_id === session.userId && e.status === "ACTIVE")) {
          enrolled.add(cid);
        }
      })
    );
  }

  const mine = boot ? surveys.filter((s) => enrolled.has(s.cohort_id)) : surveys;
  const now = Date.now();
  const rows: LearnerSurveyRow[] = await Promise.all(
    mine.map(async (survey) => {
      let myResponse: SurveyResponse | null = null;
      if (boot) {
        const responses = await bootGet<SurveyResponse[]>(
          `/v1/tenants/${tenant}/surveys/${encodeURIComponent(survey.id)}/responses`,
          boot
        );
        myResponse = (responses ?? []).find((resp) => resp.learner_id === session.userId) ?? null;
      }
      return { survey, open: isOpen(survey, now), my_response: myResponse };
    })
  );
  return NextResponse.json(rows, { status: 200 });
}
