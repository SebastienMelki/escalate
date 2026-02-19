import { describe, it, expect, assert } from 'vitest';
import type { KnownBlock } from '@slack/types';
import type { EscalationRequest } from '../../src/types/escalation.js';
import {
  buildEscalationBlocks,
  buildConfirmationBlocks,
  buildFallbackText,
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
  it('builds header block from request title', () => {
    const blocks = buildEscalationBlocks(makeRequest({ title: 'Danger Zone' }), ESCALATION_ID);
    const header = blocks[0];

    assert(header !== undefined);
    assert(isHeaderBlock(header));
    expect(header.text.text).toBe('Danger Zone');
  });

  it('builds context block with event type', () => {
    const blocks = buildEscalationBlocks(
      makeRequest({ context: { eventType: 'PreToolUse' } }),
      ESCALATION_ID,
    );
    const context = blocks[1];

    assert(context !== undefined);
    assert(isContextBlock(context));
    const firstElement = context.elements[0];
    assert(firstElement !== undefined);
    assert('text' in firstElement);
    expect(firstElement.text).toContain('PreToolUse');
  });

  it('includes tool name in context when present', () => {
    const blocks = buildEscalationBlocks(
      makeRequest({ context: { eventType: 'PreToolUse', toolName: 'Bash' } }),
      ESCALATION_ID,
    );
    const context = blocks[1];

    assert(context !== undefined);
    assert(isContextBlock(context));
    expect(context.elements).toHaveLength(2);
    const toolElement = context.elements[1];
    assert(toolElement !== undefined);
    assert('text' in toolElement);
    expect(toolElement.text).toContain('Bash');
  });

  it('omits tool name from context when absent', () => {
    const blocks = buildEscalationBlocks(
      makeRequest({ context: { eventType: 'PermissionRequest' } }),
      ESCALATION_ID,
    );
    const context = blocks[1];

    assert(context !== undefined);
    assert(isContextBlock(context));
    expect(context.elements).toHaveLength(1);
  });

  it('builds question section', () => {
    const blocks = buildEscalationBlocks(makeRequest({ question: 'Run rm -rf /?' }), ESCALATION_ID);
    const sections = blocks.filter(isSectionBlock);
    const questionSection = sections[0];

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
    // Second section is the task context (first is the question)
    const taskSection = sections[1];

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

    // Only the question section should exist
    expect(sections).toHaveLength(1);
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
    // Find context blocks after the first one (event metadata)
    const contextBlocks = blocks.filter(isContextBlock);
    const filePathsContext = contextBlocks[1]; // second context block

    assert(filePathsContext !== undefined);
    const element = filePathsContext.elements[0];
    assert(element !== undefined);
    assert('text' in element);
    expect(element.text).toBe('*Files:* src/auth.ts, src/types.ts');
  });

  it('omits file paths context when empty array', () => {
    const blocks = buildEscalationBlocks(
      makeRequest({
        context: { eventType: 'PermissionRequest', filePaths: [] },
      }),
      ESCALATION_ID,
    );
    const contextBlocks = blocks.filter(isContextBlock);

    // Only the event metadata context block should exist
    expect(contextBlocks).toHaveLength(1);
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

describe('buildFallbackText', () => {
  it('builds fallback text from title and question', () => {
    const text = buildFallbackText(
      makeRequest({ title: 'Heads Up', question: 'Something happened' }),
    );

    expect(text).toBe('Heads Up: Something happened');
  });
});
