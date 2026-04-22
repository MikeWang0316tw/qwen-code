/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BackgroundTasksDialog — overlay with two modes (`list`, `detail`).
 * Key handling is scoped to this component; the composer is muted via
 * the `bgDialogOpen` branch in InputPrompt while the dialog is open.
 */

import type React from 'react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import {
  useBackgroundAgentViewState,
  useBackgroundAgentViewActions,
} from '../../contexts/BackgroundAgentViewContext.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { MaxSizedBox } from '../shared/MaxSizedBox.js';
import { theme } from '../../semantic-colors.js';
import { useConfig } from '../../contexts/ConfigContext.js';
import {
  buildBackgroundEntryLabel,
  type BackgroundAgentEntry,
} from '@qwen-code/qwen-code-core';
import { formatDuration, formatTokenCount } from '../../utils/formatters.js';

function statusSuffix(entry: BackgroundAgentEntry): string {
  switch (entry.status) {
    case 'running':
      return '(running)';
    case 'completed':
      return '(done)';
    case 'failed':
      return '(failed)';
    case 'cancelled':
      return '(stopped)';
    default:
      return '';
  }
}

function rowLabel(entry: BackgroundAgentEntry): string {
  return buildBackgroundEntryLabel(entry, { includePrefix: false });
}

function elapsedFor(entry: BackgroundAgentEntry): string {
  return formatDuration(
    Math.max(0, (entry.endTime ?? Date.now()) - entry.startTime),
  );
}

// ─── List mode ─────────────────────────────────────────────

