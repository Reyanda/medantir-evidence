import { getProject } from "./projectstore.js";

function encodePath(path) {
  return String(path || "").split("/").map(encodeURIComponent).join("/");
}

export async function inspectProjectGit(projectId, fetcher = fetch) {
  const project = getProject(projectId);
  if (!project) return { ok: false, state: "no-project", files: [] };
  if (!project.githubRepo) return { ok: false, state: "unlinked", files: [] };
  const { owner, repo, url } = project.githubRepo;
  try {
    const metadataResponse = await fetcher(`https://api.github.com/repos/${owner}/${repo}`, { headers: { Accept: "application/vnd.github+json" } });
    if (!metadataResponse.ok) return { ok: false, state: metadataResponse.status === 403 ? "rate-limited" : "unavailable", status: metadataResponse.status, files: [], url };
    const metadata = await metadataResponse.json();
    const branch = metadata.default_branch || "main";
    const files = [];
    for (const file of Object.values(project.files || {}).slice(0, 40)) {
      const response = await fetcher(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encodePath(file.path)}`);
      if (response.status === 404) {
        files.push({ path: file.path, status: "added" });
        continue;
      }
      if (!response.ok) {
        files.push({ path: file.path, status: "unknown", httpStatus: response.status });
        continue;
      }
      const remote = await response.text();
      files.push({ path: file.path, status: remote === String(file.content || "") ? "unchanged" : "modified" });
    }
    return { ok: true, state: "compared", branch, url, files, truncated: Object.keys(project.files || {}).length > 40 };
  } catch (error) {
    return { ok: false, state: "offline", error: String(error.message || error), files: [], url };
  }
}
