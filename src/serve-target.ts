export interface ServeTarget {
  hostname: string;
  port: number;
  /** True when running under `deno desktop` (DENO_SERVE_ADDRESS injected). */
  desktop: boolean;
}

/**
 * Resolve where Deno.serve should bind.
 * - Under `deno desktop` the runtime injects DENO_SERVE_ADDRESS
 *   ("tcp:127.0.0.1:<port>") and adopts the served URL into the window.
 * - Plain dev mode binds loopback 8941 unless PKHEX_PORT overrides.
 */
export function resolveServeTarget(
  env: Record<string, string | undefined>,
): ServeTarget {
  const address = env["DENO_SERVE_ADDRESS"];
  if (address) {
    const parsed = Number(address.split(":").pop());
    return {
      hostname: "127.0.0.1",
      port: Number.isFinite(parsed) && parsed > 0 ? parsed : 8941,
      desktop: true,
    };
  }
  const override = Number(env["PKHEX_PORT"] ?? 8941);
  return {
    hostname: "127.0.0.1",
    port: Number.isFinite(override) && override > 0 ? override : 8941,
    desktop: false,
  };
}
