/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * DiagnosticClient.js
 * Websocket client to connect to NodePing diagnostic servers so you can run diagnostics on your AGENT.
 */

const WebSocket = require('ws');
var pingTimeout, ws;
var reconnectcount = 0;
var config = require('./config');
var pingo = require('./diagnostics/ping.js');
var mtr = require('./diagnostics/mtr.js');
var traceroute = require('./diagnostics/traceroute.js');
var dig = require('./diagnostics/dig.js');
var ws;
var runningTool = 0;

if (!config.NodePingAgent_enabled) {
    console.log(new Date().toISOString(),'Check is disabled in config.js - shutting down');
    process.exit(0);
}

if (!config.diagnosticserver || !config.diagnosticserver.host || !config.diagnosticserver.port) {
    console.log(new Date().toISOString(),'Missing diagnosticserver info in config.js - shutting down');
    process.exit(0);
}

if (!config.check_id || !config.check_token || config.check_id === '<Your NodePing Check ID>' || config.check_token === '<Your NodePing Check Token>') {
    console.log(new Date().toISOString(),'Missing check info in config.js - shutting down');
    process.exit(0);
}

var heartbeat = function() {
    console.log(new Date().toISOString(),'Heartbeat ping from the diagnostics server - responding with pong');
    clearTimeout(pingTimeout);

    pingTimeout = setTimeout( function(){
        console.log(new Date().toISOString(),'Server timed out of heartbeat (31 seconds)');
        ws.close();
        reconnectcount++;
        startClient();
    }, 30000 + 1000);
};

var startClient = function() {
    console.log(new Date().toISOString(),'Starting Client called - reconnectcount is',reconnectcount);
    ws = false;
    setTimeout(connectToServer,reconnectcount * 1000);
};

var connectToServer = function() {
    console.log(new Date().toISOString(),'Connecting to server');

    ws = new WebSocket('wss://'+config.diagnosticserver.host+':'+config.diagnosticserver.port+'/',{perMessageDeflate: false, timeout:4000});

    ws.on('error', function error(err) {
        console.log(new Date().toISOString(),'Error from server',err);
        clearTimeout(pingTimeout);
        ws.terminate();
    });

    ws.on('open', function open() {
        reconnectcount = 0;
        console.log(new Date().toISOString(),'connected');
        heartbeat();
        send({action:"register",agent:{checkid:config.check_id,checktoken:config.check_token}});
    });

    ws.on('close', function close() {
        console.log(new Date().toISOString(),'disconnected');
        clearTimeout(pingTimeout);
        reconnectcount++;
        startClient();
        return true;
    });

    ws.on('message', function incoming(data) {
        console.log(new Date().toISOString(),'Receiving request from diagnostics server');
        processMessage(data);
    });

    ws.on('ping', heartbeat);
};

var send = function(payload, cb) {
    if (!cb) {
        cb = function(){};
    }
    var payload = JSON.stringify(payload);
    console.log(new Date().toISOString(),'Sending data to diagnostics server');
    ws.send(payload, function(){
        console.log(new Date().toISOString(),'Data sent');
        return cb();
    });
}

var parseData = function(data) {
    try {
        return JSON.parse(data);
    } catch (parseerror) {
        console.log(new Date().toISOString(),'Parse error', parseerror, data);
        return {};
    }
}

var processMessage = function (data) {
    //console.log(new Date().toISOString(),'processing message',data);
    var data = parseData(data);
    //console.log(new Date().toISOString(),'processing parsed message',data);
    if (data.shutdown) {
        console.log(new Date().toISOString(),'Server is telling me to shutdown because:',data.message);
        console.log(new Date().toISOString(),'Shutting down');
        process.exit(0);
        return false;
    }
    if (data.tool && tools.hasOwnProperty(data.tool)) {
        console.log(new Date().toISOString(),'Going to run',data.tool,'on:',data);
        runningTool++;
        return tools[data.tool](data);
    } else {
        console.log(new Date().toISOString(),'Unknown test tool',data.tool,'for:',data);
        data.error = 'Unknown test tool';
        return send({action:'diagResults',data:data});
    }
    console.log(new Date().toISOString(),'Unknown message',data);
};

var tools = {
    mtr: function(data) {
        console.log(new Date().toISOString(),'Running mtr');
        mtr.diagRun(data, function(reply) {
            console.log(new Date().toISOString(),'mtr results:',reply);
            data.results = reply;
            send({action:'diagResults',data:data},function(){
                runningTool--;
            });
        });
    },
    ping: function(data) {
        console.log(new Date().toISOString(),'Running ping');
        pingo.diagRun(data, function(reply) {
            console.log(new Date().toISOString(),'ping results:',reply);
            data.results = reply;
            send({action:'diagResults',data:data},function(){
                runningTool--;
            });
        });
    },
    traceroute: function(data) {
        console.log(new Date().toISOString(),'Running traceroute');
        traceroute.diagRun(data, function(reply) {
            console.log(new Date().toISOString(),'traceroute results:',reply);
            data.results = reply;
            send({action:'diagResults',data:data},function(){
                runningTool--;
            });
        });
    },
    dig: function(data) {
        console.log(new Date().toISOString(),'Running dig');
        dig.diagRun(data, function(reply) {
            console.log(new Date().toISOString(),'dig results:',reply);
            data.results = reply;
            send({action:'diagResults',data:data},function(){
                runningTool--;
            });
        });
    }
};

var restartWSConnection = function(retry) {
    retry = retry || 0;
    if (retry > 10) {
        console.log(new Date().toISOString(),'Restarting websocket connection after max retry');
        ws.close();
    } else {
        if (runningTool) {
            console.log(new Date().toISOString(),'Tool running - waiting to restart websocket connection.');
            retry++;
            setTimeout(function(){
                restartWSConnection(retry);
            },30000);
        } else {
            console.log(new Date().toISOString(),'Restarting websocket connection');
            ws.close();
        }
    }
    return true;
};

setInterval(restartWSConnection,3600000); // restart the websocket connection each hour.
startClient();