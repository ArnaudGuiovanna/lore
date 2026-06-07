// Server-side PDF generation for the OF completion attestation
// ("attestation de fin de formation / d'assiduité").
//
// Pure-JS via pdf-lib (no native build — Docker-friendly). The runtime owns the
// pedagogical signals; this builder only RENDERS them honestly. It never invents
// mastery or completion — it presents the per-concept "niveau de maîtrise" exactly
// as the runtime scored it, and states plainly that the runtime tracked progression.
//
// French copy is intentional: this is an OF-facing legal/operational artefact and
// French is correct here even before global i18n lands.
import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { createHash } from "node:crypto";

// One concept line on the attestation: the concept's honest mastery + retention,
// as the runtime scored them (0..1).
export interface CertificateConcept {
  name: string;
  mastery: number; // 0..1 — "niveau de maîtrise"
  retention: number; // 0..1
}

export interface CertificateData {
  organizationName: string; // tenant / OF name
  learnerName: string;
  learnerId: string;
  tenantId: string;
  programTitle: string; // the bound syllabus title
  // ISO date strings (optional). Used for the "période" line and issue timestamp.
  periodStart?: string | null;
  periodEnd?: string | null;
  concepts: CertificateConcept[];
}

// LECTURE-adjacent palette translated to print: warm ink on paper.
const INK = rgb(0.13, 0.15, 0.14);
const ACCENT = rgb(0.18, 0.36, 0.27); // ink-green
const MUTED = rgb(0.42, 0.44, 0.43);
const LINE = rgb(0.78, 0.78, 0.75);
const PAPER = rgb(0.99, 0.985, 0.97);

// A4 in points.
const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 56;

function frDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // fr-FR long date, deterministic in UTC to avoid host-timezone drift.
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function pct(x: number): string {
  if (Number.isNaN(x)) return "—";
  return `${Math.round(Math.min(1, Math.max(0, x)) * 100)} %`;
}

// Honest qualitative band for a mastery score (no inflation).
function masteryBand(m: number): string {
  if (m >= 0.85) return "maîtrisé";
  if (m >= 0.65) return "en bonne voie";
  if (m >= 0.4) return "en cours d'acquisition";
  return "abordé";
}

