/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BackgroundAgentViewContext — React state for the Background tasks
 * dialog. Subscription plumbing (registry callbacks → entries) lives in
 * `useBackgroundAgentView`, invoked once here so it owns the single-slot
 * `setStatusChangeCallback` for the TUI's lifetime.
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  type BackgroundAgentEntry,
  type Config,
} from '@qwen-code/qwen-code-core';
import { useBackgroundAgentView } from '../hooks/useBackgroundAgentView.js';

// ─── Types ──────────────────────────────────────────────────

export type BackgroundDialogMode = 'closed' | 'list' | 'detail';

export interface BackgroundAgentViewState {
  /** Live snapshot of every background agent entry, ordered by startTime. */
  entries: readonly BackgroundAgentEntry[];
  /** Index into `entries` for the currently focused row (0-based). */
  selectedIndex: number;
  /** `'closed'` when the overlay isn't mounted; otherwise the active mode. */
  dialogMode: BackgroundDialogMode;
  /** Convenience boolean: `dialogMode !== 'closed'`. */
  dialogOpen: boolean;
  /**
   * True when the footer pill owns keyboard focus (highlighted, awaiting
   * Enter to open the dialog). Mirrors the Arena tab-bar focus pattern.
   */
  pillFocused: boolean;
}

export interface BackgroundAgentViewActions {
  setSelectedIndex(index: number): void;
  moveSelectionUp(): boolean;
  moveSelectionDown(): boolean;
  openDialog(): void;
  closeDialog(): void;
  enterDetail(): void;
  exitDetail(): void;
  /** Cancel the currently selected entry (no-op if not running). */
  cancelSelected(): void;
  setPillFocused(focused: boolean): void;
}

// ─── Context ────────────────────────────────────────────────

export const BackgroundAgentViewStateContext =
  createContext<BackgroundAgentViewState | null>(null);
export const BackgroundAgentViewActionsContext =
  createContext<BackgroundAgentViewActions | null>(null);

// ─── Defaults (used when no provider is mounted) ────────────

const DEFAULT_STATE: BackgroundAgentViewState = {
  entries: [],
  selectedIndex: 0,
  dialogMode: 'closed',
  dialogOpen: false,
  pillFocused: false,
};

const noop = () => {};
const noopBool = () => false;

const DEFAULT_ACTIONS: BackgroundAgentViewActions = {
  setSelectedIndex: noop,
  moveSelectionUp: noopBool,
  moveSelectionDown: noopBool,
  openDialog: noop,
  closeDialog: noop,
  enterDetail: noop,
  exitDetail: noop,
  cancelSelected: noop,
  setPillFocused: noop,
};

// ─── Hooks ──────────────────────────────────────────────────

export function useBackgroundAgentViewState(): BackgroundAgentViewState {
  return useContext(BackgroundAgentViewStateContext) ?? DEFAULT_STATE;
}

export function useBackgroundAgentViewActions(): BackgroundAgentViewActions {
  return useContext(BackgroundAgentViewActionsContext) ?? DEFAULT_ACTIONS;
}

// ─── Provider ───────────────────────────────────────────────

interface BackgroundAgentViewProviderProps {
  config?: Config;
  children: React.ReactNode;
}

export function BackgroundAgentViewProvider({
  config,
  children,
}: BackgroundAgentViewProviderProps) {
  const { entries } = useBackgroundAgentView(config ?? null);

  const [rawSelectedIndex, setRawSelectedIndex] = useState(0);
  const [dialogMode, setDialogMode] = useState<BackgroundDialogMode>('closed');
  const [pillFocused, setPillFocused] = useState(false);
  const dialogOpen = dialogMode !== 'closed';
  const hasRunning = entries.some((e) => e.status === 'running');

  // Drop stale pill focus as soon as the pill loses its reason to exist —
  // without this, InputPrompt's input-blocking branch would stay on after
  // the last running agent finishes.
  useEffect(() => {
    if (pillFocused && !hasRunning) setPillFocused(false);
  }, [pillFocused, hasRunning]);

  // Single clamp on read — `rawSelectedIndex` can fall out of range when
  // entries shrink between renders.
  const selectedIndex =
    entries.length === 0
      ? 0
      : Math.min(Math.max(0, rawSelectedIndex), entries.length - 1);

  const setSelectedIndex = useCallback(
    (index: number) => {
      if (entries.length === 0) return;
      setRawSelectedIndex(Math.max(0, Math.min(entries.length - 1, index)));
    },
    [entries.length],
  );

  const moveSelectionUp = useCallback((): boolean => {
    if (selectedIndex <= 0) return false;
    setRawSelectedIndex(selectedIndex - 1);
    return true;
  }, [selectedIndex]);

  const moveSelectionDown = useCallback((): boolean => {
    if (entries.length === 0) return false;
    if (selectedIndex >= entries.length - 1) return false;
    setRawSelectedIndex(selectedIndex + 1);
    return true;
  }, [entries.length, selectedIndex]);

  const openDialog = useCallback(() => {
    setDialogMode('list');
    // Opening the dialog supersedes pill focus — the dialog now owns input.
    setPillFocused(false);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogMode('closed');
  }, []);

  const enterDetail = useCallback(() => {
    if (entries.length === 0) return;
    setDialogMode('detail');
  }, [entries.length]);

  const exitDetail = useCallback(() => {
    setDialogMode('list');
  }, []);

  const cancelSelected = useCallback(() => {
    if (!config) return;
    const target = entries[selectedIndex];
    if (!target) return;
    try {
      // cancel() is a no-op for non-running entries, so no pre-check here.
      config.getBackgroundTaskRegistry().cancel(target.agentId);
    } catch {
      // Registry unavailable — ignore. The dialog stays open.
    }
  }, [config, entries, selectedIndex]);

  const state: BackgroundAgentViewState = useMemo(
    () => ({
      entries,
      selectedIndex,
      dialogMode,
      dialogOpen,
      pillFocused,
    }),
    [entries, selectedIndex, dialogMode, dialogOpen, pillFocused],
  );

  const actions: BackgroundAgentViewActions = useMemo(
    () => ({
      setSelectedIndex,
      moveSelectionUp,
      moveSelectionDown,
      openDialog,
      closeDialog,
      enterDetail,
      exitDetail,
      cancelSelected,
      setPillFocused,
    }),
    [
      setSelectedIndex,
      moveSelectionUp,
      moveSelectionDown,
      openDialog,
      closeDialog,
      enterDetail,
      exitDetail,
      cancelSelected,
      setPillFocused,
    ],
  );

  return (
    <BackgroundAgentViewStateContext.Provider value={state}>
      <BackgroundAgentViewActionsContext.Provider value={actions}>
        {children}
      </BackgroundAgentViewActionsContext.Provider>
    </BackgroundAgentViewStateContext.Provider>
  );
}
