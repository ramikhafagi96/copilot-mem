import { describe, it, expect } from 'bun:test';
import { extractLastMessageFromJsonl } from '../../src/shared/transcript-parser.js';

function entry(type: string, data: Record<string, unknown>, id: string): string {
  return JSON.stringify({ type, data, id, timestamp: '2026-06-10T12:00:00Z', parentId: null });
}

const vscodeTranscript = [
  entry('session.start', { sessionId: 's1', version: 1, producer: 'copilot-agent' }, 'e1'),
  entry('user.message', { content: 'fix the login bug' }, 'e2'),
  entry('assistant.turn_start', { turnId: 't1' }, 'e3'),
  entry('assistant.message', { messageId: 'm1', content: 'Looking at the auth flow now.', toolRequests: [] }, 'e4'),
  entry('tool.execution_start', { toolCallId: 'c1', toolName: 'read_file', arguments: { filePath: '/a.ts' } }, 'e5'),
  entry('tool.execution_complete', { toolCallId: 'c1', success: true, result: { content: '...' } }, 'e6'),
  entry('assistant.message', { messageId: 'm2', content: 'Fixed the null check in login().', toolRequests: [] }, 'e7'),
  entry('assistant.turn_end', { turnId: 't1' }, 'e8'),
].join('\n');

describe('extractLastMessageFromJsonl — VS Code copilot-agent transcripts', () => {
  it('extracts the last assistant message from data.content', () => {
    expect(extractLastMessageFromJsonl(vscodeTranscript, 'assistant', false))
      .toBe('Fixed the null check in login().');
  });

  it('extracts the last user message', () => {
    expect(extractLastMessageFromJsonl(vscodeTranscript, 'user', false))
      .toBe('fix the login bug');
  });

  it('skips trailing tool-only assistant turns with empty content', () => {
    const withToolOnlyTail = [
      vscodeTranscript,
      entry('assistant.message', { messageId: 'm3', content: '', toolRequests: [{ toolCallId: 'c2', name: 'run_in_terminal', arguments: '{}', type: 'function' }] }, 'e9'),
    ].join('\n');
    expect(extractLastMessageFromJsonl(withToolOnlyTail, 'assistant', false))
      .toBe('Fixed the null check in login().');
  });

  it('still parses Claude Code transcripts unchanged', () => {
    const claudeTranscript = [
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi there' }] } }),
    ].join('\n');
    expect(extractLastMessageFromJsonl(claudeTranscript, 'assistant', false)).toBe('hi there');
  });
});
