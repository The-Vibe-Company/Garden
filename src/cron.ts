function range(start: number, end: number, step = 1) {
  const values: number[] = [];
  for (let current = start; current <= end; current += step) {
    values.push(current);
  }
  return values;
}

function parsePart(part: string, min: number, max: number) {
  if (part === "*") {
    return range(min, max);
  }

  const values = new Set<number>();
  for (const segment of part.split(",")) {
    const [base, stepRaw] = segment.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Invalid cron step: ${segment}`);
    }

    if (base === "*") {
      range(min, max, step).forEach((value) => values.add(value));
      continue;
    }

    if (base.includes("-")) {
      const [start, end] = base.split("-").map(Number);
      range(start, end, step).forEach((value) => values.add(value));
      continue;
    }

    const single = Number(base);
    if (!Number.isInteger(single)) {
      throw new Error(`Invalid cron value: ${segment}`);
    }
    values.add(single);
  }

  const normalized = [...values].filter((value) => value >= min && value <= max).sort((a, b) => a - b);
  if (normalized.length === 0) {
    throw new Error(`Cron part produced no valid values: ${part}`);
  }
  return normalized;
}

export function matchesCron(date: Date, expression: string) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Expected a 5-field cron expression, got: ${expression}`);
  }

  const [minutePart, hourPart, dayPart, monthPart, weekdayPart] = parts;
  const minuteValues = parsePart(minutePart, 0, 59);
  const hourValues = parsePart(hourPart, 0, 23);
  const dayValues = parsePart(dayPart, 1, 31);
  const monthValues = parsePart(monthPart, 1, 12);
  const weekdayValues = parsePart(weekdayPart, 0, 6);

  return (
    minuteValues.includes(date.getMinutes()) &&
    hourValues.includes(date.getHours()) &&
    dayValues.includes(date.getDate()) &&
    monthValues.includes(date.getMonth() + 1) &&
    weekdayValues.includes(date.getDay())
  );
}
