export const CATEGORIES = [
  "TRANSFER", "FOOD", "TRANSPORT", "SHOPPING", "BILLS",
  "EDUCATION", "HEALTH", "ENTERTAINMENT", "SAVINGS", "OTHER",
] as const;

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}