const ListBody: React.FC<{
  entries: readonly BackgroundAgentEntry[];
  selectedIndex: number;
}> = ({ entries, selectedIndex }) => {
  if (entries.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color={theme.text.secondary}>No tasks currently running</Text>
      </Box>
    );
  }

  const running = entries.filter((e) => e.status === 'running').length;

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text color={theme.text.secondary}>
          {running} active {running === 1 ? 'agent' : 'agents'}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Box paddingX={1}>
          <Text bold>Local agents</Text>
          <Text color={theme.text.secondary}> ({entries.length})</Text>
        </Box>
        {entries.map((entry, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <Box key={entry.agentId} flexDirection="row" paddingX={1}>
              <Box width={2}>
                <Text color={isSelected ? theme.border.focused : undefined}>
                  {isSelected ? '\u203A ' : '  '}
                </Text>
              </Box>
              <Text
                color={
                  entry.status === 'running'
                    ? theme.text.primary
                    : theme.text.secondary
                }
                bold={isSelected}
              >
                {rowLabel(entry)}
              </Text>
              <Text color={theme.text.secondary}> {statusSuffix(entry)}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

// ─── Detail mode ───────────────────────────────────────────

const DetailBody: React.FC<{
  entry: BackgroundAgentEntry;
  maxHeight: number;
  maxWidth: number;
}> = ({ entry, maxHeight, maxWidth }) => {
  const title = `${entry.subagentType ?? 'Agent'} \u203A ${rowLabel(entry)}`;

  const subtitleParts: string[] = [];
  if (entry.status !== 'running') {
    subtitleParts.push(
      entry.status === 'completed'
        ? 'Completed'
        : entry.status === 'failed'
          ? 'Failed'
          : 'Stopped',
    );
  }
  subtitleParts.push(elapsedFor(entry));
  if (entry.stats?.totalTokens) {
    subtitleParts.push(`${formatTokenCount(entry.stats.totalTokens)} tokens`);
  }
  if (entry.stats?.toolUses !== undefined) {
    subtitleParts.push(
      `${entry.stats.toolUses} tool${entry.stats.toolUses === 1 ? '' : 's'}`,
    );
  }

  const activities = (entry.recentActivities ?? []).slice().reverse();
  const hasError = entry.status === 'failed' && Boolean(entry.error);

  return (
    <MaxSizedBox
      maxHeight={maxHeight}
      maxWidth={maxWidth}
      overflowDirection="bottom"
    >
      <Box>
        <Text bold color={theme.text.accent}>
          {title}
        </Text>
      </Box>
      <Box>
        <Text color={theme.text.secondary}>
          {subtitleParts.join(' \u00B7 ')}
        </Text>
      </Box>

      {activities.length > 0 && (
        <Fragment>
          <Box />
          <Box>
            <Text bold>Progress</Text>
          </Box>
          {activities.map((a, i) => (
            <Box key={`${a.at}-${i}`}>
              <Text color={theme.text.secondary}>
                {i === 0 ? '\u203A ' : '  '}
              </Text>
              <Text>{a.name}</Text>
              {a.description ? (
                <Text color={theme.text.secondary}> {a.description}</Text>
              ) : null}
            </Box>
          ))}
        </Fragment>
      )}

      {entry.prompt && (
        <Fragment>
          <Box />
          <Box>
            <Text bold>Prompt</Text>
          </Box>
          <Box>
            <Text wrap="wrap">{entry.prompt}</Text>
          </Box>
        </Fragment>
      )}

      {hasError && (
        <Fragment>
          <Box />
          <Box>
            <Text bold color={theme.status.error}>
              Error
            </Text>
          </Box>
          <Box>
            <Text color={theme.status.error} wrap="wrap">
              {entry.error}
            </Text>
          </Box>
        </Fragment>
      )}
    </MaxSizedBox>
  );
};

// ─── Dialog shell ──────────────────────────────────────────

interface BackgroundTasksDialogProps {
  availableTerminalHeight: number;
  terminalWidth: number;
}

export const BackgroundTasksDialog: React.FC<BackgroundTasksDialogProps> = ({
  availableTerminalHeight,
  terminalWidth,
}) => {
  const { entries, selectedIndex, dialogOpen, dialogMode } =
    useBackgroundAgentViewState();
  const {
    moveSelectionUp,
    moveSelectionDown,
    closeDialog,
    enterDetail,
    exitDetail,
    cancelSelected,
  } = useBackgroundAgentViewActions();
  const config = useConfig();

  // Detail view is capped at ~50% of the available area. Chrome (border,
  // title line, two marginTops, hint line) eats 6 rows; MaxSizedBox
  // handles row-level truncation for the rest.
  const detailMaxHeight = Math.max(
    6,
    Math.floor(availableTerminalHeight * 0.5),
  );
  const detailContentHeight = Math.max(2, detailMaxHeight - 6);
  // Rounded border + paddingX=1 on the outer Box ≈ 4 horizontal cells.
  const detailContentWidth = Math.max(10, terminalWidth - 4);

  const selectedEntry = useMemo(
    () => entries[selectedIndex] ?? null,
    [entries, selectedIndex],
  );

  // Tick up a local counter on each activity callback to force the
  // detail body to re-render while it's open. The main status
  // subscription in useBackgroundAgentView intentionally ignores
  // activity updates so the Footer pill and AppContainer don't re-run
  // on every tool call a background agent makes.
  const [, bumpActivity] = useState(0);
  useEffect(() => {
    if (!dialogOpen || dialogMode !== 'detail') return;
    const registry = config.getBackgroundTaskRegistry();
    const onActivity = () => bumpActivity((n) => n + 1);
    registry.setActivityChangeCallback(onActivity);
    return () => registry.setActivityChangeCallback(undefined);
  }, [dialogOpen, dialogMode, config]);

  useKeypress(
    (key) => {
      if (!dialogOpen) return;

      if (dialogMode === 'list') {
        if (key.name === 'up') {
          moveSelectionUp();
          return;
        }
        if (key.name === 'down') {
          moveSelectionDown();
          return;
        }
        if (key.name === 'return') {
          if (selectedEntry) enterDetail();
          return;
        }
        if (key.name === 'escape' || key.name === 'left') {
          closeDialog();
          return;
        }
        if (key.sequence === 'x' && !key.ctrl && !key.meta) {
          cancelSelected();
          return;
        }
        // Note: the "stop all agents" chord (ctrl+x ctrl+k in claw-code)
        // is intentionally deferred. `useKeypress` fires per keystroke,
        // so collapsing the chord to plain ctrl+k makes a destructive
        // action too easy to trigger by mistake. Stop-all will land in
        // a follow-up PR once proper chord handling is in place.
        return;
      }

      // detail mode
      if (key.name === 'left') {
        exitDetail();
        return;
      }
      if (
        key.name === 'escape' ||
        key.name === 'return' ||
        key.name === 'space'
      ) {
        closeDialog();
        return;
      }
      if (key.sequence === 'x' && !key.ctrl && !key.meta) {
        cancelSelected();
        return;
      }
    },
    { isActive: dialogOpen },
  );

  if (!dialogOpen) return null;

  // Hint footer — context-sensitive.
  const hints: string[] = [];
  if (dialogMode === 'list') {
    hints.push('\u2191/\u2193 select', 'Enter view');
    if (selectedEntry?.status === 'running') hints.push('x stop');
    hints.push('\u2190/Esc close');
  } else {
    hints.push('\u2190 go back', 'Esc/Enter/Space close');
    if (selectedEntry?.status === 'running') hints.push('x stop');
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border.default}
      marginTop={1}
      paddingX={1}
    >
      <Box paddingX={1}>
        <Text bold color={theme.text.accent}>
          Background tasks
        </Text>
      </Box>
      <Box marginTop={1}>
        {dialogMode === 'list' ? (
          <ListBody entries={entries} selectedIndex={selectedIndex} />
        ) : selectedEntry ? (
          <DetailBody
            entry={selectedEntry}
            maxHeight={detailContentHeight}
            maxWidth={detailContentWidth}
          />
        ) : (
          <Box paddingX={1}>
            <Text color={theme.text.secondary}>No entry to show.</Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1} paddingX={1}>
        <Text color={theme.text.secondary}>{hints.join(' \u00B7 ')}</Text>
      </Box>
    </Box>
  );
};
