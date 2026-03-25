import { describe, it, expect } from 'vitest';
import {
  validateCalendarInvariants,
  enforceCalendarImmutability,
  computeOpenWindows,
  scheduleFlexibleBlocks,
  type TimedBlock,
  type CalendarAnchor,
} from '@/lib/calendarTimeInvariants';

const makeBlock = (start: string, end: string, label: string, type = 'meeting'): TimedBlock => ({
  start_time: start,
  end_time: end,
  label,
  type,
});

const makeAnchor = (start: string, end: string, label: string): CalendarAnchor => ({
  start_time: start,
  end_time: end,
  label,
});

describe('validateCalendarInvariants', () => {
  it('passes when all meetings match exactly', () => {
    const anchors = [makeAnchor('10:00', '11:00', 'Standup')];
    const blocks = [makeBlock('10:00', '11:00', 'Standup')];
    const result = validateCalendarInvariants(blocks, anchors);
    expect(result.valid).toBe(true);
    expect(result.drifts).toHaveLength(0);
  });

  it('detects start_time drift', () => {
    const anchors = [makeAnchor('10:00', '11:00', 'Standup')];
    const blocks = [makeBlock('10:15', '11:00', 'Standup')];
    const result = validateCalendarInvariants(blocks, anchors);
    expect(result.valid).toBe(false);
    expect(result.drifts).toHaveLength(1);
    expect(result.drifts[0].field).toBe('start_time');
    expect(result.drifts[0].deltaMinutes).toBe(15);
  });

  it('detects end_time drift', () => {
    const anchors = [makeAnchor('10:00', '11:00', 'Standup')];
    const blocks = [makeBlock('10:00', '10:45', 'Standup')];
    const result = validateCalendarInvariants(blocks, anchors);
    expect(result.valid).toBe(false);
    expect(result.drifts[0].field).toBe('end_time');
  });

  it('detects missing meeting', () => {
    const anchors = [makeAnchor('10:00', '11:00', 'Deal Review')];
    const blocks: TimedBlock[] = [];
    const result = validateCalendarInvariants(blocks, anchors);
    expect(result.valid).toBe(false);
    expect(result.drifts[0].actual).toBe('(missing)');
  });

  it('handles multiple meetings', () => {
    const anchors = [
      makeAnchor('09:00', '09:30', 'Morning Sync'),
      makeAnchor('14:00', '15:00', 'Client Call'),
    ];
    const blocks = [
      makeBlock('09:00', '09:30', 'Morning Sync'),
      makeBlock('14:00', '15:00', 'Client Call'),
      makeBlock('10:00', '11:00', 'Call Block', 'prospecting'),
    ];
    const result = validateCalendarInvariants(blocks, anchors);
    expect(result.valid).toBe(true);
  });

  it('is case-insensitive on label matching', () => {
    const anchors = [makeAnchor('10:00', '11:00', 'STANDUP')];
    const blocks = [makeBlock('10:00', '11:00', 'standup')];
    expect(validateCalendarInvariants(blocks, anchors).valid).toBe(true);
  });
});

describe('enforceCalendarImmutability', () => {
  it('corrects drifted meeting times', () => {
    const anchors = [makeAnchor('10:00', '11:00', 'Standup')];
    const blocks = [makeBlock('10:15', '11:15', 'Standup')];
    const { blocks: corrected, corrections } = enforceCalendarImmutability(blocks, anchors);
    expect(corrected[0].start_time).toBe('10:00');
    expect(corrected[0].end_time).toBe('11:00');
    expect(corrections).toHaveLength(1);
  });

  it('does not touch non-meeting blocks', () => {
    const anchors = [makeAnchor('10:00', '11:00', 'Standup')];
    const blocks = [
      makeBlock('09:00', '09:30', 'Call Block', 'prospecting'),
      makeBlock('10:15', '11:15', 'Standup'),
    ];
    const { blocks: corrected } = enforceCalendarImmutability(blocks, anchors);
    expect(corrected[0].start_time).toBe('09:00'); // unchanged
    expect(corrected[1].start_time).toBe('10:00'); // corrected
  });

  it('returns no corrections when times match', () => {
    const anchors = [makeAnchor('10:00', '11:00', 'Standup')];
    const blocks = [makeBlock('10:00', '11:00', 'Standup')];
    const { corrections } = enforceCalendarImmutability(blocks, anchors);
    expect(corrections).toHaveLength(0);
  });
});

