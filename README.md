# Event Management Service

This is a Node.js + Fastify backend that works with a mocked external events API. The goal of the project is to make improvements around production readiness, performance, and resilience when calling external services.


## Running the Project

Requirements:
- Node.js 18+
- npm

Setup and start:
npm install
npm start

API runs on http://localhost:3000



## Endpoints

GET /getUsers  
GET /getEvents  
GET /getEventsByUserId/:id  
POST /addEvent

Example:
curl -X POST http://localhost:3000/addEvent \
  -H "Content-Type: application/json" \
  -d '{"name":"Team Meeting","userId":"3"}'

## Main Files

services/index.js – API routes and server setup  
mock-server/index.js – mocked external API  
mock-server/mocks – mock data  
utils/logger.js – simple request logging  

## Task 1 – Production Readiness Changes

The original project ran but was missing a few things that are usually needed for real deployments. I added:

- Environment variables for server port and external api  base URL
- Error handling so responses are consistent
- Logging so requests and failures are traceable.
- Health check endpoints   (`/healthz` and `/readyz`)
- shutdown on process stop signals
- ESLint for basic code consistency.

### MSW Fix
The mock server uses MSW, which is ESM-only in newer versions. To keep the project in commonJS  MSW is loaded with a small dynamic import. No handlers were changed. This lets the mock server run normally on Node 18.


## Task 2 – Performance fix

`/getEventsByUserId/:id` used to fetch each event one-by-one. Since the mock API adds delay, this made the endpoint get slower as the user had more events.

I changed it to fetch all events in parallel using   Promise.all. The  endpoint is now fast regardless of how many events the user has.


## Task 3 – Resilience (/addEvent)

The external `/addEvent` route starts failing when overloaded. I added a small circuit breaker so we don’t keeps retrying when it’s already down.

Rules:
- If `/addEvent` fails 3 times  within 30 seconds then breaker opens
- When open, we stop calling  the external APIs and return 503
- After 15 seconds, one request is  allowed to test if the service is back
- If the test succeeds -> normal again
- If the test fails -> wait another 15 secondss

This prevents spamming the external API and makes responses faster during failure periods.

Breaker config:
- 3 failures in 30s -> OPEN
- 15s wait before testing
- Up to 2 retries with small backoff per call.


## How to Test


### Adding events normally
curl -X POST http://localhost:3000/addEvent \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Event","userId":"3"}'

### Test the performance fix
Add a bunch of events fast:
for i in {1..20}; do
  curl -s -X POST http://localhost:3000/addEvent \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"Perf $i\",\"userId\":\"3\"}" > /dev/null
done

Then call:
time curl -s http://localhost:3000/getEventsByUserId/3

This should still be fast.


### Test the circuit breaker  (/addEvent resilience)
Trigger failures:
for i in {1..10}; do
  curl -s -X POST http://localhost:3000/addEvent \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"BreakerTest $i\",\"userId\":\"3\"}" ; echo
done

You should start seeing:
{"success":false,"message":"service busy"}
and then:
{"success":false,"message":"service down, try later"}

Wait 15 seconds:
sleep 15

Send one request (this is the recovery test):
curl -X POST http://localhost:3000/addEvent \
  -H "Content-Type: application/json" \
  -d '{"name":"Probe","userId":"3"}'

If it succeeds then the breaker closed and things are back to normal.


## Tests
I added a basic unit test to show the performance fix from Task 2. It will  confirm that the code is using `Promise.all` to fetch events in parallel instead of one-by-one

To run tests:
npm test

The test file is located in:
tests/getEventsParallelTest.js
