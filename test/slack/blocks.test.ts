import { describe, it, expect, assert } from 'vitest';
import type { KnownBlock } from '@slack/types';
import type { EscalationRequest } from '../../src/types/escalation.js';
import {
  buildEscalationBlocks,
  buildConfirmationBlocks,
  buildFallbackText,
  buildDismissedBlocks,
  buildStartupBlocks,
  formatActionLabel,
} from '../../src/slack/blocks.js';

type HeaderBlock = Extract<KnownBlock, { type: 'header' }>;
type ContextBlock = Extract<KnownBlock, { type: 'context' }>;
type SectionBlock = Extract<KnownBlock, { type: 'section' }>;
type ActionsBlock = Extract<KnownBlock, { type: 'actions' }>;

/** Creates a valid EscalationRequest with sensible defaults. */
function makeRequest(overrides?: Partial<EscalationRequest>): EscalationRequest {
  return {
    title: 'Permission Required',
    question: 'Allow Bash tool execution?',
    urgency: 'warning',
    context: { eventType: 'PermissionRequest' },
    suggestedActions: [
      { id: 'approve', label: 'Approve', style: 'primary' },
      { id: 'deny', label: 'Deny', style: 'danger' },
    ],
    allowFreeformResponse: true,
    ...overrides,
  };
}

function isHeaderBlock(b: KnownBlock): b is HeaderBlock {
  return b.type === 'header';
}
function isContextBlock(b: KnownBlock): b is ContextBlock {
  return b.type === 'context';
}
function isSectionBlock(b: KnownBlock): b is SectionBlock {
  return b.type === 'section';
}
function isActionsBlock(b: KnownBlock): b is ActionsBlock {
  return b.type === 'actions';
}

const ESCALATION_ID = 'esc-001';

