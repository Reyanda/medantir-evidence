import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  TextRun,
  convertInchesToTwip,
} from "docx";
import { assessPress } from "./pressReview.js";

const INK = "27272A";
const MUTED = "71717A";
const INDIGO = "4F46E5";
const EMERALD = "047857";
const PALE_INDIGO = "EEF2FF";
const PALE_AMBER = "FFFBEB";
const LIGHT_BORDER = "D4D4D8";
const VOCABULARY_LABELS = {
  mesh: "MeSH",
  emtree: "Emtree",
  cinahl: "CINAHL Headings",
  apa: "APA Thesaurus",
  decs: "DeCS",
};

const clean = (value) => String(value ?? "").trim();

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function dateParts(value) {
  const date = asDate(value);
  const iso = date.toISOString();
  return {
    machine: iso.slice(0, 10),
    display: `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`,
  };
}

function labelValue(label, value, options = {}) {
  return new Paragraph({
    spacing: { after: options.after ?? 80 },
    indent: options.indent ? { left: options.indent } : undefined,
    children: [
      new TextRun({ text: `${label}: `, bold: true, color: options.labelColor || INK }),
      new TextRun({ text: clean(value) || "—", color: options.valueColor || INK }),
    ],
  });
}

function sectionHeading(text, level = HeadingLevel.HEADING_1, options = {}) {
  return new Paragraph({
    heading: level,
    pageBreakBefore: Boolean(options.pageBreakBefore),
    children: [new TextRun({ text })],
  });
}

function queryBlock(text) {
  return new Paragraph({
    style: "QueryBlock",
    wordWrap: true,
    children: [new TextRun({ text: clean(text) || "No query generated." })],
  });
}

function historyLine(line) {
  return new Paragraph({
    style: "HistoryLine",
    children: [
      new TextRun({ text: `#${line.n}  `, bold: true, color: INDIGO }),
      new TextRun({ text: clean(line.text) || "—" }),
    ],
  });
}

function conceptChildren(concepts = []) {
  const children = [];
  concepts.forEach((concept, index) => {
    children.push(sectionHeading(`${index + 1}. ${clean(concept.label) || `Concept ${index + 1}`}`, HeadingLevel.HEADING_2));
    children.push(labelValue("Join", index === 0 ? "Base concept" : clean(concept.op) || "AND"));
    children.push(labelValue("Free-text terms", (concept.terms || []).map(clean).filter(Boolean).join("; ")));
    for (const [vocabulary, label] of Object.entries(VOCABULARY_LABELS)) {
      const headings = concept.vocab?.[vocabulary] || (vocabulary === "mesh" ? concept.mesh || [] : []);
      children.push(labelValue(label === "CINAHL Headings" ? label : `${label} headings`, headings.map(clean).filter(Boolean).join("; ")));
    }
    if (concept.headingRecords?.length) {
      children.push(labelValue("Heading provenance", concept.headingRecords.map((record) => {
        const source = clean(record.sourceLabel || record.source) || "unspecified source";
        const identifier = clean(record.sourceId) ? ` ${clean(record.sourceId)}` : "";
        const status = clean(record.verification) || "review required";
        return `${VOCABULARY_LABELS[record.vocabulary] || record.vocabulary}: ${clean(record.label)} [${source}${identifier}; ${status}]`;
      }).join("; ")));
    }
    if (concept.vocabularyRecords?.length) {
      children.push(labelValue("Expansion provenance", concept.vocabularyRecords.map((record) => {
        const source = clean(record.sourceLabel || record.source) || "unspecified source";
        const identifier = clean(record.sourceId) ? ` ${clean(record.sourceId)}` : "";
        const type = clean(record.resourceType) || "vocabulary source";
        const relation = clean(record.relation) || "candidate label";
        const status = clean(record.verification) || "review required";
        return `${clean(record.label)} [${source}${identifier}; ${type}; ${relation}; ${status}; added as free text]`;
      }).join("; ")));
    }
  });
  return children;
}

