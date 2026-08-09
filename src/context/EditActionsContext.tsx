'use client';

/**
 * Lets a deep edit surface (the profile's AdopterForm) publish its edit state
 * up to the global app nav (layout.tsx → NavBar), so on MOBILE the nav can show
 * Cancelar/Guardar in place of the logo/menu while editing — the keyboard-proof
 * "actions live in the nav" pattern. Desktop keeps its own inline form buttons and
 * ignores this entirely.
 *
 * Split into state + dispatch contexts: the dispatch (a stable useState setter)
 * is what the publisher reads, so publishing never re-renders the publisher; only
 * the nav (state consumer) re-renders when the actions change. Defaults are inert
 * so a component rendered outside the provider (walkthrough demo, tests) is safe.
 */

import { createContext, useContext, useState, type ReactNode } from 'react';

export type EditActions = {
    active: boolean;
    loading: boolean;
    onCancel: () => void;
    onSave: () => void;
} | null;

const StateContext = createContext<EditActions>(null);
const DispatchContext = createContext<(actions: EditActions) => void>(() => {});

export function EditActionsProvider({ children }: { children: ReactNode }) {
    const [actions, setActions] = useState<EditActions>(null);
    return (
        <DispatchContext.Provider value={setActions}>
            <StateContext.Provider value={actions}>{children}</StateContext.Provider>
        </DispatchContext.Provider>
    );
}

/** Read the current edit actions (used by the nav). */
export const useEditActionsState = () => useContext(StateContext);
/** Stable setter to publish/clear edit actions (used by the edit surface). */
export const useSetEditActions = () => useContext(DispatchContext);