describe('buildEscalationBlocks', () => {
  it('builds header block with urgency emoji and title', () => {
    const blocks = buildEscalationBlocks(makeRequest({ title: 'Danger Zone', urgency: 'critical' }), ESCALATION_ID);
    const header = blocks[0];

    assert(header !== undefined);
    assert(isHeaderBlock(header));
    expect(header.text.text).toContain('Danger Zone');
    expect(header.text.text).toContain(':rotating_light:');
  });

  it('builds metadata section with urgency field', () => {
    const blocks = buildEscalationBlocks(
      makeRequest({ context: { eventType: 'PreToolUse' }, urgency: 'warning' }),
      ESCALATION_ID,
    );
    // Block[1] is the section with fields (metadata)
    const metaSection = blocks[1];

    assert(metaSection !== undefined);
    assert(isSectionBlock(metaSection));
    assert('fields' in metaSection && metaSection.fields !== undefined);
    // Should have urgency field when no tool name
    const fieldTexts = metaSection.fields.map((f: { text: string }) => f.text);
    expect(fieldTexts.some((t: string) => t.includes('Warning'))).toBe(true);
  });

  it('includes tool name in metadata fields when present', () => {
    const blocks = buildEscalationBlocks(
      makeRequest({ context: { eventType: 'PreToolUse', toolName: 'Bash' } }),
      ESCALATION_ID,
    );
    const metaSection = blocks[1];

    assert(metaSection !== undefined);
    assert(isSectionBlock(metaSection));
    assert('fields' in metaSection && metaSection.fields !== undefined);
    // Should have both tool and urgency fields
    expect(metaSection.fields).toHaveLength(2);
    const toolField = metaSection.fields[0];
    assert(toolField !== undefined);
    assert('text' in toolField);
    expect(toolField.text).toContain('Bash');
  });

  it('omits tool name from metadata fields when absent', () => {
    const blocks = buildEscalationBlocks(
      makeRequest({ context: { eventType: 'PermissionRequest' } }),
      ESCALATION_ID,
    );
    const metaSection = blocks[1];

    assert(metaSection !== undefined);
    assert(isSectionBlock(metaSection));
    assert('fields' in metaSection && metaSection.fields !== undefined);
    // Only urgency field
    expect(metaSection.fields).toHaveLength(1);
  });

  it('builds question section', () => {
    const blocks = buildEscalationBlocks(makeRequest({ question: 'Run rm -rf /?' }), ESCALATION_ID);
    const sections = blocks.filter(isSectionBlock);
    // sections[0] = metadata fields, sections[1] = question
    const questionSection = sections[1];

    assert(questionSection !== undefined);
    assert(questionSection.text !== undefined);
    expect(questionSection.text.type).toBe('mrkdwn');
    expect(questionSection.text.text).toBe('Run rm -rf /?');
  });

  it('builds task context section when present', () => {
    const blocks = buildEscalationBlocks(
      makeRequest({
        context: { eventType: 'PermissionRequest', taskContext: 'Building auth module' },
      }),
      ESCALATION_ID,
    );
    const sections = blocks.filter(isSectionBlock);
    // sections[0] = metadata, sections[1] = question, sections[2] = task context
    const taskSection = sections[2];

    assert(taskSection !== undefined);
    assert(taskSection.text !== undefined);
    expect(taskSection.text.text).toBe('> Building auth module');
  });

  it('omits task context section when absent', () => {
    const blocks = buildEscalationBlocks(
      makeRequest({ context: { eventType: 'PermissionRequest' } }),
      ESCALATION_ID,
    );
    const sections = blocks.filter(isSectionBlock);

    // metadata + question only
    expect(sections).toHaveLength(2);
  });

  it('builds file paths context when present', () => {
    const blocks = buildEscalationBlocks(
      makeRequest({
        context: {
          eventType: 'PermissionRequest',
          filePaths: ['src/auth.ts', 'src/types.ts'],
        },
      }),
      ESCALATION_ID,
    );
    const contextBlocks = blocks.filter(isContextBlock);
    // File paths is the only context block now
    const filePathsContext = contextBlocks[0];

    assert(filePathsContext !== undefined);
    const element = filePathsContext.elements[0];
    assert(element !== undefined);
    assert('text' in element);
    expect(element.text).toContain('src/auth.ts');
    expect(element.text).toContain('src/types.ts');
  });

  it('omits file paths context when empty array', () => {
    const blocks = buildEscalationBlocks(
      makeRequest({
        context: { eventType: 'PermissionRequest', filePaths: [] },
      }),
      ESCALATION_ID,
    );
    const contextBlocks = blocks.filter(isContextBlock);

    // No context blocks at all
    expect(contextBlocks).toHaveLength(0);
  });

  it('builds action buttons with correct styles', () => {
    const blocks = buildEscalationBlocks(
      makeRequest({
        suggestedActions: [
          { id: 'approve', label: 'Approve', style: 'primary' },
          { id: 'deny', label: 'Deny', style: 'danger' },
          { id: 'snooze', label: 'Snooze', style: 'default' },
        ],
      }),
      ESCALATION_ID,
    );
    const actionsBlock = blocks.find(isActionsBlock);

    assert(actionsBlock !== undefined);
    expect(actionsBlock.elements).toHaveLength(3);

    const approveBtn = actionsBlock.elements[0];
    const denyBtn = actionsBlock.elements[1];
    const snoozeBtn = actionsBlock.elements[2];

    assert(approveBtn !== undefined);
    assert(denyBtn !== undefined);
    assert(snoozeBtn !== undefined);

    // Primary gets style: 'primary'
    assert(approveBtn.type === 'button');
    expect(approveBtn.style).toBe('primary');
    // Danger gets style: 'danger'
    assert(denyBtn.type === 'button');
    expect(denyBtn.style).toBe('danger');
    // Default/undefined gets no style property
    assert(snoozeBtn.type === 'button');
    expect(snoozeBtn).not.toHaveProperty('style');
  });

  it('encodes escalation ID in action_id', () => {
    const blocks = buildEscalationBlocks(
      makeRequest({
        suggestedActions: [
          { id: 'approve', label: 'Approve', style: 'primary' },
          { id: 'deny', label: 'Deny', style: 'danger' },
        ],
      }),
      'esc-42',
    );
    const actionsBlock = blocks.find(isActionsBlock);

    assert(actionsBlock !== undefined);
    const firstBtn = actionsBlock.elements[0];
    const secondBtn = actionsBlock.elements[1];
    assert(firstBtn !== undefined);
    assert(secondBtn !== undefined);
    assert(firstBtn.type === 'button');
    assert(secondBtn.type === 'button');

    expect(firstBtn.action_id).toBe('escalate_esc-42_approve');
    expect(firstBtn.value).toBe('approve');
    expect(secondBtn.action_id).toBe('escalate_esc-42_deny');
    expect(secondBtn.value).toBe('deny');
  });

  it('omits actions block when no suggested actions', () => {
    const blocks = buildEscalationBlocks(makeRequest({ suggestedActions: [] }), ESCALATION_ID);
    const actionsBlock = blocks.find(isActionsBlock);

    expect(actionsBlock).toBeUndefined();
  });

  it('cleans MCP tool names for display', () => {
    const blocks = buildEscalationBlocks(
      makeRequest({
        context: {
          eventType: 'PermissionRequest',
          toolName: 'mcp__plugin_escalate__create_escalation',
        },
      }),
      ESCALATION_ID,
    );
    const metaSection = blocks[1];

    assert(metaSection !== undefined);
    assert(isSectionBlock(metaSection));
    assert('fields' in metaSection && metaSection.fields !== undefined);
    const toolField = metaSection.fields[0];
    assert(toolField !== undefined);
    assert('text' in toolField);
    expect(toolField.text).toContain('plugin_escalate > create_escalation');
    expect(toolField.text).not.toContain('mcp__');
  });
});

