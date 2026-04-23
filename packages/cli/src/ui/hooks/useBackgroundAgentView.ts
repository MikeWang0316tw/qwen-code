/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * useBackgroundAgentView — subscribes to the background task registry's
 * status-change callback and maintains a reactive snapshot of every
 * `BackgroundAgentEntry`.
 *
 * Intentionally ignores activity updates (appendActivity). Tool-call
 * traffic from a running background agent would otherwise churn the
 * Footer pill and the AppContainer every few hundred ms. The detail
 * dialog subscribes to the activity callback directly when it needs
 * live Progress updates.
 */

import { useState, useEffect } from 'react';
import {
  type BackgroundAgentEntry,
  type Config,
} from '@qwen-code/qwen-code-core';

export interface UseBackgroundAgentViewResult {
  entries: readonly BackgroundAgentEntry[];
}

// The registry keeps terminal entries for the whole session so the model
// can still read their transcripts and the notification path stays deduped.
// The dialog only surfaces live work, so filter terminal statuses out here
// — otherwise "0 active agents" in the header would disagree with
// "Local agents (N)" in the list once anything finishes.
function selectLiveEntries(
  all: readonly BackgroundAgentEntry[],
): BackgroundAgentEntry[] {
  return all.filter((e) => e.status === 'running');
}

export function useBackgroundAgentView(
  config: Config | null,
): UseBackgroundAgentViewResult {
  const [entries, setEntries] = useState<BackgroundAgentEntry[]>([]);

  useEffect(() => {
    if (!config) return;
    const registry = config.getBackgroundTaskRegistry();

    // getAll() returns entries in registration order, which is startTime
    // order — no sort needed.
    setEntries(selectLiveEntries(registry.getAll()));

    const onStatusChange = () => {
      setEntries(selectLiveEntries(registry.getAll()));
    };

    registry.setStatusChangeCallback(onStatusChange);

    return () => {
      registry.setStatusChangeCallback(undefined);
    };
  }, [config]);

  return { entries };
}
