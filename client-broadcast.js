// core modules
const https = require('https');
const { readFileSync } = require('fs');
// modules installed from npm
const events = require('events');
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const ngrok = require('ngrok');
require('dotenv').config();
// application modules
const logger = require('./logger');
const {
  makeVoiceAPICall, createBroadcastCall, hangupCall, onError,
} = require('./voiceapi');

const eventEmitter = new events.EventEmitter();
const app = express();

let url = '';
let server;
/* Object to maintain Call Details */
const call = {};
call.voice_id = '';

function onListening() {
  logger.info(`Listening on Port ${process.env.INCOMING_WEBHOOK_PORT}`);
  /* Initiating Broadcast Call */
  createBroadcastCall(url, (response) => {
    const msg = JSON.parse(response);
    call.appInstance = msg.appInstance;
    call.voice_id = msg.appInstance;
    logger.info(`[${call.voice_id}] BroadCastCall AppInstance ${call.appInstance}`);
  });
}

function shutdown() {
  server.close(() => {
    logger.error('Shutting down the server');
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(1);
  }, 10000);
}

/* Initializing WebServer */
if (process.env.USE_NGROK_TUNNEL === 'true') {
  server = app.listen(process.env.SERVICE_PORT, () => {
    console.log(`Server running on port ${process.env.SERVICE_PORT}`);
    (async () => {
      try {
        url = await ngrok.connect({ proto: 'http', addr: process.env.SERVICE_PORT });
        console.log('ngrok tunnel set up:', url);
      } catch (error) {
        console.log(`Error happened while trying to connect via ngrok ${JSON.stringify(error)}`);
        shutdown();
        return;
      }
      url = `${url}/event`;
      /* Initiating Broadcast Call */
      createBroadcastCall(url, (response) => {
        const msg = JSON.parse(response);
        call.appInstance = msg.appInstance;
        call.voice_id = msg.appInstance;
        console.log(`[${call.voice_id}] Broadcast Call AppInstance ${call.appInstance}`);
      });
    })();
  });
} else if (process.env.USE_NGROK_TUNNEL === 'false') {
  const options = {
    key: readFileSync(process.env.CERTIFICATE_SSL_KEY).toString(),
    cert: readFileSync(process.env.CERTIFICATE_SSL_CERT).toString(),
  };
  if (process.env.CERTIFICATE_SSL_CACERTS) {
    options.ca = [];
    options.ca.push(readFileSync(process.env.CERTIFICATE_SSL_CACERTS).toString());
  }
  server = https.createServer(options, app);
  app.set('port', process.env.SERVICE_PORT);
  server.listen(process.env.SERVICE_PORT);

  server.on('error', onError);
  server.on('listening', onListening);
  url = `${process.env.PUBLIC_WEBHOOK_HOST}:${process.env.SERVICE_PORT}/event`;
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.post('/event', (req, res) => {
  const key = crypto.createDecipher(req.headers['x-algoritm'], process.env.ENABLEX_APP_ID);
  let decryptedData = key.update(req.body.encrypted_data, req.headers['x-format'], req.headers['x-encoding']);
  decryptedData += key.final(req.headers['x-encoding']);
  const jsonObj = JSON.parse(decryptedData);

  res.statusCode = 200;
  res.send();
  res.end();
  eventEmitter.emit('voicestateevent', jsonObj);
});

/* WebHook Event Handler function */
function voiceEventHandler(voiceEvent) {
  if (voiceEvent.state && voiceEvent.state === 'connected') {
    logger.info(`[${call.voice_id}] Broadcast Call is connected`);
  } else if (voiceEvent.state && voiceEvent.state === 'disconnected') {
    logger.info(`[${call.voice_id}] Broadcast Call is disconnected`);
  } else if (voiceEvent.state === 'broadcastcomplete') {
    logger.info(`[${call.voice_id}] Message BroadCast Complete.`);
    logger.info(`Successful Calls : ${voiceEvent.resultSet.successfull_calls}`);
    logger.info(`Failed Calls : ${voiceEvent.resultSet.failed_calls}`);
    shutdown();
  } else if (voiceEvent.playstate && voiceEvent.playstate === 'playfinished' && voiceEvent.prompt_ref === '1') {
    logger.info(`[${call.voice_id}] 1st Level prompt is completed`);
    const playCommand = JSON.stringify({
      voice_id: voiceEvent.voice_id,
      play: {
        text: 'This is the second level menu, call will disconnect shortly',
        prompt_ref: '2',
        voice: 'Female',
        language: 'en-US',
        dtmf: true,
      },
    });

    makeVoiceAPICall(`/voice/v1/broadcast/${call.appInstance}`, playCommand, () => {});
  } else if (voiceEvent.playstate === 'menutimeout' && voiceEvent.prompt_ref === '2') {
    logger.info(`[${call.voice_id}] Play finished. Disconnecting the call`);
    hangupCall(`/voice/v1/calls/${voiceEvent.voice_id}`, () => {});
  }
}

process.on('SIGINT', () => {
  logger.info('Caught interrupt signal');
  shutdown();
});

/* Registering WebHook Event Handler function */
eventEmitter.on('voicestateevent', voiceEventHandler);
