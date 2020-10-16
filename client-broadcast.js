// core modules
const http = require('http');
// modules installed from npm
const { EventEmitter } = require('events');
const express = require('express');
const bodyParser = require('body-parser');
const { createDecipher } = require('crypto');
require('dotenv').config();
const _ = require('lodash');
// application modules
const logger = require('./logger');
const {
  playBroadcastIVR, makeBroadcastCall, hangupCall,
} = require('./voiceapi');

// Express app setup
const app = express();

const eventEmitter = new EventEmitter();

let server;
const call = {};
let ttsPlayVoice = 'female';
const sseMsg = [];
const servicePort = process.env.SERVICE_PORT || 3000;

// shutdown the node server forcefully
function shutdown() {
  server.close(() => {
    logger.info('Shutting down the server');
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(1);
  }, 10000);
}

// Set webhook event url
function onListening() {
  logger.info(`Listening on Port ${servicePort}`);
}

// Handle error generated while creating / starting an http server
function onError(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  switch (error.code) {
    case 'EACCES':
      logger.error(`Port ${servicePort} requires elevated privileges`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      logger.error(`Port ${servicePort} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
}

// create and start an HTTPS node app server
// An SSL Certificate (Self Signed or Registered) is required
function createAppServer() {
  const options = {};

  // Create https express server
  server = http.createServer(options, app);
  app.set('port', servicePort);
  server.listen(servicePort);
  server.on('error', onError);
  server.on('listening', onListening);
}

/* Initializing WebServer */
if (process.env.ENABLEX_APP_ID
  && process.env.ENABLEX_APP_KEY) {
  createAppServer();
} else {
  logger.error('Please set env variables - ENABLEX_APP_ID, ENABLEX_APP_KEY');
}

process.on('SIGINT', () => {
  logger.info('Caught interrupt signal');
  shutdown();
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('client'));

// outbound voice call
// req contains fromNumber, toNumber, TTS text, & voice (gender)
app.post('/broadcast-call', (req, res) => {
  logger.info(`Initiating a call from ${req.body.from} to ${req.body.to}`);
  // set msg to be used for SSE events to display on webpage
  sseMsg.push(`Initiating a call from ${req.body.from} to ${req.body.to}`);
  // voice (gender) received from request will also be used in webhook
  ttsPlayVoice = req.body.play_voice;

  /* Initiating Broadcast Call */
  makeBroadcastCall(req.body, (response) => {
    const msg = JSON.parse(response);
    // set voice_id & appInstance to be used throughout
    call.appInstance = msg.appInstance;
    call.voice_id = msg.appInstance;
    logger.info(`[${call.voice_id}] Broadcast Call AppInstance ${call.appInstance}`);
    res.send(msg);
    res.status(200);
  });
});

// It will send stream / events all the events received from webhook to the client
app.get('/event-stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const id = (new Date()).toLocaleTimeString();

  setInterval(() => {
    if (!_.isEmpty(sseMsg[0])) {
      const data = `${sseMsg[0]}`;
      res.write(`id: ${id}\n`);
      res.write(`data: ${data}\n\n`);
      sseMsg.pop();
    }
  }, 100);
});

// Webhook event which will be called by EnableX server once an outbound call is made
// It should be publicly accessible. Please refer document for webhook security.
app.post('/event', (req, res) => {
  if (req.headers['x-algoritm'] !== undefined) {
    const key = createDecipher(req.headers['x-algoritm'], process.env.ENABLEX_APP_ID);
    let decryptedData = key.update(req.body.encrypted_data, req.headers['x-format'], req.headers['x-encoding']);
    decryptedData += key.final(req.headers['x-encoding']);
    const jsonObj = JSON.parse(decryptedData);
    logger.info(JSON.stringify(jsonObj));
  } else {
    const jsonObj = req.body;
    logger.info(JSON.stringify(jsonObj));
  }

  res.statusCode = 200;
  res.send();
  res.end();
  eventEmitter.emit('voicestateevent', jsonObj);
});

/* WebHook Event Handler function */
function voiceEventHandler(voiceEvent) {
  if (voiceEvent.state) {
    if (voiceEvent.state === 'connected') {
      const eventMsg = 'Broadcast Call is connected';
      logger.info(`[${call.voice_id}] ${eventMsg}`);
      sseMsg.push(eventMsg);
    } else if (voiceEvent.state === 'disconnected') {
      const eventMsg = 'Broadcast Call is disconnected';
      logger.info(`[${call.voice_id}] Broadcast Call is disconnected`);
      sseMsg.push(eventMsg);
    } else if (voiceEvent.state === 'broadcastcomplete') {
      logger.info(`[${call.voice_id}] Message BroadCast Complete.`);
      logger.info(`Successful Calls : ${voiceEvent.resultSet.successfull_calls}`);
      logger.info(`Failed Calls : ${voiceEvent.resultSet.failed_calls}`);
      sseMsg.push(`Message BroadCast Complete. Successful Calls : ${voiceEvent.resultSet.successfull_calls} Failed Calls : ${voiceEvent.resultSet.failed_calls}`);
    }
  }

  if (voiceEvent.playstate !== undefined) {
    if (voiceEvent.playstate === 'playfinished' && voiceEvent.prompt_ref === '1') {
      const eventMsg = '1st Level prompt is completed';
      logger.info(`[${call.voice_id}] ${eventMsg}`);
      sseMsg.push(eventMsg);
      /* Playing Broadcast IVR using TTS */
      playBroadcastIVR(call.appInstance, voiceEvent.voice_id, ttsPlayVoice, () => {});
    } else if (voiceEvent.playstate === 'menutimeout' && voiceEvent.prompt_ref === '2') {
      const eventMsg = `[${call.voice_id}] Play finished. Disconnecting the call`;
      logger.info(eventMsg);
      sseMsg.push(eventMsg);
      hangupCall(voiceEvent.voice_id, () => {});
    }
  }
}

/* Registering WebHook Event Handler function */
eventEmitter.on('voicestateevent', voiceEventHandler);
