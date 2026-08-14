export const BRANCH_SWITCHED_EVENT = "relic:branch-switched";
export const SCHEMA_CHANGED_EVENT = "relic:schema-changed";

export function dispatchBranchSwitched(): void {
  window.dispatchEvent(new CustomEvent(BRANCH_SWITCHED_EVENT));
}

export function onBranchSwitched(cb: () => void): () => void {
  window.addEventListener(BRANCH_SWITCHED_EVENT, cb);
  return () => window.removeEventListener(BRANCH_SWITCHED_EVENT, cb);
}

/** Fire when tables/columns in the current schema change (create/drop/alter). */
export function dispatchSchemaChanged(): void {
  window.dispatchEvent(new CustomEvent(SCHEMA_CHANGED_EVENT));
}

export function onSchemaChanged(cb: () => void): () => void {
  window.addEventListener(SCHEMA_CHANGED_EVENT, cb);
  return () => window.removeEventListener(SCHEMA_CHANGED_EVENT, cb);
}
