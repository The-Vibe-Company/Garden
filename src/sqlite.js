let sqliteModulePromise;
let warningPatchInstalled = false;

function suppressSqliteExperimentalWarning() {
  if (warningPatchInstalled) {
    return;
  }
  warningPatchInstalled = true;
  const originalEmitWarning = process.emitWarning.bind(process);
  process.emitWarning = (warning, ...args) => {
    const warningName =
      typeof warning === "string" ? args[0]?.type ?? "" : warning?.name ?? "";
    if (warningName === "ExperimentalWarning") {
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