describe('buildConfirmationBlocks', () => {
  it('builds confirmation section with action and user', () => {
    const blocks = buildConfirmationBlocks('Approved', 'U12345');
    const section = blocks[0];

    assert(section !== undefined);
    assert(isSectionBlock(section));
    assert(section.text !== undefined);
    expect(section.text.text).toContain('Approved');
    expect(section.text.text).toContain('<@U12345>');
  });

  it('includes checkmark emoji in confirmation', () => {
    const blocks = buildConfirmationBlocks('Denied', 'U99999');
    const section = blocks[0];

    assert(section !== undefined);
    assert(isSectionBlock(section));
    assert(section.text !== undefined);
    expect(section.text.text).toContain(':white_check_mark:');
  });
});

describe('buildDismissedBlocks', () => {
  it('shows CLI resolution indicator', () => {
    const blocks = buildDismissedBlocks('cli');
    const section = blocks[0];

    assert(section !== undefined);
    assert(isSectionBlock(section));
    assert(section.text !== undefined);
    expect(section.text.text).toContain('Resolved from CLI');
    expect(section.text.text).toContain(':desktop_computer:');
  });

  it('shows timeout indicator', () => {
    const blocks = buildDismissedBlocks('timeout');
    const section = blocks[0];

    assert(section !== undefined);
    assert(isSectionBlock(section));
    assert(section.text !== undefined);
    expect(section.text.text).toContain('Timed out');
  });

  it('shows auto-approved indicator', () => {
    const blocks = buildDismissedBlocks('auto_approved');
    const section = blocks[0];

    assert(section !== undefined);
    assert(isSectionBlock(section));
    assert(section.text !== undefined);
    expect(section.text.text).toContain('Auto-approved');
  });
});

describe('buildStartupBlocks', () => {
  it('builds compact startup message', () => {
    const blocks = buildStartupBlocks();
    expect(blocks).toHaveLength(1);

    const section = blocks[0];
    assert(section !== undefined);
    assert(isSectionBlock(section));
    assert(section.text !== undefined);
    expect(section.text.text).toContain('Escalate');
    expect(section.text.text).toContain(':zap:');
  });
});

