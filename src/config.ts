/** Browser-side config. The OpenRouter key lives in localStorage on THIS device only. */
const KEY_STORAGE = "weft-openrouter-key";
const MODEL_STORAGE = "weft-openrouter-model";

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? "";
}
export function setApiKey(k: string): void {
  if (k) localStorage.setItem(KEY_STORAGE, k.trim());
  else localStorage.removeItem(KEY_STORAGE);
}
export function hasApiKey(): boolean {
  return !!getApiKey();
}

/** The single chosen model that drives EVERYTHING — generation, grading, extraction, examples.
 *  Set once in settings/welcome; every code path reads this so nothing runs a model you didn't pick.
 *  Empty until the user chooses; callers should treat "" as "not yet set". */
export function getModel(): string {
  return localStorage.getItem(MODEL_STORAGE) ?? "";
}
export function setModel(m: string): void {
  if (m) localStorage.setItem(MODEL_STORAGE, m.trim());
  else localStorage.removeItem(MODEL_STORAGE);
}
export function hasModel(): boolean {
  return !!getModel();
}