// Short, stable verification id: a hash of learner+tenant+program+issue date.
// Lets a reader cross-check the attestation against the runtime's records.
function verificationId(d: CertificateData, issuedISO: string): string {
  const day = issuedISO.slice(0, 10);
  return createHash("sha256")
    .update(`${d.learnerId}|${d.tenantId}|${d.programTitle}|${day}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
}

// Wrap a string to a max width given a font + size (word-based).
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Build an A4 PDF "attestation de fin de formation / d'assiduité" from real
 * runtime-shaped data. Returns the raw PDF bytes (Uint8Array).
 */
export async function buildCertificatePdf(data: CertificateData): Promise<Uint8Array> {
  const issuedAt = new Date();
  const issuedISO = issuedAt.toISOString();
  const verifId = verificationId(data, issuedISO);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Attestation de formation — ${data.learnerName}`);
  pdf.setAuthor(data.organizationName);
  pdf.setSubject("Attestation de fin de formation / d'assiduité");
  pdf.setProducer("LORE");
  pdf.setCreator("LORE");

  const page = pdf.addPage([A4.w, A4.h]);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const serifItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  const contentW = A4.w - MARGIN * 2;

  // Paper background.
  page.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: PAPER });
  // A subtle border frame for a printed-document feel.
  page.drawRectangle({
    x: MARGIN / 2,
    y: MARGIN / 2,
    width: A4.w - MARGIN,
    height: A4.h - MARGIN,
    borderColor: LINE,
    borderWidth: 1,
  });

  let y = A4.h - MARGIN - 6;

  const drawText = (
    text: string,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number } = {}
  ) => {
    const font = opts.font ?? serif;
    const size = opts.size ?? 11;
    page.drawText(text, { x: opts.x ?? MARGIN, y, font, size, color: opts.color ?? INK });
  };

  // --- Header: organization + branding placeholder ---
  // Labeled logo space (no logo dependency) on the left.
  page.drawRectangle({
    x: MARGIN,
    y: y - 34,
    width: 92,
    height: 40,
    borderColor: LINE,
    borderWidth: 1,
  });
  page.drawText("LOGO", {
    x: MARGIN + 30,
    y: y - 18,
    font: mono,
    size: 9,
    color: MUTED,
  });

  // Organization name (right-aligned block to the logo).
  const orgX = MARGIN + 108;
  page.drawText("Organisme de formation", { x: orgX, y, font: mono, size: 8, color: MUTED });
  page.drawText(data.organizationName, {
    x: orgX,
    y: y - 18,
    font: serifBold,
    size: 16,
    color: INK,
  });
  y -= 64;

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.w - MARGIN, y },
    thickness: 1,
    color: LINE,
  });
  y -= 40;

  // --- Title ---
  const title = "Attestation de fin de formation";
  const titleSize = 24;
  const titleW = serifBold.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: MARGIN + (contentW - titleW) / 2,
    y,
    font: serifBold,
    size: titleSize,
    color: INK,
  });
  y -= 22;
  const sub = "(assiduité et progression)";
  const subW = serifItalic.widthOfTextAtSize(sub, 12);
  page.drawText(sub, {
    x: MARGIN + (contentW - subW) / 2,
    y,
    font: serifItalic,
    size: 12,
    color: MUTED,
  });
  y -= 44;

  // --- Beneficiary statement ---
  drawText("Je soussigné(e), représentant(e) de l'organisme de formation", {
    font: serif,
    size: 11,
    color: MUTED,
  });
  y -= 16;
  drawText(data.organizationName, { font: serifBold, size: 13 });
  y -= 30;

  drawText("atteste que", { font: serif, size: 11, color: MUTED });
  y -= 22;
  drawText(data.learnerName, { font: serifBold, size: 18, color: ACCENT });
  y -= 30;

  const introLines = wrap(
    "a suivi le parcours de formation ci-dessous. La progression a été suivie de façon continue par le moteur pédagogique de LORE, qui mesure pour chaque notion un niveau de maîtrise et de rétention à partir des évidences produites par l'apprenant(e).",
    serif,
    11,
    contentW
  );
  for (const line of introLines) {
    drawText(line, { font: serif, size: 11 });
    y -= 16;
  }
  y -= 14;

  // --- Program + period ---
  drawText("Intitulé du parcours", { font: mono, size: 8, color: MUTED });
  y -= 16;
  for (const line of wrap(data.programTitle, serifBold, 13, contentW)) {
    drawText(line, { font: serifBold, size: 13 });
    y -= 18;
  }
  y -= 8;

  const period =
    data.periodStart || data.periodEnd
      ? `Période : du ${frDate(data.periodStart)} au ${frDate(data.periodEnd)}`
      : `Établie le ${frDate(issuedISO)}`;
  drawText(period, { font: serif, size: 11, color: MUTED });
  y -= 30;

  // --- Concepts table: niveau de maîtrise ---
  drawText("Notions travaillées et niveau de maîtrise", { font: serifBold, size: 13 });
  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y: y - 4 },
    end: { x: A4.w - MARGIN, y: y - 4 },
    thickness: 1,
    color: ACCENT,
  });
  y -= 20;

  // Column layout.
  const colNotion = MARGIN;
  const colMastery = MARGIN + contentW * 0.5;
  const colRetention = MARGIN + contentW * 0.7;
  const colBand = MARGIN + contentW * 0.84;

  const drawRow = (
    notion: string,
    masteryStr: string,
    retentionStr: string,
    band: string,
    opts: { header?: boolean } = {}
  ) => {
    const font = opts.header ? mono : serif;
    const size = opts.header ? 8 : 11;
    const color = opts.header ? MUTED : INK;
    const bandFont = opts.header ? mono : serifItalic;
    // Notion can wrap; keep the row aligned to the first line.
    const notionLines = opts.header ? [notion] : wrap(notion, font, size, colMastery - colNotion - 12);
    page.drawText(notionLines[0], { x: colNotion, y, font, size, color });
    page.drawText(masteryStr, { x: colMastery, y, font, size, color });
    page.drawText(retentionStr, { x: colRetention, y, font, size, color });
    page.drawText(band, { x: colBand, y, font: bandFont, size: opts.header ? 8 : 10, color });
    y -= 15;
    for (let i = 1; i < notionLines.length; i++) {
      page.drawText(notionLines[i], { x: colNotion + 10, y, font, size, color: MUTED });
      y -= 14;
    }
  };

  drawRow("NOTION", "MAÎTRISE", "RÉTENTION", "NIVEAU", { header: true });
  y -= 4;

  if (data.concepts.length === 0) {
    drawText("Aucune notion suivie n'a encore été enregistrée par le moteur pédagogique.", {
      font: serifItalic,
      size: 11,
      color: MUTED,
    });
    y -= 16;
  } else {
    for (const c of data.concepts) {
      // Page-break guard: keep the footer area clear.
      if (y < MARGIN + 150) break;
      drawRow(c.name, pct(c.mastery), pct(c.retention), masteryBand(c.mastery));
    }
  }
  y -= 14;

  // --- Honest statement ---
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.w - MARGIN, y },
    thickness: 0.5,
    color: LINE,
  });
  y -= 18;
  const honest = wrap(
    "Les niveaux ci-dessus reflètent l'état durable mesuré par le moteur pédagogique et ne préjugent pas d'une certification externe. Cette attestation porte sur l'assiduité et la progression effectivement constatées.",
    serifItalic,
    10,
    contentW
  );
  for (const line of honest) {
    drawText(line, { font: serifItalic, size: 10, color: MUTED });
    y -= 14;
  }

  // --- Footer: signature space + verification id + timestamp ---
  const footerY = MARGIN + 24;
  page.drawLine({
    start: { x: MARGIN, y: footerY + 52 },
    end: { x: A4.w - MARGIN, y: footerY + 52 },
    thickness: 0.5,
    color: LINE,
  });

  // Signature placeholder (labeled space, no image dependency).
  page.drawText("Fait à __________________, le " + frDate(issuedISO), {
    x: MARGIN,
    y: footerY + 36,
    font: serif,
    size: 10,
    color: INK,
  });
  page.drawText("Signature et cachet de l'organisme", {
    x: MARGIN,
    y: footerY + 18,
    font: mono,
    size: 8,
    color: MUTED,
  });
  page.drawRectangle({
    x: MARGIN,
    y: footerY - 18,
    width: 180,
    height: 30,
    borderColor: LINE,
    borderWidth: 0.75,
  });

  // Verification id + generation timestamp (right side).
  const verifLabel = `Identifiant de vérification : ${verifId}`;
  const stampLabel = `Généré le ${frDate(issuedISO)} à ${issuedISO.slice(11, 16)} UTC`;
  const vW = mono.widthOfTextAtSize(verifLabel, 8);
  const sW = mono.widthOfTextAtSize(stampLabel, 8);
  page.drawText(verifLabel, {
    x: A4.w - MARGIN - vW,
    y: footerY + 24,
    font: mono,
    size: 8,
    color: MUTED,
  });
  page.drawText(stampLabel, {
    x: A4.w - MARGIN - sW,
    y: footerY + 12,
    font: mono,
    size: 8,
    color: MUTED,
  });
  const loreLabel = "Suivi de progression : moteur pédagogique LORE";
  const lW = mono.widthOfTextAtSize(loreLabel, 8);
  page.drawText(loreLabel, {
    x: A4.w - MARGIN - lW,
    y: footerY,
    font: mono,
    size: 8,
    color: MUTED,
  });

  return pdf.save();
}

// Filename-safe slug for the downloaded attestation, e.g. "amara-okafor".
export function attestationFilename(learnerName: string): string {
  const slug =
    learnerName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "apprenant";
  return `attestation-${slug}.pdf`;
}
