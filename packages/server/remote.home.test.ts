import { afterEach, describe, expect, test } from "bun:test";
import { getHomePort } from "./remote";

const ORIGINAL_ENV = {
  PLANNOTATOR_HOME_PORT: process.env.PLANNOTATOR_HOME_PORT,
  PLANNOTATOR_PORT: process.env.PLANNOTATOR_PORT,
};

function restoreEnv(name: "PLANNOTATOR_HOME_PORT" | "PLANNOTATOR_PORT", value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

afterEach(() => {
  restoreEnv("PLANNOTATOR_HOME_PORT", ORIGINAL_ENV.PLANNOTATOR_HOME_PORT);
  restoreEnv("PLANNOTATOR_PORT", ORIGINAL_ENV.PLANNOTATOR_PORT);
});

describe("getHomePort", () => {
  test("prefers PLANNOTATOR_HOME_PORT", () => {
    process.env.PLANNOTATOR_HOME_PORT = "19430";
    process.env.PLANNOTATOR_PORT = "19432";

    expect(getHomePort()).toBe(19430);
  });

  test("falls back to PLANNOTATOR_PORT", () => {
    process.env.PLANNOTATOR_HOME_PORT = "";
    process.env.PLANNOTATOR_PORT = "20400";

    expect(getHomePort()).toBe(20400);
  });

  test("uses the default fixed local home port", () => {
    process.env.PLANNOTATOR_HOME_PORT = "";
    process.env.PLANNOTATOR_PORT = "";

    expect(getHomePort()).toBe(19430);
  });
});
