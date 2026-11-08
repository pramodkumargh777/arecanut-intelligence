import { describe, expect, it } from "vitest";
import * as developmentWorker from "./dev-worker";
import productionWorker from "./index";

describe("local Worker entrypoint", () => {
  it("exports only the production default handler", () => {
    expect(Object.keys(developmentWorker)).toEqual(["default"]);
    expect(developmentWorker.default).toBe(productionWorker);
  });
});
