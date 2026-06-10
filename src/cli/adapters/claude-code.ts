import type { PlatformAdapter, NormalizedHookInput, HookResult } from '../types.js';
import { AdapterRejectedInput, isValidCwd } from './errors.js';
import { isVscodeHookPayload, vscodeAdapter } from './vscode.js';

const MAX_AGENT_FIELD_LEN = 128;
const pickAgentField = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_AGENT_FIELD_LEN ? v : undefined;

export const claudeCodeAdapter: PlatformAdapter = {
  normalizeInput(raw) {
    // The plugin's hooks.json is shared between Claude Code and VS Code
    // Copilot (VS Code loads Claude-format plugins and runs the same hook
    // commands), so VS Code payloads arrive on this platform path. Delegate
    // when the payload shape is VS Code's — Claude Code never emits those
    // tool names or transcript paths.
    if (isVscodeHookPayload(raw)) {
      return vscodeAdapter.normalizeInput(raw);
    }
    const r = (raw ?? {}) as any;
    const cwd = r.cwd ?? process.cwd();
    if (!isValidCwd(cwd)) {
      throw new AdapterRejectedInput('invalid_cwd');
    }
    return {
      sessionId: r.session_id ?? r.id ?? r.sessionId,
      cwd,
      prompt: r.prompt,
      toolName: r.tool_name,
      toolInput: r.tool_input,
      toolResponse: r.tool_response,
      transcriptPath: r.transcript_path,
      agentId: pickAgentField(r.agent_id),
      agentType: pickAgentField(r.agent_type),
    };
  },
  formatOutput(result) {
    const r = result ?? ({} as HookResult);
    if (r.hookSpecificOutput) {
      const output: Record<string, unknown> = { hookSpecificOutput: result.hookSpecificOutput };
      if (r.systemMessage) {
        output.systemMessage = r.systemMessage;
      }
      return output;
    }
    const output: Record<string, unknown> = {};
    if (r.systemMessage) {
      output.systemMessage = r.systemMessage;
    }
    return output;
  }
};
