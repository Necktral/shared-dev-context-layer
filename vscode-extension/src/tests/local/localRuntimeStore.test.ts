import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLocalRuntimeStore } from "../../local/localRuntimeStore";
import { createInitialProjectRuntimeSnapshot } from "../../local/types";

test("InMemoryLocalRuntimeStore notifica cambios y protege snapshot de mutación externa", () => {
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot("local_private"));
  let notifications = 0;

  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });

  const first = store.getSnapshot();
  first.errors.push("mutated-outside");

  const second = store.getSnapshot();
  assert.equal(second.errors.length, 0);

  store.update((current) => ({
    ...current,
    runtime_state: "ready",
  }));

  assert.ok(notifications >= 2);
  assert.equal(store.getSnapshot().runtime_state, "ready");

  unsubscribe();
});
