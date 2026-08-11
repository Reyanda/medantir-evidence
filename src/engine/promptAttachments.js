import { documentKind, extractDocument } from "./documentReader.js";

export const MAX_PROMPT_ATTACHMENTS = 8;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PROMPT_TEXT = 120_000;

const uid = () => `attachment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export function isImageAttachment(attachment) {
  return attachment?.kind === "image" && /^data:image\//i.test(attachment.dataUrl || "");
}

export async function promptAttachmentFromFile(file) {
  if (!file) throw new Error("No file selected.");
  const type = file.type || "application/octet-stream";
  if (type.startsWith("image/")) {
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} exceeds the 10 MB image limit.`);
    return { id: uid(), kind: "image", name: file.name, type, size: file.size, dataUrl: await readAsDataUrl(file), source: "upload" };
  }
  if (["pdf", "docx"].includes(documentKind(file))) {
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} exceeds the 10 MB PDF limit.`);
    const dataUrl = await readAsDataUrl(file);
    const parsed = await extractDocument(file);
    return { id: uid(), kind: "text", name: file.name, type, size: file.size, text: parsed.text.slice(0, MAX_PROMPT_TEXT), dataUrl, source: "upload", extracted: true, parser: parsed.parser, pages: parsed.pages };
  }
  if (documentKind(file) === "text") {
    if (file.size > MAX_TEXT_BYTES) throw new Error(`${file.name} exceeds the 2 MB text limit.`);
    return { id: uid(), kind: "text", name: file.name, type, size: file.size, text: (await file.text()).slice(0, MAX_PROMPT_TEXT), source: "upload" };
  }
  throw new Error(`${file.name} is not a supported prompt attachment. Attach text, code, data, PDF, or an image.`);
}

export function promptAttachmentFromProjectFile(file) {
  if (!file) throw new Error("Project file was not found.");
  return {
    id: uid(), kind: "text", name: file.name || file.path, type: file.type || "text/plain",
    size: String(file.content || "").length, text: String(file.content || "").slice(0, MAX_PROMPT_TEXT),
    path: file.path, source: "project",
  };
}

export function attachmentTranscriptMetadata(attachments = []) {
  return attachments.map(({ kind, name, type, size, source, path, extracted, parser, pages }) => ({
    kind, name, type, size, source, path: path || null, extracted: !!extracted,
    ...(parser ? { parser } : {}),
    ...(pages ? { pages } : {}),
  }));
}

export function attachmentLabel(attachment) {
  return attachment?.path || attachment?.name || "attachment";
}

export function buildMultimodalUserContent(prompt, attachments = []) {
  let remaining = MAX_PROMPT_TEXT;
  const textSections = [];
  for (const attachment of attachments) {
    if (attachment.kind !== "text") continue;
    const content = String(attachment.text || "").slice(0, Math.max(0, remaining));
    remaining -= content.length;
    textSections.push(`\n\nATTACHMENT: ${attachmentLabel(attachment)}\n---\n${content}\n---`);
    if (remaining <= 0) break;
  }
  const blocks = [{ type: "text", text: `${String(prompt || "")}${textSections.join("")}` }];
  for (const attachment of attachments.filter(isImageAttachment)) {
    blocks.push({ type: "image_url", image_url: { url: attachment.dataUrl, detail: "auto" } });
  }
  return blocks.length === 1 ? blocks[0].text : blocks;
}

export function providerCanSeeImages(provider) {
  if (!provider) return false;
  const model = String(provider.model || provider.defaultModel || "").toLowerCase();
  if (provider.id === "openai") return /gpt-(?:4o|4\.1|5)|o[134]/.test(model);
  if (provider.id === "openrouter") return /vision|vl|pixtral|gpt-4|gpt-5|claude-3|claude-sonnet|gemini|qwen2\.5-vl|qwen-vl|grok-.*vision/.test(model);
  if (provider.id === "qwen") return /\bvl\b|qwen.*vl/.test(model);
  if (provider.id === "mistral") return /pixtral/.test(model);
  if (provider.id === "xai") return /vision|grok-2/.test(model);
  return false;
}
