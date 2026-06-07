// French A4 attendance-sheet (feuille d'émargement) PDF builder. Uses pdf-lib so
// it works in the Next.js Node runtime with no headless browser. Server-only.
//
// Honesty note: presence here is captured digitally (a trainer marks present/absent
// in LORE; the time of capture is the émargement timestamp). The sheet provides a
// physical signature column for on-site sessions, and prints the digital-capture
// timestamp so the document is honest about how presence was recorded.
//
// SEPARATELY NAMED (web/lib/pdf/attendance.ts) to avoid collisions with any
// certificate PDF builder another stream may add under web/lib/pdf/.
import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface AttendanceSheetLearner {
  name: string;
  present: boolean;
  signedAt: string | null; // ISO timestamp of digital capture, if present
}

export interface AttendanceSheetInput {
  orgName: string;
  cohortName: string;
  sessionDate: string; // ISO date (YYYY-MM-DD)
  learners: AttendanceSheetLearner[];
}

// fr-FR long date, e.g. "lundi 6 janvier 2026". Built from parts to avoid relying
// on the runtime's ICU locale data being present.
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
function frDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${JOURS[d.getDay()]} ${Number(m[3])} ${MOIS[Number(m[2]) - 1]} ${m[1]}`;
}

function frTime(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  return `${hh} h ${mm}`;
}

// pdf-lib's WinAnsi fonts cover Latin-1, which includes the French accents and the
// é/è/à/ç/œ we use. Strip anything outside that range defensively so encoding never
// throws on an unexpected glyph (e.g. a learner name with a non-Latin character).
function safe(text: string): string {
  return Array.from(text)
    .map((ch) => (ch.charCodeAt(0) <= 0xff ? ch : "?"))
    .join("");
}

const INK = rgb(0.09, 0.09, 0.08);
const QUIET = rgb(0.42, 0.42, 0.4);
const LINE = rgb(0.78, 0.76, 0.72);
const HEAD_BG = rgb(0.93, 0.92, 0.89);

// A4 portrait in points.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;

export async function buildAttendanceSheetPdf(input: AttendanceSheetInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Feuille d'émargement — ${input.cohortName}`);
  doc.setCreator("LORE");
  doc.setProducer("LORE");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const draw = (text: string, x: number, yy: number, f: PDFFont, size: number, color = INK) => {
    page.drawText(safe(text), { x, y: yy, size, font: f, color });
  };

  // ---- header: org + document title ----
  draw(input.orgName, MARGIN, y, bold, 16);
  y -= 18;
  draw("Organisme de formation", MARGIN, y, italic, 9, QUIET);
  y -= 28;

  draw("FEUILLE D'ÉMARGEMENT", MARGIN, y, bold, 20);
  y -= 26;

  draw("Session de formation", MARGIN, y, bold, 11);
  draw(`Groupe : ${input.cohortName}`, MARGIN, y - 16, font, 11);
  draw(`Date : ${frDate(input.sessionDate)}`, MARGIN, y - 32, font, 11);
  y -= 56;

  // present count summary
  const present = input.learners.filter((l) => l.present).length;
  draw(
    `Présents : ${present} / ${input.learners.length} stagiaire(s)`,
    MARGIN,
    y,
    font,
    10,
    QUIET
  );
  y -= 22;

  // ---- table ----
  // columns: name | présent/absent | heure (capture) | signature
  const xName = MARGIN;
  const xStatus = MARGIN + 230;
  const xTime = MARGIN + 320;
  const xSign = MARGIN + 400;
  const tableRight = PAGE_W - MARGIN;
  const rowH = 30;

  const headerRow = (yy: number) => {
    page.drawRectangle({
      x: MARGIN,
      y: yy - rowH + 8,
      width: tableRight - MARGIN,
      height: rowH,
      color: HEAD_BG,
    });
    draw("Stagiaire", xName + 6, yy - 12, bold, 10);
    draw("Présence", xStatus + 4, yy - 12, bold, 10);
    draw("Heure", xTime + 4, yy - 12, bold, 10);
    draw("Signature", xSign + 6, yy - 12, bold, 10);
    return yy - rowH;
  };

  const hline = (yy: number) => {
    page.drawLine({
      start: { x: MARGIN, y: yy + 8 },
      end: { x: tableRight, y: yy + 8 },
      thickness: 0.6,
      color: LINE,
    });
  };

  const newPage = (): PDFPage => {
    const p = doc.addPage([PAGE_W, PAGE_H]);
    return p;
  };

  y = headerRow(y);
  hline(y);

  for (const l of input.learners) {
    if (y < MARGIN + 120) {
      page = newPage();
      y = PAGE_H - MARGIN;
      y = headerRow(y);
      hline(y);
    }
    draw(l.name, xName + 6, y - 12, font, 11);
    draw(l.present ? "Présent" : "Absent", xStatus + 4, y - 12, l.present ? bold : font, 10, l.present ? INK : QUIET);
    draw(frTime(l.present ? l.signedAt : null), xTime + 4, y - 12, font, 10, QUIET);
    // signature cell: a ruled blank line for on-site physical signature
    page.drawLine({
      start: { x: xSign + 6, y: y - 16 },
      end: { x: tableRight - 6, y: y - 16 },
      thickness: 0.5,
      color: LINE,
    });
    y -= rowH;
    hline(y);
  }

  // ---- footer: honesty + signature block ----
  y -= 24;
  if (y < MARGIN + 90) {
    page = newPage();
    y = PAGE_H - MARGIN;
  }
  draw("Émargement", MARGIN, y, bold, 10);
  y -= 16;
  const note =
    "La présence est saisie numériquement dans LORE par le formateur (case Présent / Absent). " +
    "L'heure indiquée correspond à l'horodatage de cette saisie. La colonne « Signature » permet " +
    "le cas échéant un émargement manuscrit sur site ; en distanciel, l'horodatage numérique fait foi.";
  // simple word wrap at ~95 chars
  const words = note.split(" ");
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > 95) {
      draw(line.trim(), MARGIN, y, italic, 9, QUIET);
      y -= 13;
      line = w;
    } else {
      line += " " + w;
    }
  }
  if (line.trim()) {
    draw(line.trim(), MARGIN, y, italic, 9, QUIET);
    y -= 13;
  }

  y -= 24;
  draw("Le/la formateur·rice :", MARGIN, y, font, 10);
  page.drawLine({
    start: { x: MARGIN + 130, y: y - 2 },
    end: { x: MARGIN + 300, y: y - 2 },
    thickness: 0.6,
    color: LINE,
  });
  draw("Cachet de l'organisme :", PAGE_W - MARGIN - 230, y, font, 10);

  return await doc.save();
}
