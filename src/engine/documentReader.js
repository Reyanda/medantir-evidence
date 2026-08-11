import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const MAX_EXTRACTED_CHARS = 400_000;

export function documentKind(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type.includes("wordprocessingml") || name.endsWith(".docx")) return "docx";
  if (type.startsWith("text/") || /\.(?:txt|md|csv|tsv|json|jsonl|ya?ml|xml|html?|css|js|jsx|ts|tsx|py|r|sql|sh|java|go|rs|c|cpp|h|swift|toml|ini|log|tex|bib)$/i.test(name)) return "text";
  return "binary";
}

export async function extractPdf(file) {
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str || "").join(" ").replace(/\s+/g, " ").trim();
    pages.push(`## Page ${pageNumber}\n\n${text}`);
    if (pages.join("\n\n").length >= MAX_EXTRACTED_CHARS) break;
  }
  return { kind: "pdf", text: pages.join("\n\n").slice(0, MAX_EXTRACTED_CHARS), pages: document.numPages, parser: "PDF.js (native browser)" };
}

export async function extractDocx(file) {
  const mammoth = await import("mammoth/mammoth.browser.js");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return { kind: "docx", text: String(result.value || "").slice(0, MAX_EXTRACTED_CHARS), warnings: (result.messages || []).map((item) => item.message), parser: "Mammoth (native browser)" };
}

export async function extractDocument(file) {
  const kind = documentKind(file);
  if (kind === "pdf") return extractPdf(file);
  if (kind === "docx") return extractDocx(file);
  if (kind === "text") return { kind, text: String(await file.text()).slice(0, MAX_EXTRACTED_CHARS), parser: "native text reader" };
  throw new Error(`${file?.name || "This file"} is not yet readable. Supported: PDF, DOCX, text, Markdown, code, and structured text data.`);
}