describe('computeOpenWindows', () => {
  it('returns full day when no meetings', () => {
    const windows = computeOpenWindows([], 540, 1020); // 9-17
    expect(windows).toEqual([{ start: 540, end: 1020 }]);
  });

  it('splits around a single meeting', () => {
    const anchors = [makeAnchor('11:00', '12:00', 'Meeting')];
    const windows = computeOpenWindows(anchors, 540, 1020);
    expect(windows).toEqual([
      { start: 540, end: 660 },   // 9:00-11:00
      { start: 720, end: 1020 },  // 12:00-17:00
    ]);
  });

  it('handles back-to-back meetings', () => {
    const anchors = [
      makeAnchor('10:00', '11:00', 'A'),
      makeAnchor('11:00', '12:00', 'B'),
    ];
    const windows = computeOpenWindows(anchors, 540, 1020);
    expect(windows).toEqual([
      { start: 540, end: 600 },   // 9:00-10:00
      { start: 720, end: 1020 },  // 12:00-17:00
    ]);
  });

  it('handles meeting at start of day', () => {
    const anchors = [makeAnchor('09:00', '10:00', 'Early')];
    const windows = computeOpenWindows(anchors, 540, 1020);
    expect(windows).toEqual([{ start: 600, end: 1020 }]); // 10:00-17:00
  });
});

describe('scheduleFlexibleBlocks', () => {
  it('places flexible blocks in open windows', () => {
    const meetings = [makeBlock('11:00', '12:00', 'Meeting')];
    const flexible = [
      makeBlock('00:00', '01:00', 'Build', 'build'),
      makeBlock('00:00', '00:30', 'Call', 'prospecting'),
    ];
    const result = scheduleFlexibleBlocks(meetings, flexible, 540, 1020);

    // Meeting stays exactly at 11:00-12:00
    const meeting = result.find(b => b.type === 'meeting');
    expect(meeting?.start_time).toBe('11:00');
    expect(meeting?.end_time).toBe('12:00');

    // Flexible blocks placed in open windows
    const nonMeetings = result.filter(b => b.type !== 'meeting');
    expect(nonMeetings.length).toBe(2);
    expect(nonMeetings[0].start_time).toBe('09:00');
  });

  it('does not move meetings', () => {
    const meetings = [
      makeBlock('09:30', '10:15', 'Sync'),
      makeBlock('14:00', '14:45', 'Client'),
    ];
    const flexible = [makeBlock('00:00', '01:00', 'Prep', 'prep')];
    const result = scheduleFlexibleBlocks(meetings, flexible, 540, 1020);

    expect(result.find(b => b.label === 'Sync')?.start_time).toBe('09:30');
    expect(result.find(b => b.label === 'Client')?.start_time).toBe('14:00');
  });
});

describe('recast stability', () => {
  it('multiple recasts produce identical meeting times', () => {
    const anchors = [makeAnchor('10:00', '11:00', 'Deal Review')];
    const flexible = [makeBlock('00:00', '01:00', 'Calls', 'prospecting')];

    const result1 = scheduleFlexibleBlocks(
      [makeBlock('10:00', '11:00', 'Deal Review')],
      flexible, 540, 1020,
    );
    const result2 = scheduleFlexibleBlocks(
      [makeBlock('10:00', '11:00', 'Deal Review')],
      flexible, 540, 1020,
    );

    const m1 = result1.find(b => b.type === 'meeting');
    const m2 = result2.find(b => b.type === 'meeting');
    expect(m1?.start_time).toBe(m2?.start_time);
    expect(m1?.end_time).toBe(m2?.end_time);

    // Validate both against anchor
    expect(validateCalendarInvariants(result1, anchors).valid).toBe(true);
    expect(validateCalendarInvariants(result2, anchors).valid).toBe(true);
  });

  it('meeting add does not drift existing meetings', () => {
    const anchors1 = [makeAnchor('10:00', '11:00', 'A')];
    const anchors2 = [
      makeAnchor('10:00', '11:00', 'A'),
      makeAnchor('14:00', '15:00', 'B'),
    ];

    const meetings1 = [makeBlock('10:00', '11:00', 'A')];
    const meetings2 = [makeBlock('10:00', '11:00', 'A'), makeBlock('14:00', '15:00', 'B')];
    const flex = [makeBlock('00:00', '01:00', 'Work', 'build')];

    const r1 = scheduleFlexibleBlocks(meetings1, flex, 540, 1020);
    const r2 = scheduleFlexibleBlocks(meetings2, flex, 540, 1020);

    // Meeting A is the same in both
    const a1 = r1.find(b => b.label === 'A');
    const a2 = r2.find(b => b.label === 'A');
    expect(a1?.start_time).toBe(a2?.start_time);
    expect(a1?.end_time).toBe(a2?.end_time);

    expect(validateCalendarInvariants(r1, anchors1).valid).toBe(true);
    expect(validateCalendarInvariants(r2, anchors2).valid).toBe(true);
  });

  it('meeting removal does not drift remaining meetings', () => {
    const anchors = [makeAnchor('14:00', '15:00', 'B')];
    const meetings = [makeBlock('14:00', '15:00', 'B')];
    const flex = [makeBlock('00:00', '01:00', 'Work', 'build')];

    const result = scheduleFlexibleBlocks(meetings, flex, 540, 1020);
    expect(result.find(b => b.label === 'B')?.start_time).toBe('14:00');
    expect(validateCalendarInvariants(result, anchors).valid).toBe(true);
  });
});
