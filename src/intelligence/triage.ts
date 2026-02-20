/**
 * LLM-powered Stop event triage.
 *
 * Classifies whether a Stop event's last assistant message requires human input
 * (question, decision, clarification) or is just a completion/status message.
 *
 * Uses the Anthropic Messages API with Haiku for fast, cheap classification.
 * Falls back to regex-based heuristic when no API key is available.
 *
 * CRITICAL: Never use console.log() in this file. The MCP server uses stdio,
 * so any stdout output corrupts the JSON-RPC protocol.
 */

/** Triage configuration matching the TriageConfigSchema shape. */
export interface TriageConfig {
  readonly enabled: boolean;
  readonly method: 'auto' | 'llm' | 'heuristic';
  readonly model: string;
  readonly confidenceThreshold: 'high' | 'medium' | 'low';
}

/** Result of triage classification. */
export interface TriageResult {
  readonly needsHumanInput: boolean;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly reason: string;
  readonly method: 'llm' | 'heuristic';
}

/** LLM response shape from the classifier prompt. */
interface LlmClassification {
  needs_human_input: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

const CLASSIFIER_PROMPT = `Classify the following assistant message. Does it require human input (a question, decision, clarification, or approval request) or is it just a completion/status message?

Respond with ONLY valid JSON, no other text:
{"needs_human_input": true/false, "confidence": "high/medium/low", "reason": "brief explanation"}`;

/** Question patterns that indicate the assistant needs human input. */
const QUESTION_PATTERNS = [
  /\?\s*$/m,
  /\bshould I\b/i,
  /\bwould you like\b/i,
  /\bdo you want\b/i,
  /\bwhich (?:option|approach|method|way)\b/i,
  /\blet me know\b/i,
  /\bplease (?:confirm|choose|select|decide|clarify|specify|provide|tell me)\b/i,
  /\bwhat (?:would you|should|do you)\b/i,
  /\bhow (?:would you|should|do you)\b/i,
  /\bwould you prefer\b/i,
  /\bcould you (?:clarify|confirm|provide|tell)\b/i,
  /\bwaiting for\b/i,
  /\bneed (?:your|some) (?:input|feedback|guidance|decision|direction)\b/i,
];

/** Completion patterns that indicate the assistant is done. */
const COMPLETION_PATTERNS = [
  /\bI've completed\b/i,
  /\btask (?:is )?complete\b/i,
  /\ball (?:tests|checks) pass/i,
  /\bsuccessfully (?:created|updated|fixed|implemented|deployed|built|installed|configured)\b/i,
  /\bfinished (?:implementing|creating|updating|fixing)\b/i,
  /\bhas been (?:created|updated|fixed|implemented|deployed|completed)\b/i,
  /\bchanges (?:have been|are) (?:committed|pushed|applied|saved)\b/i,
  /\beverything (?:looks good|is (?:set|ready|done|working))\b/i,
  /\bhere'?s (?:a |the )?summary\b/i,
  /\bthat'?s (?:all|everything|it)\b/i,
  /\bnothing (?:else|more) (?:to|needs to be) (?:do|done|change)\b/i,
];

/**
 * Classify a message using regex pattern matching.
 *
 * Returns conservative results: escalates when uncertain.
 */
export function triageWithHeuristic(message: string): TriageResult {
  const trimmed = message.trim();

  // Empty messages don't need input — Claude just stopped naturally
  if (trimmed.length === 0) {
    return {
      needsHumanInput: false,
      confidence: 'high',
      reason: 'Empty message — natural stop',
      method: 'heuristic',
    };
  }

  // Check completion patterns first (more specific)
  for (const pattern of COMPLETION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        needsHumanInput: false,
        confidence: 'medium',
        reason: 'Matches completion pattern',
        method: 'heuristic',
      };
    }
  }

  // Check question patterns
  for (const pattern of QUESTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        needsHumanInput: true,
        confidence: 'medium',
        reason: 'Matches question pattern',
        method: 'heuristic',
      };
    }
  }

  // Short messages with no question indicators are direct answers, not requests
  // for input. "4", "Done.", "Yes", "The file is at src/main.ts" etc.
  if (trimmed.length < 200) {
    return {
      needsHumanInput: false,
      confidence: 'medium',
      reason: 'Short message with no question indicators',
      method: 'heuristic',
    };
  }

  // Long unmatched message — conservative: assume input needed
  return {
    needsHumanInput: true,
    confidence: 'low',
    reason: 'No pattern match — escalating conservatively',
    method: 'heuristic',
  };
}

/**
 * Classify a message using the Anthropic Messages API with Haiku.
 *
 * Throws on network errors, timeouts, or invalid responses so the caller
 * can fall back to heuristic.
 */
export async function triageWithLlm(
  message: string,
  apiKey: string,
  model: string,
): Promise<TriageResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content: `${CLASSIFIER_PROMPT}\n\nAssistant message:\n${message.slice(0, 1000)}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${String(response.status)}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };

    const textBlock = data.content.find((b) => b.type === 'text');
    if (!textBlock?.text) {
      throw new Error('No text in LLM response');
    }

    const classification = JSON.parse(textBlock.text) as LlmClassification;

    return {
      needsHumanInput: classification.needs_human_input,
      confidence: classification.confidence,
      reason: classification.reason,
      method: 'llm',
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolve the API key for triage LLM calls.
 *
 * Checks ESCALATE_ANTHROPIC_API_KEY first, then ANTHROPIC_API_KEY.
 */
function resolveApiKey(): string | undefined {
  return process.env['ESCALATE_ANTHROPIC_API_KEY'] ?? process.env['ANTHROPIC_API_KEY'];
}

/**
 * Triage a Stop event's last assistant message.
 *
 * Orchestrator: tries LLM when available, falls back to heuristic.
 * Returns a result indicating whether the message needs human input.
 *
 * When triage is disabled, returns needsHumanInput: true so the event
 * always escalates (preserving pre-triage behavior).
 */
export async function triageStopEvent(
  message: string,
  config: TriageConfig,
): Promise<TriageResult> {
  if (!config.enabled) {
    return {
      needsHumanInput: true,
      confidence: 'high',
      reason: 'Triage disabled — escalating',
      method: 'heuristic',
    };
  }

  // Forced heuristic mode
  if (config.method === 'heuristic') {
    return triageWithHeuristic(message);
  }

  // LLM or auto mode: try LLM if API key available
  const apiKey = resolveApiKey();

  if (config.method === 'llm' && !apiKey) {
    // LLM explicitly requested but no key — escalate conservatively
    return {
      needsHumanInput: true,
      confidence: 'low',
      reason: 'LLM triage requested but no API key available',
      method: 'heuristic',
    };
  }

  if (apiKey && (config.method === 'llm' || config.method === 'auto')) {
    try {
      return await triageWithLlm(message, apiKey, config.model);
    } catch (err: unknown) {
      // In auto mode, fall back to heuristic; in llm mode, escalate conservatively
      if (config.method === 'auto') {
        return triageWithHeuristic(message);
      }
      return {
        needsHumanInput: true,
        confidence: 'low',
        reason: `LLM triage failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        method: 'heuristic',
      };
    }
  }

  // Auto mode with no API key: use heuristic
  return triageWithHeuristic(message);
}
