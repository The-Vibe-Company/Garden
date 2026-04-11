function getPathValue(source, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => current?.[key], source);
}

function renderString(value, context) {
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, token) => {
    if (token.startsWith("json ")) {
      const path = token.slice(5).trim();
      const target = getPathValue(context, path);
      return JSON.stringify(target ?? null, null, 2);
    }

    const result = getPathValue(context, token.trim());
    if (result == null) {
      return "";
    }
    if (typeof result === "object") {
      return JSON.stringify(result);
    }
    return String(result);
  });
}

export function renderTemplate(value, context) {
  if (typeof value === "string") {
    return renderString(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => renderTemplate(entry, context));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, renderTemplate(entry, context)])
    );
  }
  return value;
}
