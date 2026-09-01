/**
 * The scope tree, as plain data.
 *
 * Mirrors `core/scope.ts`'s own `ScopeNode`, declared separately so that `ui/`
 * needs no import from `core/`. Two declarations of four fields is a smaller
 * price than the UI layer depending on the framework, and `app/` is where the
 * two meet — it builds one from the other, and would not compile if they
 * drifted.
 */
export interface ScopeRow {
  name: string;
  openedAt: number;
  owned: number;
  children: ScopeRow[];
}
