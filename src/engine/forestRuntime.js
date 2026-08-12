// forestRuntime.js — binds the Forest Plot Studio canvas to the live review
// runtime: project selection, review.json persistence, and the dataset model.
//
// The canvas renders ONE outcome-level meta-analysis dataset that lives inside
// the review object (`review.objects.meta`), so it persists in the project's
// review.json alongside every other review artifact and survives reload.

import { loadReview, saveReview } from "./reviewengine.js";
import { listProjects, isReviewProject, getProject } from "./projectstore.js";
import { readDataset, writeDataset, emptyDataset } from "./forestModel.js";

export * from "./forestModel.js";

// --- project / review binding ---------------------------------------------

export function listReviewProjects() {
  return listProjects().filter(isReviewProject);
}

// Loads everything the studio needs for one project in a single call.
export function loadStudio(projectId) {
  if (!projectId) return { project: null, review: null, dataset: emptyDataset() };
  const project = getProject(projectId);
  const review = loadReview(projectId);
  const dataset = readDataset(review);
  return { project, review, dataset };
}

// Persists the dataset back into review.json. Returns the updated review.
export function persistDataset(projectId, review, dataset) {
  if (!review) return review;
  const next = writeDataset(review, dataset);
  if (projectId) saveReview(projectId, next);
  return next;
}
