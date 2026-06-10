import { describe, it, expect } from 'bun:test';
import {
  vscodeAdapter,
  isVscodeHookPayload,
  mapVscodeToolName,
  normalizeVscodeToolInput,
} from '../../../src/cli/adapters/vscode.js';
import { claudeCodeAdapter } from '../../../src/cli/adapters/claude-code.js';
import { normalizePlatformSource } from '../../../src/shared/platform-source.js';

const VSCODE_TRANSCRIPT_PATH =
  '/Users/me/Library/Application Support/Code/User/workspaceStorage/abc123/GitHub.copilot-chat/transcripts/session-1.jsonl';

describe('mapVscodeToolName', () => {
  it('maps file tools to canonical Claude names', () => {
    expect(mapVscodeToolName('read_file')).toBe('Read');
    expect(mapVscodeToolName('create_file')).toBe('Write');
    expect(mapVscodeToolName('replace_string_in_file')).toBe('Edit');
    expect(mapVscodeToolName('multi_replace_string_in_file')).toBe('MultiEdit');
    expect(mapVscodeToolName('run_in_terminal')).toBe('Bash');
    expect(mapVscodeToolName('grep_search')).toBe('Grep');
    expect(mapVscodeToolName('file_search')).toBe('Glob');
    expect(mapVscodeToolName('list_dir')).toBe('LS');
  });

  it('maps legacy copilot_-prefixed aliases', () => {
    expect(mapVscodeToolName('copilot_readFile')).toBe('Read');
    expect(mapVscodeToolName('copilot_replaceString')).toBe('Edit');
  });

  it('returns undefined for Claude Code and unknown tool names', () => {
    expect(mapVscodeToolName('Read')).toBeUndefined();
    expect(mapVscodeToolName('Bash')).toBeUndefined();
    expect(mapVscodeToolName('semantic_search')).toBeUndefined();
    expect(mapVscodeToolName(undefined)).toBeUndefined();
  });
});

describe('normalizeVscodeToolInput', () => {
  it('renames camelCase keys to snake_case', () => {
    expect(normalizeVscodeToolInput({ filePath: '/a.ts', oldString: 'x', newString: 'y' }))
      .toEqual({ file_path: '/a.ts', old_string: 'x', new_string: 'y' });
  });

  it('keeps unrelated keys and non-object inputs intact', () => {
    expect(normalizeVscodeToolInput({ command: 'bun test', isBackground: false }))
      .toEqual({ command: 'bun test', isBackground: false });
    expect(normalizeVscodeToolInput(undefined)).toBeUndefined();
    expect(normalizeVscodeToolInput('raw')).toBe('raw');
  });

  it('does not clobber an existing snake_case key', () => {
    expect(normalizeVscodeToolInput({ filePath: '/camel.ts', file_path: '/snake.ts' }))
      .toEqual({ filePath: '/camel.ts', file_path: '/snake.ts' });
  });

  it('normalizes nested multi-replace replacements', () => {
    expect(normalizeVscodeToolInput({
      replacements: [{ filePath: '/a.ts', oldString: 'x', newString: 'y' }],
    })).toEqual({
      replacements: [{ file_path: '/a.ts', old_string: 'x', new_string: 'y' }],
    });
  });
});

describe('isVscodeHookPayload', () => {
  it('detects by VS Code tool name', () => {
    expect(isVscodeHookPayload({ tool_name: 'create_file', cwd: '/tmp' })).toBe(true);
  });

  it('detects by Copilot Chat transcript path (incl. Windows separators)', () => {
    expect(isVscodeHookPayload({ transcript_path: VSCODE_TRANSCRIPT_PATH })).toBe(true);
    expect(isVscodeHookPayload({
      transcript_path: 'C:\\Users\\me\\AppData\\Roaming\\Code\\User\\workspaceStorage\\abc\\GitHub.copilot-chat\\transcripts\\s.jsonl',
    })).toBe(true);
  });

  it('rejects Claude Code payloads', () => {
    expect(isVscodeHookPayload({
      tool_name: 'Read',
      transcript_path: '/Users/me/.claude/projects/-Users-me-proj/abc.jsonl',
    })).toBe(false);
    expect(isVscodeHookPayload({})).toBe(false);
  });
});

describe('vscodeAdapter.normalizeInput', () => {
  it('normalizes a PostToolUse payload', () => {
    const normalized = vscodeAdapter.normalizeInput({
      session_id: 's1',
      cwd: '/workspace',
      tool_name: 'replace_string_in_file',
      tool_input: { filePath: '/workspace/a.ts', oldString: 'x', newString: 'y' },
      tool_response: 'Edited /workspace/a.ts',
      transcript_path: VSCODE_TRANSCRIPT_PATH,
    });

    expect(normalized.platform).toBe('vscode');
    expect(normalized.sessionId).toBe('s1');
    expect(normalized.toolName).toBe('Edit');
    expect(normalized.toolInput).toEqual({ file_path: '/workspace/a.ts', old_string: 'x', new_string: 'y' });
    expect(normalized.toolResponse).toBe('Edited /workspace/a.ts');
    expect(normalized.transcriptPath).toBe(VSCODE_TRANSCRIPT_PATH);
  });

  it('keeps unmapped tool names verbatim', () => {
    const normalized = vscodeAdapter.normalizeInput({
      session_id: 's1',
      cwd: '/workspace',
      tool_name: 'semantic_search',
      tool_input: { query: 'auth flow' },
    });
    expect(normalized.toolName).toBe('semantic_search');
  });
});

describe('claudeCodeAdapter delegation to vscode', () => {
  it('re-attributes VS Code payloads arriving on the claude-code path', () => {
    const normalized = claudeCodeAdapter.normalizeInput({
      session_id: 's1',
      cwd: '/workspace',
      tool_name: 'read_file',
      tool_input: { filePath: '/workspace/big.ts' },
      transcript_path: VSCODE_TRANSCRIPT_PATH,
    });

    expect(normalized.platform).toBe('vscode');
    expect(normalized.toolName).toBe('Read');
    expect(normalized.toolInput).toEqual({ file_path: '/workspace/big.ts' });
  });

  it('leaves genuine Claude Code payloads untouched', () => {
    const normalized = claudeCodeAdapter.normalizeInput({
      session_id: 's1',
      cwd: '/workspace',
      tool_name: 'Read',
      tool_input: { file_path: '/workspace/big.ts' },
      transcript_path: '/Users/me/.claude/projects/-Users-me-proj/abc.jsonl',
    });

    expect(normalized.platform).toBeUndefined();
    expect(normalized.toolName).toBe('Read');
  });
});

describe('normalizePlatformSource — vscode', () => {
  it('buckets vscode/copilot variants into vscode', () => {
    expect(normalizePlatformSource('vscode')).toBe('vscode');
    expect(normalizePlatformSource('vscode-copilot')).toBe('vscode');
    expect(normalizePlatformSource('github-copilot')).toBe('vscode');
  });

  it('does not disturb existing buckets', () => {
    expect(normalizePlatformSource('claude-code')).toBe('claude');
    expect(normalizePlatformSource('codex')).toBe('codex');
    expect(normalizePlatformSource('cursor')).toBe('cursor');
  });
});
