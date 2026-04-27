/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { safeJsonParse } from '../../utils/safeJsonParse.js';
import { createDebugLogger } from '../../utils/debugLogger.js';

const debugLogger = createDebugLogger('XML_TOOL_CALL_PARSER');

const TOOL_CALL_OPEN = '<tool_call>';
const TOOL_CALL_CLOSE = '</tool_call>';

export interface ParsedXmlToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * Streaming parser for text-embedded tool calls.
 *
 * Handles two formats injected by qwenCoderToolCallExamples / qwenVlToolCallExamples
 * in the system prompt when the model outputs tool calls as delta.content text
 * rather than delta.tool_calls (OpenAI API function-calling mechanism).
 *
 * qwenCoder XML format:
 *   <tool_call>
 *   <function=TOOLNAME>
 *   <parameter=key>value</parameter>
 *   </function>
 *   </tool_call>
 *
 * qwenVL JSON format:
 *   <tool_call>
 *   {"name": "TOOLNAME", "arguments": {"key": "value"}}
 *   </tool_call>
 */
export class XmlToolCallParser {
  private state: 'normal' | 'buffering' = 'normal';
  private normalHeld = '';
  private toolCallContent = '';
  private completed: ParsedXmlToolCall[] = [];
  private callIdx = 0;

  /**
   * Process a streaming text chunk.
   * Returns the text that should be displayed to the user (with <tool_call> blocks removed).
   * Completed tool calls are accumulated internally and retrieved via getCompletedToolCalls().
   */
  processChunk(text: string): string {
    if (this.state === 'normal') {
      return this.processNormal(this.normalHeld + text);
    } else {
      this.toolCallContent += text;
      return this.tryFlushBuffering();
    }
  }

  private processNormal(text: string): string {
    const idx = text.indexOf(TOOL_CALL_OPEN);
    if (idx === -1) {
      const holdLen = longestSuffixPrefix(text, TOOL_CALL_OPEN);
      if (holdLen > 0) {
        this.normalHeld = text.slice(-holdLen);
        return text.slice(0, -holdLen);
      }
      this.normalHeld = '';
      return text;
    }

    const before = text.slice(0, idx);
    const after = text.slice(idx + TOOL_CALL_OPEN.length);
    this.normalHeld = '';
    this.state = 'buffering';
    this.toolCallContent = after;
    return before + this.tryFlushBuffering();
  }

  private tryFlushBuffering(): string {
    const endIdx = this.toolCallContent.indexOf(TOOL_CALL_CLOSE);
    if (endIdx === -1) return '';

    const content = this.toolCallContent.slice(0, endIdx).trim();
    const after = this.toolCallContent.slice(endIdx + TOOL_CALL_CLOSE.length);
    this.toolCallContent = '';
    this.state = 'normal';

    this.parse(content);

    // Process any remaining text after </tool_call> (may contain more tool calls)
    return this.processNormal(after);
  }

  private parse(content: string): void {
    // qwenVL JSON format: {"name": "...", "arguments": {...}}
    if (content.startsWith('{')) {
      try {
        const parsed = safeJsonParse<Record<string, unknown>>(content);
        const name = parsed['name'];
        const rawArgs = parsed['arguments'];
        if (typeof name === 'string') {
          const args: Record<string, unknown> =
            typeof rawArgs === 'string'
              ? safeJsonParse(rawArgs)
              : ((rawArgs as Record<string, unknown>) ?? {});
          this.completed.push({
            id: `xml_${++this.callIdx}_${Date.now()}`,
            name,
            args,
          });
          debugLogger.debug(`Parsed qwenVL JSON tool call: ${name}`);
          return;
        }
      } catch {
        // fall through to XML parsing
      }
    }

    // qwenCoder XML format: <function=TOOLNAME><parameter=key>value</parameter>
    const funcMatch = content.match(/<function=([^\s>/]+)/);
    if (!funcMatch) {
      debugLogger.warn(
        'XmlToolCallParser: could not extract function name from',
        content.slice(0, 100),
      );
      return;
    }

    const name = funcMatch[1];
    const args: Record<string, unknown> = {};
    const paramRegex = /<parameter=([^\s>/]+)>([\s\S]*?)<\/parameter>/g;
    let m: RegExpExecArray | null;
    while ((m = paramRegex.exec(content)) !== null) {
      const key = m[1];
      const raw = m[2].trim();
      args[key] = coerceValue(raw);
    }

    this.completed.push({
      id: `xml_${++this.callIdx}_${Date.now()}`,
      name,
      args,
    });
    debugLogger.debug(`Parsed qwenCoder XML tool call: ${name}`);
  }

  getCompletedToolCalls(): ParsedXmlToolCall[] {
    const calls = this.completed;
    this.completed = [];
    return calls;
  }

  hasCompletedCalls(): boolean {
    return this.completed.length > 0;
  }

  /** True if there is an open <tool_call> that hasn't been closed yet. */
  isInsideToolCall(): boolean {
    return this.state === 'buffering';
  }
}

/**
 * Coerce string parameter values to their natural types.
 * XML parameters are always strings; convert obvious booleans/numbers.
 */
function coerceValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d*\.\d+$/.test(raw)) return parseFloat(raw);
  // Try JSON parse for arrays/objects
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      return JSON.parse(raw);
    } catch {
      // keep as string
    }
  }
  return raw;
}

/**
 * Returns the length of the longest suffix of `text` that is also a prefix of `tag`.
 * Used to detect partial tag boundaries across streaming chunks.
 */
function longestSuffixPrefix(text: string, tag: string): number {
  const maxLen = Math.min(tag.length - 1, text.length);
  for (let len = maxLen; len > 0; len--) {
    if (tag.startsWith(text.slice(-len))) {
      return len;
    }
  }
  return 0;
}
