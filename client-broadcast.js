const https = require('https');
var events = require('events');
var express = require("express");
var eventEmitter = new events.EventEmitter();
var bodyParser = require("body-parser");
var crypto = require('crypto');
var config = require('./config-broadcast');
var ngrok = require('ngrok');
var fs = require('fs');
var app = express();

var url = '';

/* Function to make REST API Calls */
var makeVoiceAPICall = function(hostName, port, path,  data, callback) {

    let options = {
        host: hostName,
        port: port,
        path: path,
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + new Buffer(config.app_id + ':' + config.app_key).toString('base64'),
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }   
    };
    req = https.request(options, function(res) {
        var body = "";
        res.on('data', function(data) {
            body += data;
        });

        res.on('end', function() {
            callback(body);
        });

        res.on('error', function(e) {
            console.log("Got error: " + e.message);
        });
    });

    req.write(data);
    req.end();
}


/* Function to Create Call */
var createBroadcastCall = function(from, callback) {
    var jsonNumberArray = JSON.stringify(config.broadcast_list);

    var postData = JSON.stringify({
        "name": config.app_name,
        "owner_ref": "XYZ",
        "broadcastnumbersjson": jsonNumberArray,
        "from": from,
        "action_on_connect": {
            "play":{
                "text":"This is the welcome greeting",
                "voice": "female",
                "language": "en-US",
                "prompt_ref":"1"
                }
        },
        "call_param": {
            "IntervalBetweenRetries" : config.interval_between_retries,
            "NumberOfRetries" : config.number_of_retries
        },
        "event_url": url,
        "callhandler_url": url
    });
    
    makeVoiceAPICall(config.voice_server_host, config.voice_server_port, config.path, postData, function(response) {
        callback(response)});
}

/* Function to Hangup Call */
var hangupCall = function(hostName, port, path, callback) {
    let options = {
        host: hostName,
        port: port,
        path: path,
        method: 'DELETE',
        headers: {
            'Authorization': 'Basic ' + new Buffer(config.app_id + ':' + config.app_key).toString('base64'),
            'Content-Type': 'application/json',
        }   
    };
    req = https.request(options, function(res) {
        var body = "";
        res.on('data', function(data) {
            body += data;
        });

        res.on('end', function() {
            callback(body);
        });

        res.on('error', function(e) {
            console.log("Got error: " + e.message);
        });
    });

    req.end();
}


/* WebHook Event Handler function*/
var voiceEventHandler = function(voiceEvent) {
    if(voiceEvent.state && voiceEvent.state === 'connected') {
        console.log("[" + call.voice_id + "] Broadcast Call is connected");
    } else if(voiceEvent.state && voiceEvent.state === 'disconnected') {
        console.log("[" + call.voice_id + "] Broadcast Call is disconnected");
    } else if(voiceEvent.state == 'broadcastcomplete'){
        console.log("[" + call.voice_id + "] Message BroadCast Complete " + "Successful Calls : " + voiceEvent.resultSet.successfull_calls + " Failed Calls : " + voiceEvent.resultSet.failed_calls);
        shutdown();
    } else if(voiceEvent.playstate && voiceEvent.playstate === 'playfinished' && voiceEvent.prompt_ref === '1') {
        console.log("[" + call.voice_id + "] 1st Level prompt is completed");
        let playCommand = JSON.stringify({
          "voice_id":voiceEvent.voice_id,
          "play":{
            "text":"This is the second level menu, call will disconnect shortly",
            "prompt_ref":"2",
            "voice":"Female",
            "language":"en-US",
            "dtmf":true,
          }
        });
        
        makeVoiceAPICall(config.voice_server_host, config.voice_server_port, config.path + '/' + call.appInstance, playCommand,
                         function(response) {});
    } else if(voiceEvent.playstate === 'menutimeout' && voiceEvent.prompt_ref === '2') {
        console.log ("[" + call.voice_id + "] PlayFinished ,  disconnecting the call");
        hangupCall(config.voice_server_host, config.voice_server_port, '/voice/v1/calls/' + voiceEvent.voice_id, function(response) {
        });
    }
};

/* Object to maintain Call Details */
var call = {};
call["from"] = config.enablex_number; //Add proper telephone number
call["voice_id"] = ''; 

/* Initializing WebServer */
if(config.ngrok === true) {
    var server = app.listen(config.webhook_port, () => {
        console.log("Server running on port " + config.webhook_port);
        (async function() {
            try {
                url = await ngrok.connect(
                                    {proto : 'http',
                                     addr : config.webhook_port});
                console.log('ngrok tunnel set up:', url);
            } catch(error) {
                console.log("Error happened while trying to connect via ngrock " + JSON.stringify(error));
                shutdown();
                return;
            }
            url = url+'/event';
            /* Initiating Broadcast Call */
            createBroadcastCall(call.from, function(response) {
                var msg = JSON.parse(response);
                call["appInstance"] = msg.appInstance;
                call["voice_id"] = msg.appInstance;
                console.log("[" + call.voice_id + "] BroadCastCall AppInstance" + call.appInstance);
            });
        })();
    });
} else {
    if(config.ngrok === false){
        var options = {
            key: fs.readFileSync(config.certificate.ssl_key).toString(),
            cert: fs.readFileSync(config.certificate.ssl_cert).toString(),
        }
        if (config.certificate.ssl_ca_certs) {
            options.ca = [];
            for (var ca in config.certificate.ssl_ca_certs) {
                options.ca.push(fs.readFileSync(config.certificate.ssl_ca_certs[ca]).toString());
            }
        }
        var server = https.createServer(options, app);
        app.set('port', config.webhook_port);
        server.listen(config.webhook_port);

        server.on('error', onError);
        server.on('listening', onListening);
        url = 'https://' + config.webhook_host + ':' + config.webhook_port + '/event';
    }
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

app.post("/event", (req, res, next) => {
    var appId = config.app_id;

    var key = crypto.createDecipher(req.headers['x-algoritm'], appId);
    var decryptedData = key.update(req.body['encrypted_data'], req.headers['x-format'], req.headers['x-encoding']);
    decryptedData += key.final(req.headers['x-encoding']);
    var json_obj = JSON.parse(decryptedData);
    
    res.statusCode = 200;
    res.send();
    res.end();
    eventEmitter.emit('voicestateevent', json_obj);
});

function onError(error) {
    if (error.syscall !== 'listen') {
        throw error;
    }

    switch (error.code) {
        case 'EACCES':
            console.error('Port ' + config.webhook_port + ' requires elevated privileges');
            process.exit(1);
        break;
        case 'EADDRINUSE':
            console.error('Port ' + config.webhook_port + ' is already in use');
            process.exit(1);
        break;
        default:
            throw error;
    }
}

function onListening() {
    console.log('Listening on Port ' + config.webhook_port);
    /* Initiating Broadcast Call */
    createBroadcastCall(call.from, function(response) {
        var msg = JSON.parse(response);
        call["appInstance"] = msg.appInstance;
        call["voice_id"] = msg.appInstance;
        console.log("[" + call.voice_id + "] BroadCastCall AppInstance" + call.appInstance);
    });
};

process.on('SIGINT', function() {
    console.log("Caught interrupt signal");
    shutdown();
});

var shutdown = function() {
    server.close(() => {
        console.error('Shutting down the server');
        process.exit(0);
        });
    setTimeout(() => {
        process.exit(1);
      }, 10000);
};

/* Registering WebHook Event Handler function*/
eventEmitter.on('voicestateevent', voiceEventHandler);
