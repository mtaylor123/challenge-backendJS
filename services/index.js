require('dotenv').config();
const fastify = require('fastify')({ logger: false });
const { logger } = require('../utils/logger');
const listenMock = require('../mock-server');


// circuit breaker configss
const breaker = {
  state: 'closed', // closed | open | half
  fails: [],
  nextTry: 0,
  testing: false
};

const breakerConfig = {
  limit: 3,
  windowMs: 30000,
  waitMs: 15000,
  retries: 2,
  delay: 100
};

function now() { return Date.now(); }

function addFail() {
  const cutoff = now() - breakerConfig.windowMs;
  breaker.fails.push(now());
  breaker.fails = breaker.fails.filter(t => t >= cutoff);

  if (breaker.state === 'closed' && breaker.fails.length >= breakerConfig.limit) {
    breaker.state = 'open';
    breaker.nextTry = now() + breakerConfig.waitMs;
  }
}

function resetFails() {
  breaker.fails = [];
}

function maybeHalf() {
  if (breaker.state === 'open' && now() >= breaker.nextTry) {
    breaker.state = 'half';
    breaker.testing = false;
  }
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function tryRequest(url, opts) {
  let tries = 0;
  while (true) {
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error('upstream error');
      return r;
    } catch (e) {
      tries++;
      if (tries > breakerConfig.retries) throw e;
      await sleep(breakerConfig.delay * tries);
    }
  }
}


const BASE_URL = process.env.EXTERNAL_BASE_URL || 'http://event.com';
const PORT = process.env.PORT || 3000;

//  Centralized error handler
fastify.setErrorHandler((error, request, reply) => {
  logger.error('Unhandled Error', error);
  reply.code(500).send({
    error: 'Internal Server Error',
    message: error.message || 'Unexpected error occurred'
  });
});

// Health  endpoints
fastify.get('/healthz', async () => ({ status: 'ok' }));
fastify.get('/readyz', async () => ({ ready: true }));

fastify.get('/getUsers', async (request, reply) => {
  logger.info('Fetching users');
  const resp = await fetch(`${BASE_URL}/getUsers`);
  const data = await resp.json();
  reply.send(data); 
});

fastify.post('/addEvent', async (req, reply) => {
  logger.info('addEvent', req.body);

  const url = `${BASE_URL}/addEvent`;
  const body = JSON.stringify({ id: Date.now(), ...req.body });

  // if  breaker open, maybe move to half,  otherwise block
  if (breaker.state === 'open') {
    maybeHalf();
    if (breaker.state === 'open') {
      return reply.code(503).send({ success: false, message: 'service down, please try later' });
    }
  }

  // half-open: allow only one real call to testt
  if (breaker.state === 'half') {
    if (breaker.testing) {
      return reply.code(503).send({ success: false, message: 'service recovering, try soon' });
    }
    breaker.testing = true;

    try {
      const r = await tryRequest(url, { method: 'POST', body });
      const data = await r.json();
      breaker.state = 'closed';
      breaker.testing = false;
      resetFails();
      return reply.send(data);
    } catch (e) {
      breaker.state = 'open';
      breaker.testing = false;
      addFail();
      breaker.nextTry = now() + breakerConfig.waitMs;
      return reply.code(503).send({ success: false, message: 'still down, try later please' });
    }
  }

  // normal path
  try {
    const r = await tryRequest(url, { method: 'POST', body });
    const data = await r.json();
    resetFails();
    return reply.send(data);
  } catch (e) {
    addFail();
    if (breaker.state === 'closed' && breaker.fails.length >= breakerConfig.limit) {
      breaker.state = 'open';
      breaker.nextTry = now() + breakerConfig.waitMs;
    }
    return reply.code(503).send({ success: false, message: 'service is busy' });
  }
});

fastify.get('/getEvents', async (request, reply) => {  
  logger.info('Fetching events');
  const resp = await fetch(`${BASE_URL}/getEvents`);
  const data = await resp.json();
  reply.send(data);
});

fastify.get('/getEventsByUserId/:id', async (request, reply) => {
  logger.info(`Fetching events for user: ${request.params.id}`);
  const { id } = request.params;

  // get the user including list of event IDs
  const userResponse = await fetch(`${BASE_URL}/getUserById/${id}`);
  const userData = await userResponse.json();
  const eventIds = userData.events || [];

  // If user has no events,  return empty result 
  if (eventIds.length === 0) {
    return reply.send([]);
  }

  // get all events in parallel instead of one-by-one
  const eventPromises = eventIds.map(eventId =>
    fetch(`${BASE_URL}/getEventById/${eventId}`).then(res => res.json())
  );

  const events = await Promise.all(eventPromises);

  reply.send(events);
});


// Shutdown
const shutdown = () => {
  logger.warn('Shutting down server...');
  fastify.close().then(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

fastify.listen({ port: PORT }, (err) => {
  listenMock();
  if (err) {
    logger.error(err);
    process.exit(1);
  }
  logger.info(`Server running on port ${PORT}`);
});
