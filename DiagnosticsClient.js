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
    console.log(new Date().toISOString(),'Heartbeat from server (ping)');
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
        console.log(new Date().toISOString(),'Received message',data);
        heartbeat();
        processMessage(data);
    });

    ws.on('ping', heartbeat);
};

var send = function(payload) {
    var payload = JSON.stringify(payload);
    console.log(new Date().toISOString(),'Sending payload',payload);
    ws.send(payload);
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
    console.log(new Date().toISOString(),'processing message',data);
    var data = parseData(data);
    console.log(new Date().toISOString(),'processing parsed message',data);
    if (data.shutdown) {
        console.log(new Date().toISOString(),'Server is telling me to shutdown because:',data.message);
        console.log(new Date().toISOString(),'Shutting down');
        process.exit(0);
        return false;
    }
    if (data.tool && tools.hasOwnProperty(data.tool)) {
        console.log(new Date().toISOString(),'Going to run',data.tool,'on:',data);
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
        console.log(new Date().toISOString(),'Going to run MTR');
        mtr.diagRun(data, function(reply) {
            console.log(new Date().toISOString(),'reply from mtr:',reply);
            data.results = reply;
            send({action:'diagResults',data:data});
        });
    },
    ping: function(data) {
        console.log(new Date().toISOString(),'Going to run PING');
        pingo.diagRun(data, function(reply) {
            console.log(new Date().toISOString(),'reply from ping:',reply);
            data.results = reply;
            send({action:'diagResults',data:data});
        });
    },
    traceroute: function(data) {
        console.log(new Date().toISOString(),'Going to run traceroute');
        traceroute.diagRun(data, function(reply) {
            console.log(new Date().toISOString(),'reply from traceroute:',reply);
            data.results = reply;
            send({action:'diagResults',data:data});
        });
    },
    dig: function(data) {
        console.log(new Date().toISOString(),'Going to run dig');
        dig.diagRun(data, function(reply) {
            console.log(new Date().toISOString(),'reply from dig:',reply);
            data.results = reply;
            send({action:'diagResults',data:data});
        });
    }
};

startClient();