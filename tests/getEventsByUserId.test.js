const fs = require('fs');
const path = require('path');

const svc = path.join(__dirname, '..', 'services', 'index.js');
const code = fs.readFileSync(svc, 'utf8');

describe('/getEventsByUserId uses parallel fetching', () => {
  test('uses Promise.all for event detail requests', () => {
    // Must include Promise.all somewhere in the handler implementation
    expect(code.includes('Promise.all')).toBe(true);
    // And it should be calling the per-event endpoint
    expect(code.includes('/getEventById/')).toBe(true);
  });

  test('does not use a simple sequential await-in-loop pattern', () => {
    // crude check that there isn't a classic "for...of" + "await fetch" pattern
    const hasSeqAwaitFetch = /for\s*\([\s\S]*?\)\s*{[\s\S]*?await\s+fetch\(/m.test(code);
    expect(hasSeqAwaitFetch).toBe(false);
  });
});
