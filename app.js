const assert = require('assert');
const express = require('express');
const app = express();
const Websocket = require('ws');
const wsServer = new Websocket.Server({ noServer: true });
const {WebhookResponse} = require('@jambonz/node-client');
const basicAuth = require('express-basic-auth');
const opts = Object.assign({
  timestamp: () => `, "time": "${new Date().toISOString()}"`,
  level: process.env.LOGLEVEL || 'info'
});
const handleAudio = require('./lib/utils/handle-audio');
const loadMembers = require('./lib/utils/load-members');
const MeetingTracker = require('./lib/utils/meeting-tracker');
const logger = require('pino')(opts);
const port = process.env.HTTP_PORT || 3000;

assert.ok(process.env.JAMBONZ_ACCOUNT_SID, 'You must define the JAMBONZ_ACCOUNT_SID env variable');
assert.ok(process.env.JAMBONZ_API_KEY, 'You must define the JAMBONZ_API_KEY env variable');
assert.ok(process.env.JAMBONZ_REST_API_BASE_URL, 'You must define the JAMBONZ_REST_API_BASE_URL env variable');

wsServer.on('connection', handleAudio.bind(null, logger, app));

const routes = require('./lib/routes');
app.locals = {
  ...app.locals,
  logger,
  client: require('@jambonz/node-client')(process.env.JAMBONZ_ACCOUNT_SID, process.env.JAMBONZ_API_KEY, {
    baseUrl: process.env.JAMBONZ_REST_API_BASE_URL
  }),
  meetingTracker: MeetingTracker(logger)
};

if (process.env.HTTP_USERNAME && process.env.HTTP_PASSWORD) {
  const users = {};
  users[process.env.HTTP_USERNAME] = process.env.HTTP_PASSWORD;
  app.use(basicAuth({users}));
}
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
if (process.env.WEBHOOK_SECRET) {
  app.use(WebhookResponse.verifyJambonzSignature(process.env.WEBHOOK_SECRET));
}
app.use('/', routes);
app.use((err, req, res, next) => {
  logger.error(err, 'burped error');
  res.status(err.status || 500).json({msg: err.message});
});

const server = app.listen(port, () => {
  logger.info(`Example jambonz app listening at http://localhost:${port}`);
});
server.on('upgrade', (request, socket, head) => {
  wsServer.handleUpgrade(request, socket, head, (socket) => {
    if (request.url !== process.env.LISTEN_PATH) return socket.destroy();
    wsServer.emit('connection', socket, request);
  });
});

if (process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SHEET_CREDENTIALS_FILE) {
  retrieveMembers();
}

async function retrieveMembers() {
  app.locals.members = await loadMembers(logger);
  logger.debug({members: app.locals.members}, 'team members');
}
