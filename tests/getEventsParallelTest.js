const fs = require('fs');
const path = require('path');

const svc = path.join(__dirname, '..', 'services', 'index.js');
const code = fs.readFileSync(svc, 'utf8');

describe('getEventsByUserId performance update', () => {
  test('should be using Promise.all for parallel fetching', () => {
    expect(code.includes('Promise.all')).toBe(true);
  });
});

