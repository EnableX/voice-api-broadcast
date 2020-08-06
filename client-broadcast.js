// core modules
const https = require('https');
const { readFileSync } = require('fs');
// modules installed from npm
const events = require('events');
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const ngrok = require('ngrok');
// application modules
const logger = require('./logger');
const config = require('./config-broadcast');
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
  logger.info(`Listening on Port ${config.webhook_port}`);
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
if (config.ngrok === true) {
  server = app.listen(config.webhook_port, () => {
    console.log(`Server running on port ${config.webhook_port}`);
    (async () => {
      try {
        url = await ngrok.connect({ proto: 'http', addr: config.webhook_port });
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
        console.log(`[${call.voice_id}] BroadCastCall AppInstance ${call.appInstance}`);
      });
    })();
  });
} else if (config.ngrok === false) {
  const options = {
    key: readFileSync(config.certificate.ssl_key).toString(),
    cert: readFileSync(config.certificate.ssl_cert).toString(),
  };
  if (config.certificate.ssl_ca_certs) {
    options.ca = [];
    options.ca.push(readFileSync(config.certificate.ssl_ca_certs).toString());
  }
  server = https.createServer(options, app);
  app.set('port', config.webhook_port);
  server.listen(config.webhook_port);

  server.on('error', onError);
  server.on('listening', onListening);
  url = `https://${config.webhook_host}:${config.webhook_port}/event`;
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.post('/event', (req, res) => {
  const key = crypto.createDecipher(req.headers['x-algoritm'], config.app_id);
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

    makeVoiceAPICall(`${config.path}/${call.appInstance}`, playCommand, () => {});
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
