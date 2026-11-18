import { createContext, useContext } from 'react';

export const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

// Lets any screen open the Add forms (leave, WFH, correction, time log, comp-off) that live in the app shell.
export const ActionCtx = createContext({ open: () => {}, openAdd: () => {} });
export const useActions = () => useContext(ActionCtx);
