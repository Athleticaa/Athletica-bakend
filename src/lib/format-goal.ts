export function formatGoal<T>(goal: T): T | string {
  if (typeof goal !== "string") return goal;
  return goal.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}
