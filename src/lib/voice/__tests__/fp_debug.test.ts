import { describe, it, expect } from 'vitest';

describe('fingerprint debug', () => {
  it('check blob content in jsdom', async () => {
    const data = new Uint8Array(200);
    data.fill(0xAA);
    const blob = new Blob([data], { type: 'audio/webm' });
    const sliced = blob.slice(0, 10);
    const buf = await sliced.arrayBuffer();
    const bytes = new Uint8Array(buf);
    console.log('bytes:', Array.from(bytes));
    expect(bytes[0]).toBe(0xAA);
  });
});
