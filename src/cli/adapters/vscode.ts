// SPDX-License-Identifier: Apache-2.0
//
// VS Code GitHub Copilot adapter. VS Code's agent-plugin system loads this
// plugin via its Claude-format adapter (it detects .claude-plugin/plugin.json,
// reads hooks/hooks.json, and injects CLAUDE_PLUGIN_ROOT), so the same hook
// commands run under both hosts. The stdin payload shape matches Claude Code
// (snake_case: session_id, cwd, tool_name, tool_input, tool_response,
// transcript_path) but differs in three ways this adapter normalizes:
//
//   1. Tool names are VS Code's (read_file, create_file,
//      replace_string_in_file, run_in_terminal, ...) instead of Claude's
//      (Read, Write, Edit, Bash, ...).
//   2. Tool inputs use camelCase keys (filePath, oldString, newString)
//      instead of snake_case (file_path, old_string, new_string).
//   3. tool_response is a plain string (the rendered tool result text), not a
//      structured object.
//
// Claude Code never emits these shapes, so detection via tool name / transcript
// path is unambiguous (see isVscodeHookPayload).
import type { PlatformAdapter, HookResult } from '../types.js';
import { AdapterRejectedInput, isValidCwd } from './errors.js';

const MAX_AGENT_FIELD_LEN = 128;
const pickAgentField = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_AGENT_FIELD_LEN ? v : undefined;

/**
 * VS Code tool name → canonical Claude Code tool name. Covers both the modern
 * names and the legacy `copilot_`-prefixed aliases (see
 * microsoft/vscode-copilot-chat src/extension/tools/common/toolNames.ts).
 * Unmapped tools keep their VS Code name — the observation pipeline stores
 * tool names verbatim, so only tools with downstream semantics (file reads /
 * edits / shell) need canonical names.
 */
const VSCODE_TOOL_NAME_MAP: Record<string, string> = {
  read_file: 'Read',
  copilot_readFile: 'Read',
  create_file: 'Write',
  copilot_createFile: 'Write',
  replace_string_in_file: 'Edit',
  copilot_replaceString: 'Edit',
  multi_replace_string_in_file: 'MultiEdit',
  copilot_multiReplaceString: 'MultiEdit',
  insert_edit_into_file: 'Edit',
  copilot_insertEdit: 'Edit',
  apply_patch: 'Edit',
  copilot_applyPatch: 'Edit',
  run_in_terminal: 'Bash',
  grep_search: 'Grep',
  copilot_findTextInFiles: 'Grep',
  file_search: 'Glob',
  copilot_findFiles: 'Glob',
  list_dir: 'LS',
  copilot_listDirectory: 'LS',
  fetch_webpage: 'WebFetch',
  edit_notebook_file: 'NotebookEdit',
  copilot_editNotebook: 'NotebookEdit',
  manage_todo_list: 'TodoWrite',
};

/** camelCase tool-input keys → the snake_case keys the handlers expect. */
const VSCODE_INPUT_KEY_MAP: Record<string, string> = {
  filePath: 'file_path',
  oldString: 'old_string',
  newString: 'new_string',
  notebookPath: 'notebook_path',
};

export function mapVscodeToolName(toolName: unknown): string | undefined {
  return typeof toolName === 'string' ? VSCODE_TOOL_NAME_MAP[toolName] : undefined;
}

export function normalizeVscodeToolInput(toolInput: unknown): unknown {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return toolInput;
  }
  const input = toolInput as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const mapped = VSCODE_INPUT_KEY_MAP[key];
    // Never clobber an explicit snake_case key with a renamed camelCase one.
    if (mapped && !(mapped in input)) {
      normalized[mapped] = value;
    } else {
      normalized[key] = value;
    }
  }
  // multi_replace_string_in_file nests per-file edits under `replacements`.
  if (Array.isArray(input.replacements)) {
    normalized.replacements = input.replacements.map(normalizeVscodeToolInput);
  }
  return normalized;
}

/**
 * Recognize a VS Code Copilot hook payload arriving on the `claude-code`
 * platform path (the plugin's hooks.json is shared between hosts, so both
 * dispatch `hook claude-code <event>`). Two independent signals:
 *
 *  - tool_name is a known VS Code tool (tool events), or
 *  - transcript_path points into VS Code's Copilot Chat workspace storage
 *    (`.../workspaceStorage/<hash>/GitHub.copilot-chat/transcripts/...`),
 *    which covers SessionStart / UserPromptSubmit / Stop. Claude Code
 *    transcripts always live under ~/.claude/projects/.
 */
export function isVscodeHookPayload(raw: unknown): boolean {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (mapVscodeToolName(r.tool_name) !== undefined) return true;
  const transcriptPath = r.transcript_path;
  if (typeof transcriptPath === 'string') {
    const normalized = transcriptPath.replace(/\\/g, '/');
    if (normalized.includes('GitHub.copilot-chat/')) return true;
  }
  return false;
}

export const vscodeAdapter: PlatformAdapter = {
  normalizeInput(raw) {
    const r = (raw ?? {}) as any;
    const cwd = r.cwd ?? process.cwd();
    if (!isValidCwd(cwd)) {
      throw new AdapterRejectedInput('invalid_cwd');
    }
    return {
      sessionId: r.session_id ?? r.sessionId ?? r.id,
      cwd,
      platform: 'vscode',
      prompt: r.prompt,
      toolName: mapVscodeToolName(r.tool_name) ?? r.tool_name,
      toolInput: normalizeVscodeToolInput(r.tool_input),
      toolResponse: r.tool_response,
      transcriptPath: r.transcript_path,
      stopHookActive: r.stop_hook_active,
      agentId: pickAgentField(r.agent_id),
      agentType: pickAgentField(r.agent_type),
    };
  },
  // VS Code consumes the same hook output contract as Claude Code
  // (hookSpecificOutput / systemMessage / continue) — see
  // microsoft/vscode-copilot-chat ChatHookService._toHookResult.
  formatOutput(result) {
    const r = result ?? ({} as HookResult);
    if (r.hookSpecificOutput) {
      const output: Record<string, unknown> = { hookSpecificOutput: r.hookSpecificOutput };
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