function strategyChildren(strategies = []) {
  const children = [];
  strategies.forEach((strategy, index) => {
    children.push(sectionHeading(strategy.name || strategy.id, HeadingLevel.HEADING_1, { pageBreakBefore: index > 0 }));
    children.push(labelValue("Platform/database", strategy.name || strategy.id));
    children.push(labelValue("Controlled vocabulary", strategy.controlled || "—"));
    if (strategy.headingStatus && strategy.headingStatus !== "not-applicable") children.push(labelValue("Native-heading coverage", strategy.headingStatus));
    children.push(labelValue("Syntax note", strategy.hint || "—", { after: 160, valueColor: MUTED }));
    children.push(sectionHeading("Exact compiled strategy", HeadingLevel.HEADING_2));
    children.push(queryBlock(strategy.combined));
    children.push(sectionHeading("Search-history lines", HeadingLevel.HEADING_2));
    if (strategy.lines?.length) {
      strategy.lines.forEach((line) => children.push(historyLine(line)));
    } else {
      children.push(new Paragraph({ text: "No search-history lines were generated." }));
    }
  });
  return children;
}

function pressChildren(assessment) {
  if (!assessment) return [new Paragraph({ text: "No PRESS preflight was supplied with this export." })];
  const children = [
    labelValue("Standard", assessment.standard || "PRESS 2015"),
    labelValue("Automated structural preflight", assessment.readyForExecution ? "Passed" : "Blocked"),
    labelValue("Independent peer review", assessment.independentPeerReviewComplete ? "Recorded" : "Pending — required for formal PRESS completion"),
    labelValue("Sentinel-paper validation", assessment.sentinelValidationComplete ? "Recorded" : "Pending"),
    new Paragraph({
      style: "CaveatBlock",
      children: [new TextRun({ text: "Automated checks support, but do not replace, independent PRESS peer review by a qualified search specialist. Record reviewer identity, amendments, and sentinel-study retrieval before finalising the search." })],
    }),
  ];
  for (const row of assessment.rows || []) {
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: `[${String(row.status || "pending").toUpperCase()}] ${row.domain}: `, bold: true, color: row.status === "pass" ? EMERALD : row.status === "fail" ? "BE123C" : "D97706" }),
        new TextRun({ text: row.label || "" }),
      ],
    }));
    children.push(labelValue("Evidence / action", row.evidence || "Not recorded", { indent: 220, after: 120, valueColor: MUTED }));
  }
  children.push(labelValue("Checklist source", `${assessment.citation?.publisher || "CADTH"} — ${assessment.citation?.title || "PRESS 2015 Evidence-Based Checklist"}`));
  children.push(labelValue("Source URL", assessment.citation?.url || "https://www.cadth.ca/sites/default/files/PRESS_Peer_Review_Electronic_Search_Strate/Table_9-PRESS.pdf"));
  return children;
}

export function searchStrategyFilename(generatedAt = new Date()) {
  return `medantir-search-strategies-${dateParts(generatedAt).machine}.docx`;
}

