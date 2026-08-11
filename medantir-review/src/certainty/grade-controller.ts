// Integrated intervention vertical exposes evidence submission, not direct GRADE
// concern labels. The deterministic GRADE engine remains the sole authority for
// converting evidence + frozen policy into certainty-domain judgements.
export {
  buildGradeEvidenceCatalog,
  parseGradeOutcomeEvidenceSubmission as parseGradeReviewSubmission,
  submitGradeOutcomeEvidenceAndResume as submitGradeReviewAndResume,
} from './grade-evidence-controller.js';

export type {
  GradeEvidenceCatalogEntry,
  GradeOutcomeEvidenceReceipt,
  GradeOutcomeEvidenceSubmission as GradeReviewSubmission,
} from './grade-evidence-controller.js';
