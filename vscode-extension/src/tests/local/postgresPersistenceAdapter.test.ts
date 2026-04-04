import test from "node:test";
import assert from "node:assert/strict";
import { mapPostgresError, PostgresPersistenceAdapter } from "../../local/persistence/postgresPersistenceAdapter";

test("mapPostgresError clasifica errores conocidos", () => {
  const authError = Object.assign(new Error("password authentication failed"), { code: "28P01" });
  const missingTableError = Object.assign(new Error("relation does not exist"), { code: "42P01" });
  assert.equal(mapPostgresError(authError), "Credenciales de PostgreSQL inválidas (28P01).");
  assert.equal(mapPostgresError(missingTableError), "Tabla requerida no existe (42P01). Ejecuta Local Refresh para migrar.");
});

test("PostgresPersistenceAdapter rechaza schema inválido", () => {
  assert.throws(
    () =>
      new PostgresPersistenceAdapter({
        extensionPath: process.cwd(),
        config: {
          enabled: true,
          host: "localhost",
          port: 5432,
          database: "wis_context",
          user: "wis_admin",
          password: "",
          schema: "invalid-schema!",
          ssl: false,
        },
      }),
    /localDb\.schema inválido/,
  );
});
