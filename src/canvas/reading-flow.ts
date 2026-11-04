export function flowSteps(text: string): string[] | undefined {
  const steps = text.trim().split(/\r?\n/u).map(line => line.trim());
  if (steps.length < 2 || steps.length > 20 || steps.some(line => !line || line.length > 120 || /[<>`]/u.test(line))) return;
  return steps;
}
