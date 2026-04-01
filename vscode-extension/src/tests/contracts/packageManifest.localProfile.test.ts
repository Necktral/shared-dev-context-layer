import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("package.json incluye comandos/settings de local_private sin remover comandos existentes", () => {
  const manifestPath = resolve(process.cwd(), "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    contributes: {
      commands: Array<{ command: string }>;
      configuration: { properties: Record<string, unknown> };
      views?: Record<string, Array<{ id: string }>>;
    };
  };

  const commands = new Set(manifest.contributes.commands.map((entry) => entry.command));
  const requiredExisting = [
    "wisContextSync.loadOperationalContext",
    "wisContextSync.resetSession",
    "wisContextSync.prepareHandoff",
    "wisContextSync.searchContext",
    "wisContextSync.upsertContextItem",
  ];
  const requiredLocal = [
    "wisContextSync.localIndex",
    "wisContextSync.localPrepareTask",
    "wisContextSync.localRunCodex",
    "wisContextSync.localRefresh",
  ];

  for (const command of requiredExisting) {
    assert.ok(commands.has(command), `Missing existing command: ${command}`);
  }

  for (const command of requiredLocal) {
    assert.ok(commands.has(command), `Missing local command: ${command}`);
  }

  const properties = manifest.contributes.configuration.properties;
  assert.ok(Object.hasOwn(properties, "wisContextSync.operationProfile"));
  assert.ok(Object.hasOwn(properties, "wisContextSync.codexCliCommand"));

  const explorerViews = manifest.contributes.views?.explorer ?? [];
  assert.ok(explorerViews.some((view) => view.id === "wisContextSync.localRuntimePanel"));
});
