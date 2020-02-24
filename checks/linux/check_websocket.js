/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_websocket.js
 * web socket.
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout:10000              // Can be overriden by a parameter
};

var resultobj = require('../results.js');
var sys = require('util');
var logger = console;
var WebSocket = require('ws');

exports.check = function(jobinfo){
    var defaulttimeout = config.timeout * 1;
    var timeout = config.timeout * 1;
    if(jobinfo.parameters.threshold){
        defaulttimeout = 1000 * parseInt(jobinfo.parameters.threshold);
        if (defaulttimeout > 90000) defaulttimeout = 90000;
        timeout = defaulttimeout + 2000;
    }
    var debugMessage = function (messageType, message){
        if(jobinfo.debug || config.debug){
            logger.log(messageType,message);
        }
    };
    //logger.log('info',"check_websocket: Jobinfo passed to http check: "+sys.inspect(jobinfo));
    if(jobinfo.debug) config.debug = jobinfo.debug;
    jobinfo.results = {start:new Date().getTime()};
    if(!jobinfo.parameters.target){
        //logger.log('info',"check_websocket: Invalid URL");
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid URL';
        resultobj.process(jobinfo, true);
        return true;
    }else{
        try{
            var targetinfo = require('url').parse(jobinfo.parameters.target);
        }catch(error){
            //logger.log('info',"check_websocket: Invalid URL");
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = 'URL will not parse: '+error;
            resultobj.process(jobinfo, true);
            return true;
        }
        if(!targetinfo.hasOwnProperty('protocol') || !(targetinfo.protocol == 'ws:' || targetinfo.protocol == 'wss:' ||targetinfo.protocol == 'http:' || targetinfo.protocol == 'https:')){
            //logger.log('info',"check_websocket: Invalid Protocol");
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = 'Protocol must be "ws://" or "http://" or "https://"';
            resultobj.process(jobinfo, true);
            return true;
        }
        var killit = false;
        var sentData = false;
        if(targetinfo.protocol == 'ws:' || targetinfo.protocol == 'wss:'){
            var socketio = false;
        } else {
            var socketio = true;
        }
        try{
            if (socketio) {
                debugMessage('info','check_websocket: using socketio');
                var connectevent = 'connect';
                var io = require('socket.io-client');
                var connectionOptions = {'force new connection': true};
                if (targetinfo.protocol == 'https:') {
                    connectionOptions.secure = true;
                }
                var ws = io.connect(jobinfo.parameters.target, connectionOptions);
            } else {
                debugMessage('info','check_websocket: using ws');
                var connectevent = 'open';
                var connectionOptions = {};
                if (targetinfo.protocol == 'wss:') {
                    connectionOptions.rejectUnauthorized = false;
                }
                var ws = new WebSocket(jobinfo.parameters.target, connectionOptions);
            }
            var timeoutid = setTimeout(function() {
                if(killit){
                    return true;
                }
                killit = true;
                //logger.log('info',"check_websocket: setTimeout called: "+timeout.toString()+', jobid: '+sys.inspect(jobinfo._id));
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Timeout';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Timeout';
                resultobj.process(jobinfo);
                if (ws) {
                    if (socketio) {
                        ws.disconnect();
                        delete ws.socket;
                    } else {
                        ws.close();
                    }
                }
                return true;
            }, timeout);
                
            ws.on(connectevent, function() {
                debugMessage('info','check_websocket: connected');
                if(!killit){
                    if(jobinfo.parameters.data){
                        ws.send(jobinfo.parameters.data,function(error) {
                            debugMessage('info','check_websocket: sent data');
                            sentData = true;
                            if(error && !killit){
                                clearTimeout(timeoutid);
                                killit = true;
                                jobinfo.results.end = new Date().getTime();
                                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                                jobinfo.results.statusCode = 'Error';
                                jobinfo.results.success = false;
                                jobinfo.results.message = 'Error sending data: '+error.toString();
                                resultobj.process(jobinfo);
                                if (ws) {
                                    if (socketio) {
                                        ws.disconnect();
                                        delete ws.socket;
                                    } else {
                                        ws.close();
                                    }
                                }
                                return false;
                            }
                            if (!jobinfo.parameters.contentstring) {
                                killit = true;
                                jobinfo.results.end = new Date().getTime();
                                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                                jobinfo.results.statusCode = 'Sent message';
                                jobinfo.results.success = true;
                                jobinfo.results.message = 'Sent message: '+jobinfo.parameters.data;
                                resultobj.process(jobinfo);
                                if (ws) {
                                    if (socketio) {
                                        ws.disconnect();
                                        delete ws.socket;
                                    } else {
                                        ws.close();
                                    }
                                }
                            }
                            return true;
                        });
                    } else {
                        clearTimeout(timeoutid);
                        killit = true;
                        jobinfo.results.success = true;
                        jobinfo.results.end = new Date().getTime();
                        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                        jobinfo.results.statusCode = 'Connected';
                        jobinfo.results.message = 'Success';
                        resultobj.process(jobinfo);
                        if (ws) {
                            if (socketio) {
                                ws.disconnect();
                                delete ws.socket;
                            } else {
                                ws.close();
                            }
                        }
                    }
                }
            });
            ws.on('message', function(data, flags) {
                debugMessage('info','check_websocket: got message: '+sys.inspect(data));
                if(!killit){
                    if(jobinfo.parameters.data && !sentData){
                        // We haven't sent data yet, so we should wait for the reply.
                        // Ignore this message.
                        return true;
                    }
                    clearTimeout(timeoutid);
                    killit = true;
                    jobinfo.results.success = true;
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Received';
                    jobinfo.results.message = 'Data received';
                    if(jobinfo.parameters.contentstring){
                        debugMessage('info','check_websocket: Looking for '+jobinfo.parameters.contentstring+' in: '+sys.inspect(data));
                        //logger.log('info','check_websocket: data is: '+sys.inspect(data));
                        var foundit = data.indexOf(jobinfo.parameters.contentstring);
                        if(foundit < 0 ){
                            jobinfo.results.statusCode = 'Not found';
                            if(jobinfo.parameters.invert){
                                //logger.log('info','check_websocket: We did not find what we were not looking for:  '+jobinfo.parameters.contentstring+' in the body of : '+jobinfo.parameters.target);
                                jobinfo.results.success = true;
                            }else{
                                //logger.log('info','check_websocket: We did not find '+jobinfo.parameters.contentstring+' in the body of : '+jobinfo.parameters.target);
                                jobinfo.results.success = false;
                            }
                        }else{
                            jobinfo.results.statusCode = 'Found';
                            if(jobinfo.parameters.invert){
                                //logger.log('info','check_websocket: We found what we did not expect '+jobinfo.parameters.contentstring+' in the body of : '+jobinfo.parameters.target);
                                jobinfo.results.success = false;
                            }else{
                                //logger.log('info','check_websocket: We found '+jobinfo.parameters.contentstring+' in the body of : '+jobinfo.parameters.target);
                                jobinfo.results.success = true;
                            }
                        }
                    }
                    resultobj.process(jobinfo);
                    if (ws) {
                        if (socketio) {
                            ws.disconnect();
                            delete ws.socket;
                        } else {
                            ws.close();
                        }
                    }
                }
                return true;
            });
            ws.on("error", function(e){
                clearTimeout(timeoutid);
                debugMessage('info','check_websocket: error event: '+sys.inspect(e));
                if(!killit){
                    killit = true;
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Error';
                    jobinfo.results.success = false;
                    jobinfo.results.message = e.toString();
                    resultobj.process(jobinfo);
                }
                if (ws) {
                    if (socketio) {
                        ws.disconnect();
                        delete ws.socket;
                    } else {
                        ws.close();
                    }
                }
                return true;
            });
        }catch(ec){
            clearTimeout(timeoutid);
            debugMessage('info','check_websocket: caught error: '+sys.inspect(ec));
            if (ws) {
                if (socketio) {
                    ws.disconnect();
                    delete ws.socket;
                } else {
                    ws.close();
                }
            }
            if(!killit){
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.success = false;
                jobinfo.results.message = "Caught "+ec.toString();
                resultobj.process(jobinfo);
                killit = true;
            }
            return true;
        }
    }
    return true;
};