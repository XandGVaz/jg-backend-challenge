import { E2E } from './env.js';

/** Controla os containers da stack (queda e reinício de processos, REQUISITOS §13). */
export async function compose(...args: string[]): Promise<string> {
  const child = Bun.spawn(['docker', 'compose', '-f', E2E.composeFile, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(`docker compose ${args.join(' ')} failed (${code}): ${err}`);
  }
  return out;
}

export async function runningReplicas(service: string): Promise<number> {
  const out = await compose('ps', '--status', 'running', '--format', '{{.Service}}');
  return out.split('\n').filter((line) => line.trim() === service).length;
}

export async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs = 60_000,
  stepMs = 500,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await Bun.sleep(stepMs);
  }
  return false;
}
