/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_ping.js
 * Basic ping check.
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout:3000              // Can be overriden by a parameter
};

var resultobj = require('../results.js');
var sys = require('util');
var ipaddr = require('ipaddr.js');
var childprocess = require('child_process');

var logger = console;

exports.check = function(jobinfo, retryipv6){
    //debug('info',"Jobinfo passed to ping check: "+sys.inspect(jobinfo));
    //if(jobinfo.parameters.threshold) config.timeout = jobinfo.parameters.threshold;
    var timeout = config.timeout * 1;
    if(jobinfo.parameters.threshold){
        if(jobinfo.parameters.threshold < 1) jobinfo.parameters.threshold = 1;
        timeout = parseInt(jobinfo.parameters.threshold) * 1000;
        if (timeout > 5000) timeout = 5000;
    }
    jobinfo.results = {start:new Date().getTime()};
    if (!jobinfo.parameters.target){
        debugMessage('info',"check_ping: Invalid target");
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid target';
        resultobj.process(jobinfo, true);
        return true;
    } else {
        //debugMessage('info',"check_ping: retryipv6:"+sys.inspect(retryipv6));
        var ping = 'ping';
        if (jobinfo.parameters.ipv6 || retryipv6 || ipaddr.IPv6.isValid(jobinfo.parameters.target)) {
            ping = 'ping6';
        }
        var receiveddata = false,
        spawn = childprocess.spawn,
        killit = false;
        var pingdata = '';
        try{
           
            var timeoutid = setTimeout(function() {
                if(killit){
                    return true;
                }
                killit = true;
                if(pingo){
                    pingo.kill('SIGKILL');
                    pingo = null;
                }
                debugMessage('info',"check_ping: setTimeout called.");
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Timeout';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Timeout';
                resultobj.process(jobinfo);
                return true;
            }, timeout);
            var pingo  = spawn( ping, ['-n', '-c1', '-W', timeout/1000, jobinfo.parameters.target]);

            pingo.stdout.on('data', function (data) {
                if (killit) {
                    // Nothing to do here.
                    //debugMessage('info','check_ping: Receiving another "on" "data" ' + sys.inspect(data));
                    if(pingo){
                        pingo.kill('SIGKILL');
                        pingo = null;
                    }
                    return true;
                }else{
                    pingdata = pingdata + data.toString();
                }
            });

            pingo.stderr.on('data', function (data) {
                debugMessage('info',"check_ping: We caught an error - maybe timeout: "+data.toString());
                receiveddata = true;
                if (!killit){
                    killit = true;
                    var err = data.toString();
                    if (!retryipv6 && err.indexOf('unknown host')){
                        if(pingo){
                            pingo.kill('SIGKILL');
                            pingo = null;
                        }
                        return exports.check(jobinfo, true);
                    }   
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'error';
                    jobinfo.results.success = false;
                    jobinfo.results.message = data.toString();
                    resultobj.process(jobinfo);
                    if(pingo){
                        pingo.kill('SIGKILL');
                        pingo = null;
                    }
                }
                return true;
            });

            pingo.on('close', function(code) {
                debugMessage('info',"check_ping: close: "+code);
                if (!killit) {
                    killit = true;
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    var lines = pingdata.toString().split("\n");
                    var patt1=/([0-9]+[\.][0-9]+[\.][0-9]+[\.][0-9]+)/g;
                    var ip = lines[0].match(patt1);
                    if(ip && ip.length == 1){
                        ip =  ip[0];
                        jobinfo.results.message = ip;
                    }else{
                        jobinfo.results.message = pingdata.toString();
                    }
                    //debugMessage('info','check_ping: Ping: IP is ' + sys.inspect(ip));
                    var patt2=/[0-9]+[0-9\.][0-9]+ ms/g;
                    var latency = lines[1].match(patt2);
                    //debugMessage('info','check_ping: Ping: line 1 is ' + sys.inspect(lines[1]));
                    if(latency && latency.length == 1){
                        latency =  parseFloat(latency[0].replace(' ms', ''));
                        //debugMessage('info','check_ping: Ping: latency is ' + sys.inspect(latency));
                        if(latency){
                            latency = parseFloat(latency.toFixed(2));
                            jobinfo.results.statusCode = latency;
                            jobinfo.results.runtime = latency;
                            jobinfo.results.success = true;
                        }else{
                            jobinfo.results.statusCode = 'error';
                            jobinfo.results.success = false;
                            jobinfo.results.message = 'Error';
                        }
                    }else{
                        jobinfo.results.statusCode = 'timeout';
                        jobinfo.results.success = false;
                        jobinfo.results.message = 'Timeout';
                    }
                    resultobj.process(jobinfo);
                    //debugMessage('info','check_ping: Ping: latency below is ' + sys.inspect(latency));
                    pingo = null;
                    return true;
                }
            });
        }catch(errr){
            if (!killit){
                killit = true;
                if(pingo){
                    try{
                        pingo.kill('SIGKILL');
                        pingo = null;
                    }catch(pingerr){
                        debugMessage('info',"check_ping: We caught a big error trying to kill ping: "+pingerr.toString());
                    }
                }
                debugMessage('error',"check_ping: Error: "+errr.toString());
                jobinfo.results.success = false;
                jobinfo.results.statusCode = 'error';
                jobinfo.results.message = errr.toString();
                resultobj.process(jobinfo);
            }
            return true;
        }
        return true;
    }
    function debugMessage(messageType, message){
        if(jobinfo.debug){
            logger.log(messageType,message);
        }
    }
    return true;
};