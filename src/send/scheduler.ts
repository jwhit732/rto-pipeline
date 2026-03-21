// Customisation: adjust send window and timezone here
const AEST_OFFSET_HOURS = 10; // UTC+10 (AEST). Change to 11 for AEDT if needed.
const WINDOW_START_HOUR = 9;  // 9:00 AM AEST
const WINDOW_END_HOUR = 11;   // 11:00 AM AEST
const JITTER_SECONDS = 30;    // ±30s random jitter per email

// Days to send: 1=Mon, 2=Tue, 3=Wed, 4=Thu (skip Fri — emails get buried over weekend)
const SEND_DAYS = new Set([1, 2, 3, 4]);

function toAest(date: Date): Date {
  return new Date(date.getTime() + AEST_OFFSET_HOURS * 60 * 60 * 1000);
}

export function isInSendWindow(now = new Date()): boolean {
  const aest = toAest(now);
  const day = aest.getUTCDay();
  const hour = aest.getUTCHours();
  return SEND_DAYS.has(day) && hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

// Returns the start of the next send window (as UTC Date)
export function nextWindowStart(now = new Date()): Date {
  const aest = toAest(now);
  let candidate = new Date(Date.UTC(
    aest.getUTCFullYear(),
    aest.getUTCMonth(),
    aest.getUTCDate(),
    WINDOW_START_HOUR,
    0, 0, 0
  ));
  // Convert back to UTC
  candidate = new Date(candidate.getTime() - AEST_OFFSET_HOURS * 60 * 60 * 1000);

  // If we're already past start today, move to next day
  if (now >= candidate) {
    candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  }

  // Skip non-send days
  for (let i = 0; i < 7; i++) {
    const aestDay = toAest(candidate).getUTCDay();
    if (SEND_DAYS.has(aestDay)) break;
    candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  }

  return candidate;
}

export function formatAest(date: Date): string {
  const aest = toAest(date);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[aest.getUTCDay()];
  const h = String(aest.getUTCHours()).padStart(2, '0');
  const m = String(aest.getUTCMinutes()).padStart(2, '0');
  return `${day} ${h}:${m} AEST`;
}

// Spread N emails across the next send window with jitter.
// Returns an array of UTC ISO timestamps.
export function buildSchedule(count: number, windowStart: Date): string[] {
  const windowMs = (WINDOW_END_HOUR - WINDOW_START_HOUR) * 60 * 60 * 1000;
  const interval = count > 1 ? windowMs / (count - 1) : 0;
  const jitterMs = JITTER_SECONDS * 1000;

  return Array.from({ length: count }, (_, i) => {
    const base = windowStart.getTime() + i * interval;
    const jitter = (Math.random() * 2 - 1) * jitterMs;
    // Clamp so nothing goes outside the window
    const clamped = Math.max(
      windowStart.getTime(),
      Math.min(windowStart.getTime() + windowMs - 1000, base + jitter)
    );
    return new Date(clamped).toISOString();
  });
}

// Returns a human-readable schedule summary
export function summariseSchedule(timestamps: string[]): string {
  if (timestamps.length === 0) return 'No emails to schedule';
  const slots = [0, 30, 60, 90].map((offset) => {
    const slotStart = WINDOW_START_HOUR * 60 + offset;
    const slotEnd = slotStart + 30;
    const count = timestamps.filter((ts) => {
      const aest = toAest(new Date(ts));
      const mins = aest.getUTCHours() * 60 + aest.getUTCMinutes();
      return mins >= slotStart && mins < slotEnd;
    }).length;
    const sh = String(Math.floor(slotStart / 60)).padStart(2, '0');
    const sm = String(slotStart % 60).padStart(2, '0');
    const eh = String(Math.floor(slotEnd / 60)).padStart(2, '0');
    const em = String(slotEnd % 60).padStart(2, '0');
    return count > 0 ? `${count} × ${sh}:${sm}-${eh}:${em}` : null;
  }).filter(Boolean);
  return slots.join(', ');
}
