import { expect, test } from "bun:test";
import path from "node:path";

test("research-cycle CLI validates arguments without starting a provider run", async () => {
  const cliPath = path.resolve(import.meta.dir, "../scripts/research-cycle.ts");
  const help = Bun.spawn(["bun", cliPath, "--help"], { stdout: "pipe", stderr: "pipe" });
  expect(await help.exited).toBe(0);
  expect(await new Response(help.stdout).text()).toContain("research-cycle.ts --date=YYYYMMDD");

  const invalid = Bun.spawn(["bun", cliPath, "--unknown=value"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await invalid.exited).toBe(1);
  expect(await new Response(invalid.stderr).text()).toContain("Unknown option --unknown");
});
