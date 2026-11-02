// Sliding event limiter. Used for submissions and join/leave traffic.
// `limit` rejects once more than `maxEventsPerWindow` events arrive within
// `windowMs`, so it also bounds bursts above `maxSubmissionsPerWindow`.
//
// The window slides with the first event of each burst, which keeps a
// regular cadence (one answer per participant per question) well under the
// limit while still catching a sudden flood.
let windowMs = 10_000;
let maxSubmissionsPerWindow = 200;
let maxEventsPerWindow = 300;

export const setLimits = (limits) => {
  if (limits.windowMs !== undefined) windowMs = limits.windowMs;
  if (limits.maxSubmissionsPerWindow !== undefined)
    maxSubmissionsPerWindow = limits.maxSubmissionsPerWindow;
  if (limits.maxEventsPerWindow !== undefined) maxEventsPerWindow = limits.maxEventsPerWindow;
};

export { windowMs, maxSubmissionsPerWindow, maxEventsPerWindow };

// Tracks event counts per key and returns `true` when the event is over the
// submissions limit. Every socket event increments the socket's account,
// regardless of whether it is a submission.
import log from "./logger.js";

export class RateLimiter {
  constructor() {
    this.windows = new Map();
  }

  // The sliding window starts with the first event of a burst and moves on
  // once it has aged out.
  #now() {
    return Date.now();
  }

  #prune(now) {
    for (const [k, v] of this.windows.entries()) {
      if (now - v.start >= windowMs) {
        this.windows.delete(k);
      }
    }
  }

  record(key, now = this.#now()) {
    if (this.windows.size > 500) {
      this.#prune(now);
    }
    let entry = this.windows.get(key);
    if (entry && now - entry.start < windowMs) {
      entry.count += 1;
      return entry.count > maxSubmissionsPerWindow;
    }
    this.windows.set(key, { start: now, count: 1 });
    return false;
  }

  limit(key, event) {
    const limited = this.record(key);
    if (limited) log.warn(`rate limit hit for ${key} event ${event}`);
    return limited;
  }

  reset(key) {
    this.windows.delete(key);
  }

  // Resets the entries recorded for `keys`; `key` itself is kept.
  resetBatch(keys) {
    for (const key of keys) this.windows.delete(key);
  }

  clear() {
    this.windows.clear();
  }
}

export const rateLimiter = new RateLimiter();
