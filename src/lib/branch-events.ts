export const BRANCH_SWITCHED_EVENT = "relic:branch-switched";

export function dispatchBranchSwitched(): void {
  window.dispatchEvent(new CustomEvent(BRANCH_SWITCHED_EVENT));
}

export function onBranchSwitched(cb: () => void): () => void {
  window.addEventListener(BRANCH_SWITCHED_EVENT, cb);
  return () => window.removeEventListener(BRANCH_SWITCHED_EVENT, cb);
}
