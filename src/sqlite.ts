let sqliteModulePromise;
let warningPatchInstalled = false;

function suppressSqliteExperimentalWarning() {
  if (warningPatchInstalled) {
    return;
  }
  warningPatchInstalled = true;
  const originalEmitWarning = process.emitWarning.bind(process);
  process.emitWarning = (warning, ...args) => {
    const warningName = typeof warning === "string" ? args[1] ?? args[0]?.type ?? "" : warning?.name ?? "";
    const warningMessage = typeof warning === "string" ? warning : warning?.message ?? "";
    if (warningName === "ExperimentalWarning" || warningMessage.includes("SQLite is an experimental feature")) {
      return;
    }
    return originalEmitWarning(warning, ...args);
  };
}

export async function loadSqliteModule() {
  suppressSqliteExperimentalWarning();
  if (!sqliteModulePromise) {
    sqliteModulePromise = import("node:sqlite");
  }
  return sqliteModulePromise;
}
