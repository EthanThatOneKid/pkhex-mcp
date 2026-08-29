import { assertEquals } from "@std/assert";
import { parseArgs } from "@std/cli/parse-args";

/** Mirror the flag definition from src/main.ts. */
function parse(argv: string[]) {
  return parseArgs(argv, {
    boolean: ["stdio", "help"],
    string: ["port"],
    default: { stdio: false, port: undefined as string | undefined },
    alias: { h: "help" },
  });
}

Deno.test("bare args: stdio is false, help is false", () => {
  const flags = parse([]);
  assertEquals(flags.stdio, false);
  assertEquals(flags.help, false);
  assertEquals(flags.port, undefined);
});

Deno.test("--stdio flag", () => {
  const flags = parse(["--stdio"]);
  assertEquals(flags.stdio, true);
});

Deno.test("-h is alias for --help", () => {
  const flags = parse(["-h"]);
  assertEquals(flags.help, true);
});

Deno.test("--help flag", () => {
  const flags = parse(["--help"]);
  assertEquals(flags.help, true);
});

Deno.test("--port 9000", () => {
  const flags = parse(["--port", "9000"]);
  assertEquals(flags.port, "9000");
});

Deno.test("--stdio --port 3000 combined", () => {
  const flags = parse(["--stdio", "--port", "3000"]);
  assertEquals(flags.stdio, true);
  assertEquals(flags.port, "3000");
});
