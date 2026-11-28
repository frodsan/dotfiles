import { shared, setShared, openOverlay } from "herdr";

const DEFAULT_SETTINGS = { settledDays: 7, branchPrefix: "", autoSettle: true, focusMute: false, focusWorking: true, tomorrowHour: 9, autoToasts: false, quickModel: "haiku", quickEffort: "low" };
export const quickFlags = () => ["--model", conf().quickModel, ...(conf().quickEffort ? ["--effort", conf().quickEffort] : [])];
export const conf = () => ({ ...DEFAULT_SETTINGS, ...(shared("firehouse.settings") ?? {}) });
export const setConf = (change) => setShared("firehouse.settings", { ...(shared("firehouse.settings") ?? {}), ...change });
export const openSettings = () => openOverlay({ mod: "firehouse-settings", kind: "dialog", width: 620, height: 660 });
