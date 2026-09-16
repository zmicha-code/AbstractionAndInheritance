export type TimeoutSignal = {
  startTime: number;
  timeoutMs: number;
  timedOut: boolean;
};

export const LOAD_TIMEOUT_MS = 60000;

export function createTimeoutSignal(timeoutMs: number = LOAD_TIMEOUT_MS): TimeoutSignal {
  return {
    startTime: Date.now(),
    timeoutMs,
    timedOut: false,
  };
}

export function isTimedOut(signal: TimeoutSignal): boolean {
  if (signal.timedOut) return true;
  if (Date.now() - signal.startTime > signal.timeoutMs) {
    signal.timedOut = true;
    return true;
  }
  return false;
}