export function createSearchStrategyDocument({ question = "", concepts = [], strategies = [], pressAssessment = null, generatedAt = new Date() } = {}) {
  const exported = dateParts(generatedAt);
  const effectivePressAssessment = pressAssessment || assessPress({ question, concepts, strategies });
  const header = new Header({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: "MEDANTIR  /  EVIDENCE REVIEW ENGINE", bold: true, size: 16, color: MUTED })],
    })],
  });
  const footer = new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: "Search strategy export  ·  ", size: 16, color: MUTED }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED }),
      ],
    })],
  });

  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: "Database Search Strategies" })],
    }),
    new Paragraph({
      spacing: { after: 320 },
      children: [new TextRun({ text: "Medantir Evidence · editable strategy record", color: INDIGO, bold: true, size: 24 })],
    }),
    labelValue("Exported", exported.display),
    labelValue("Strategies", String(strategies.length)),
    sectionHeading("Review question", HeadingLevel.HEADING_1),
    new Paragraph({
      style: "QuestionBlock",
      children: [new TextRun({ text: clean(question) || "No review question was entered." })],
    }),
    sectionHeading("Status and validation boundary", HeadingLevel.HEADING_1),
    new Paragraph({
      style: "CaveatBlock",
      children: [new TextRun({
        text: "Draft, editable export. Free-text suggestions, cross-domain vocabulary candidates, and controlled headings are stored separately. The compiler emits a controlled heading only for its named database vocabulary; it does not convert MeSH or a concept from ELSST, TheSoz, SAGE, UNESCO, LCSH, STW, GO, ENVO, ChEBI, AGROVOC, or another external source into Emtree, CINAHL Headings, APA Thesaurus terms, DeCS, or any other native heading. Ontologies, classifications, reporting taxonomies, repositories, databases, and metaregistries retain their source-specific roles. Operator-entered headings still require verification in the native thesaurus. PRESS review, sentinel-paper testing, and database execution remain required.",
      })],
    }),
    sectionHeading("PRESS 2015 checklist and preflight", HeadingLevel.HEADING_1),
    ...pressChildren(effectivePressAssessment),
    sectionHeading("Concept blocks (intermediate search representation)", HeadingLevel.HEADING_1),
    ...conceptChildren(concepts),
    new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "Compiled database strategies" })] }),
    ...strategyChildren(strategies),
  ];

  return new Document({
    creator: "Medantir Evidence",
    lastModifiedBy: "Medantir Evidence",
    title: "Database Search Strategies",
    subject: clean(question) || "Systematic-review search strategies",
    description: "Editable database-specific search-strategy export generated by Medantir.",
    keywords: "search strategy, systematic review, PRISMA-S, controlled vocabulary, ontology, classification, provenance, database syntax",
    styles: {
      default: {
        document: {
          run: { font: "Aptos", size: 20, color: INK },
          paragraph: { spacing: { after: 120, line: 276 } },
        },
        title: {
          run: { font: "Aptos Display", size: 40, bold: true, color: INK },
          paragraph: { spacing: { before: 120, after: 80 }, keepNext: true },
        },
        heading1: {
          run: { font: "Aptos Display", size: 28, bold: true, color: INK },
          paragraph: { spacing: { before: 320, after: 120 }, keepNext: true, outlineLevel: 0 },
        },
        heading2: {
          run: { font: "Aptos", size: 22, bold: true, color: EMERALD },
          paragraph: { spacing: { before: 200, after: 80 }, keepNext: true, outlineLevel: 1 },
        },
      },
      paragraphStyles: [
        {
          id: "QuestionBlock",
          name: "Question Block",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Aptos", size: 22, italics: true, color: INK },
          paragraph: {
            spacing: { before: 60, after: 200, line: 300 },
            shading: { type: ShadingType.CLEAR, fill: PALE_INDIGO },
            border: { left: { style: BorderStyle.SINGLE, color: INDIGO, size: 18, space: 10 } },
            indent: { left: 220, right: 180 },
          },
        },
        {
          id: "CaveatBlock",
          name: "Validation Boundary",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Aptos", size: 18, color: INK },
          paragraph: {
            spacing: { before: 60, after: 220, line: 260 },
            shading: { type: ShadingType.CLEAR, fill: PALE_AMBER },
            border: { left: { style: BorderStyle.SINGLE, color: "D97706", size: 18, space: 10 } },
            indent: { left: 220, right: 180 },
          },
        },
        {
          id: "QueryBlock",
          name: "Exact Query",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Aptos Mono", size: 16, color: INK },
          paragraph: {
            spacing: { before: 80, after: 220, line: 230 },
            shading: { type: ShadingType.CLEAR, fill: "F4F4F5" },
            border: {
              top: { style: BorderStyle.SINGLE, color: LIGHT_BORDER, size: 4 },
              bottom: { style: BorderStyle.SINGLE, color: LIGHT_BORDER, size: 4 },
              left: { style: BorderStyle.SINGLE, color: LIGHT_BORDER, size: 4 },
              right: { style: BorderStyle.SINGLE, color: LIGHT_BORDER, size: 4 },
            },
            indent: { left: 180, right: 180 },
          },
        },
        {
          id: "HistoryLine",
          name: "Search History Line",
          basedOn: "Normal",
          next: "HistoryLine",
          quickFormat: true,
          run: { font: "Aptos Mono", size: 16, color: INK },
          paragraph: { spacing: { after: 50, line: 220 }, indent: { left: 180 } },
        },
      ],
    },
    sections: [{
      headers: { default: header },
      footers: { default: footer },
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(0.75),
            right: convertInchesToTwip(0.8),
            bottom: convertInchesToTwip(0.75),
            left: convertInchesToTwip(0.8),
            header: convertInchesToTwip(0.3),
            footer: convertInchesToTwip(0.3),
          },
        },
      },
      children,
    }],
  });
}

export async function packSearchStrategyDocument(options, output = "blob") {
  const document = createSearchStrategyDocument(options);
  if (output === "buffer") return Packer.toBuffer(document);
  return Packer.toBlob(document);
}

export async function downloadSearchStrategiesDocx(options = {}) {
  const blob = await packSearchStrategyDocument(options, "blob");
  const filename = searchStrategyFilename(options.generatedAt);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}
