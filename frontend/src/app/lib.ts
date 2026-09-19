export const CATEGORIES = [
  "TRANSFER", "FOOD", "TRANSPORT", "SHOPPING", "BILLS",
  "EDUCATION", "HEALTH", "ENTERTAINMENT", "SAVINGS", "OTHER",
] as const;

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

let API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
if (API_URL.endsWith("/")) API_URL = API_URL.slice(0, -1);
if (!API_URL.endsWith("/api")) API_URL += "/api";
export { API_URL };

export function formatCurrency(cents: number) {
  const number = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
  return `৳${number}`;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}
