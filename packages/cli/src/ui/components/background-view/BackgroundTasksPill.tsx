/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback } from 'react';
import { Box, Text } from 'ink';
import {
  useBackgroundAgentViewState,
  useBackgroundAgentViewActions,
} from '../../contexts/BackgroundAgentViewContext.js';
import { useKeypress, type Key } from '../../hooks/useKeypress.js';
import { theme } from '../../semantic-colors.js';
import type { BackgroundAgentEntry } from '@qwen-code/qwen-code-core';

/** Single source of truth for pluralising the pill label. */
export function getPillLabel(running: readonly BackgroundAgentEntry[]): string {
  const n = running.length;
  if (n === 0) return '';
  return n === 1 ? '1 local agent' : `${n} local agents`;
}

export const BackgroundTasksPill: React.FC = () => {
  const { entries, pillFocused } = useBackgroundAgentViewState();
  const { openDialog, setPillFocused } = useBackgroundAgentViewActions();
  const running = entries.filter((e) => e.status === 'running');

  const onKeypress = useCallback(
    (key: Key) => {
      if (!pillFocused) return;
      if (key.name === 'return') {
        openDialog();
      } else if (key.name === 'up' || key.name === 'escape') {
        setPillFocused(false);
      } else if (
        key.sequence &&
        key.sequence.length === 1 &&
        !key.ctrl &&
        !key.meta
      ) {
        setPillFocused(false);
      }
    },
    [pillFocused, openDialog, setPillFocused],
  );

  useKeypress(onKeypress, { isActive: true });

  if (running.length === 0) return null;

  const label = getPillLabel(running);

  return (
    <Box flexDirection="row">
      <Text color={theme.text.secondary}> · </Text>
      <Text
        color={pillFocused ? theme.text.primary : theme.text.accent}
        backgroundColor={pillFocused ? theme.border.default : undefined}
        bold
      >
        {pillFocused ? ` ${label} ` : label}
      </Text>
      {!pillFocused && (
        <Text color={theme.text.secondary}>{' · ↓ to view'}</Text>
      )}
    </Box>
  );
};
