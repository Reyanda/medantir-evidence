// Compatibility adapter. The canonical Project model lives in projectstore.js.

import {
  STATUSES,
  listProjects,
  getProject,
  updateProject,
  createProject as createCanonicalProject,
  addTask,
  toggleTask,
  setDetached,
  archiveProject,
  restoreProject,
  listArchivedProjects,
  scheduleProject,
  projectStats,
} from "./projectstore.js";

export { STATUSES, listProjects, listArchivedProjects, getProject, updateProject, addTask, toggleTask, setDetached, archiveProject, restoreProject, scheduleProject, projectStats };

// Legacy ProjectsTab callers expected an id; new callers should import projectstore.
export function createProject(name, options) {
  return createCanonicalProject(name, options).id;
}
