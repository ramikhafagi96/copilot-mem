import { describe, it, expect } from 'bun:test';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

// tools/list must not advertise server-beta-only tools in worker mode —
// non-Claude MCP clients (VS Code Copilot) pick tools by name match and would
// call observation_search over the worker-mode `search`, surfacing a runtime
// error to the user. Spawns the BUILT bundle, so `npm run build` must have run.

const MCP_SERVER_PATH = join(import.meta.dir, '../../plugin/scripts/mcp-server.cjs');

const SERVER_BETA_ONLY = [
  'observation_add',
  'observation_record_event',
  'observation_search',
  'observation_context',
  'observation_generation_status',
  'memory_add',
  'memory_search',
  'memory_context',
];

function rpc(id: number, method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
}

async function listToolNames(env: Record<string, string>): Promise<string[]> {
  const child = spawn(process.execPath, [MCP_SERVER_PATH], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  try {
    const names = await new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('tools/list timed out')), 15_000);
      let buffer = '';

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        for (const line of buffer.split('\n')) {
          if (!line.trim()) continue;
          let message: any;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message.id === 1) {
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
            child.stdin.write(rpc(2, 'tools/list'));
          }
          if (message.id === 2) {
            clearTimeout(timer);
            resolve((message.result?.tools ?? []).map((t: any) => t.name));
          }
        }
      });
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
      child.on('exit', (code) => {
        // Only an error if we haven't resolved yet; resolve() above wins races.
        clearTimeout(timer);
        reject(new Error(`mcp-server exited early (code ${code})`));
      });

      child.stdin.write(rpc(1, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'tool-list-test', version: '0.0.0' },
      }));
    });
    return names;
  } finally {
    child.kill('SIGTERM');
  }
}

describe('MCP tools/list — runtime-gated server-beta tools', () => {
  it.skipIf(!existsSync(MCP_SERVER_PATH))('hides server-beta-only tools in worker runtime', async () => {
    const names = await listToolNames({ CLAUDE_MEM_RUNTIME: 'worker' });

    expect(names).toContain('search');
    expect(names).toContain('timeline');
    expect(names).toContain('get_observations');
    for (const tool of SERVER_BETA_ONLY) {
      expect(names).not.toContain(tool);
    }
  }, 20_000);

  it.skipIf(!existsSync(MCP_SERVER_PATH))('advertises server-beta tools when the runtime is server-beta', async () => {
    const names = await listToolNames({ CLAUDE_MEM_RUNTIME: 'server-beta' });

    for (const tool of SERVER_BETA_ONLY) {
      expect(names).toContain(tool);
    }
    // Worker tools remain listed too — server-beta is additive.
    expect(names).toContain('search');
  }, 20_000);
});
