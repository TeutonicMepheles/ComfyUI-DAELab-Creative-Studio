const generationReports = new Map();

export function getGenerationFileReport(kind) {
  if (!generationReports.has(kind)) {
    const report = fetch('/daelab/studio/model-files?kind=' + encodeURIComponent(kind), {
      signal: AbortSignal.timeout(15000),
    }).then(async response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const {profiles} = await response.json();
      return Object.entries(profiles);
    }).catch(error => {
      generationReports.delete(kind);
      throw error;
    });
    generationReports.set(kind, report);
  }
  return generationReports.get(kind);
}