describe('formatActionLabel', () => {
  it('returns past-tense label for known actions', () => {
    expect(formatActionLabel('approve')).toBe('Approved');
    expect(formatActionLabel('deny')).toBe('Denied');
    expect(formatActionLabel('snooze')).toBe('Snoozed');
    expect(formatActionLabel('continue')).toBe('Continued');
    expect(formatActionLabel('stop')).toBe('Stopped');
    expect(formatActionLabel('acknowledge')).toBe('Acknowledged');
  });

  it('title-cases unknown action IDs', () => {
    expect(formatActionLabel('custom')).toBe('Custom');
    expect(formatActionLabel('retry')).toBe('Retry');
  });
});

describe('AskUserQuestion rendering', () => {
  it('renders question title and option buttons', () => {
    const blocks = buildEscalationBlocks(
      makeRequest({
        title: 'Question from Claude',
        urgency: 'info',
        question: '*Which approach do you prefer?*\n\n1. *Option A* — First approach\n2. *Option B* — Second approach\n\n_Reply in thread for a custom answer_',
        context: { eventType: 'PermissionRequest', toolName: 'AskUserQuestion' },
        suggestedActions: [
          { id: 'option_0', label: 'Option A', style: 'primary' },
          { id: 'option_1', label: 'Option B' },
        ],
      }),
      ESCALATION_ID,
    );

    // Header should say "Question from Claude"
    const header = blocks[0];
    assert(header !== undefined);
    assert(isHeaderBlock(header));
    expect(header.text.text).toContain('Question from Claude');
    // Info urgency emoji
    expect(header.text.text).toContain(':large_blue_circle:');

    // Question section should contain the question text
    const sections = blocks.filter(isSectionBlock);
    const questionSection = sections[1]; // [0]=metadata, [1]=question
    assert(questionSection !== undefined);
    assert(questionSection.text !== undefined);
    expect(questionSection.text.text).toContain('Which approach do you prefer?');
    expect(questionSection.text.text).toContain('Option A');
    expect(questionSection.text.text).toContain('Option B');

    // Action buttons should use option_N IDs
    const actionsBlock = blocks.find(isActionsBlock);
    assert(actionsBlock !== undefined);
    expect(actionsBlock.elements).toHaveLength(2);

    const btn0 = actionsBlock.elements[0];
    const btn1 = actionsBlock.elements[1];
    assert(btn0 !== undefined);
    assert(btn1 !== undefined);
    assert(btn0.type === 'button');
    assert(btn1.type === 'button');

    expect(btn0.action_id).toBe(`escalate_${ESCALATION_ID}_option_0`);
    expect(btn0.style).toBe('primary');
    expect(btn1.action_id).toBe(`escalate_${ESCALATION_ID}_option_1`);
    expect(btn1).not.toHaveProperty('style');
  });

  it('action_id parsing works with UUID escalation IDs and option_N values', () => {
    const escalationId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const blocks = buildEscalationBlocks(
      makeRequest({
        suggestedActions: [
          { id: 'option_0', label: 'First' },
          { id: 'option_1', label: 'Second' },
        ],
      }),
      escalationId,
    );
    const actionsBlock = blocks.find(isActionsBlock);
    assert(actionsBlock !== undefined);

    const btn = actionsBlock.elements[0];
    assert(btn !== undefined);
    assert(btn.type === 'button');

    // Verify the action_id format: escalate_{uuid}_option_0
    expect(btn.action_id).toBe(`escalate_${escalationId}_option_0`);

    // Simulate the handler split logic
    const parts = btn.action_id.split('_');
    expect(parts[0]).toBe('escalate');
    expect(parts[1]).toBe(escalationId); // UUID with hyphens stays intact
    expect(parts.slice(2).join('_')).toBe('option_0'); // Rejoin gives back option_0
  });
});

describe('buildFallbackText', () => {
  it('builds fallback text from title and question', () => {
    const text = buildFallbackText(
      makeRequest({ title: 'Heads Up', question: 'Something happened' }),
    );

    expect(text).toBe('Heads Up: Something happened');
  });
});
