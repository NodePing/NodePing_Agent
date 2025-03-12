/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_port.js
 * Basic port check
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
var net = require('net');

var logger = console;

exports.check = function(jobinfo){
    //logger.log('info',"Jobinfo passed to port check: "+sys.inspect(jobinfo));
    var timeout =  config.timeout *1;
    if (jobinfo.parameters.threshold) timeout = parseInt(jobinfo.parameters.threshold)*1000;
    if (timeout > 90000) timeout = 90000;
    var debugMessage = function (messageType, message) {
        if (jobinfo.debug || config.debug) {
            logger.log(messageType,message);
        }
        return true;
    };
    debugMessage('info',"check_port: Jobinfo passed to PORT check: "+sys.inspect(jobinfo));
    jobinfo.results = {start:new Date().getTime()};
    if (!jobinfo.parameters.target) {
        //logger.log('info',"check_port: Missing target");
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing target';
        jobinfo.results.end = new Date().getTime();
        resultobj.process(jobinfo, true);
        return true;
    } else if (!jobinfo.parameters.port) {
        //logger.log('info',"check_port: Missing port");
        jobinfo.results.success = false;   
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing port';
        jobinfo.results.end = new Date().getTime();
        resultobj.process(jobinfo, true);  
        return true;
    }
    jobinfo.results.diag = jobinfo.results.diag || {port:{}};
    var tryIpv6 =  function() {
        jobinfo.dnsresolutionstart = new Date().getTime();
        dns.resolve6(jobinfo.parameters.target, function (err, addresses) {
            jobinfo.dnsresolutionend = new Date().getTime();
            jobinfo.results.diag.dnsresolutionruntime = jobinfo.dnsresolutionend - jobinfo.dnsresolutionstart;
            if (err) {
                jobinfo.results.success = false;
                jobinfo.results.end = new Date().getTime();jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.message = 'Error resolving '+jobinfo.parameters.target;
                if (err.code === 'ENODATA') {
                    jobinfo.results.message = 'No addresses found for '+jobinfo.parameters.target;
                } else if (err.code === 'ENOTFOUND') {
                    jobinfo.results.message = 'No DNS resolution for '+jobinfo.parameters.target;
                }
                resultobj.process(jobinfo);
            } else if(addresses && addresses[0]) {
                jobinfo.targetip = addresses[0];
                return check(jobinfo, true);
            } else { // no resolution - empty array returned.
                jobinfo.results.success = false;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.message = 'No DNS addresses found for '+jobinfo.parameters.target;
                resultobj.process(jobinfo);
            }
            return true;
        });
        return true;
    };
    if (!jobinfo.targetip) {
        if (jobinfo.parameters.ipv6) {
            if (!net.isIPv6(jobinfo.parameters.target)) {
                return tryIpv6();
            } else {
                jobinfo.targetip = jobinfo.parameters.target;
            }
        } else {
            // Resolve the ipv4
            if (!net.isIPv4(jobinfo.parameters.target) && !net.isIPv6(jobinfo.parameters.target)) {
                jobinfo.dnsresolutionstart = new Date().getTime();
                dns.resolve4(jobinfo.parameters.target, function (err, addresses) {
                    jobinfo.dnsresolutionend = new Date().getTime();
                    jobinfo.results.diag.dnsresolutionruntime = jobinfo.dnsresolutionend - jobinfo.dnsresolutionstart;
                    if (err) {
                        //logger.log('info','check_port: resolution error: '+sys.inspect(err));
                        //logger.log('info','check_port: resolution addresses: '+sys.inspect(addresses));
                        if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
                            return tryIpv6();
                        }
                        jobinfo.results.success = false;
                        jobinfo.results.end = new Date().getTime();
                        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                        jobinfo.results.statusCode = 'Error';
                        jobinfo.results.message = 'Error resolving the hostname: '+jobinfo.parameters.target;
                        resultobj.process(jobinfo);
                    } else if (addresses && addresses.length && addresses[0]) {
                        //logger.log('info','check_port: resolution addresses: '+sys.inspect(addresses));
                        if (addresses[0]) {
                            jobinfo.targetip = addresses[0];
                            return check(jobinfo, true);
                        }
                    } else { // no ipv4 resolution - empty array returned.
                        return tryIpv6();
                    }
                    return true;
                });
                return true;
            } else {
                jobinfo.targetip = jobinfo.parameters.target;
            }
        }
    }
    jobinfo.results.diag.dnsresolvedip = jobinfo.targetip;

    var finishedIt = false;
    var timeoutid = false;

    // create the TCP stream to the server
    try{
        var stream = net.createConnection(jobinfo.parameters.port, jobinfo.targetip);
        // listen for connection
        stream.on('connect', function() {
            // connection success
            if (finishedIt) { // already got a timeout or some other error.  Connect doesn't count.
                return false;
            }
            finishedIt = true;
            if (timeoutid) clearTimeout(timeoutid);
            if (stream && stream.remoteAddress) {
                jobinfo.results.diag.port.serverip = stream.remoteAddress;
            }
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Connected';
            jobinfo.results.message = 'Resolved: '+jobinfo.targetip;
            if (jobinfo.parameters.invert) {
                jobinfo.results.success = false;
            } else {
                jobinfo.results.success = true;
            }
            //logger.log('info',"check_port:connected");
            if (jobinfo.results.runtime > timeout) {
                jobinfo.results.success = false;
                jobinfo.results.statusCode = 'timeout';
                jobinfo.results.message = 'Timeout';
            }
            stream.destroy(); // close the stream
            resultobj.process(jobinfo);
            return true;
        });
        // listen for any errors
        stream.on('error', function(error) {
            //logger.log('error',"check_port: Error: "+error);
            if (finishedIt) { // already got a connect or a timeout.
                return false;
            }
            finishedIt = true;
            if (timeoutid) clearTimeout(timeoutid);
            jobinfo.results.diag.port.error = error.toString();
            if (error.address) {
                jobinfo.results.diag.port.serverip = error.address;
            }
            if (error.port) {
                jobinfo.results.diag.port.port = error.port;
            }
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = 'Error: '+error.toString();
            if (jobinfo.parameters.invert) {
                jobinfo.results.success = true;
            } else {
                jobinfo.results.success = false;
            }
            stream.destroy(); // close the stream
            resultobj.process(jobinfo);
            return true;
        });
        stream.on('timeout', function(error) {
            //logger.log('error',"check_port: timeout");
            if (finishedIt) { // already got a connect or some other error.  timeout doesn't count.
                return false;
            }
            finishedIt = true;
            if (timeoutid) clearTimeout(timeoutid);
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'timeout';
            jobinfo.results.message = 'Timeout';
            if (jobinfo.parameters.invert) {
                jobinfo.results.success = true;
            } else {
                jobinfo.results.success = false;
            }
            stream.destroy(); // close the stream
            resultobj.process(jobinfo);
            return true;
        });
        stream.setTimeout(timeout);
    } catch(error) {
        //logger.log('error',"check_port: "+error.toString());
        if (finishedIt) { // already got a timeout or connect or some other error.  caught error doesn't count.
            return false;
        }
        finishedIt = true;
        if (timeoutid) clearTimeout(timeoutid);
        jobinfo.results.end = new Date().getTime();
        if (jobinfo.parameters.invert) {
            jobinfo.results.success = true;
        } else {
            jobinfo.results.success = false;
        }
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = error.toString();
        resultobj.process(jobinfo);
        return true;
    }

    timeoutid = setTimeout(function() {
        if (finishedIt) {
            return true;
        }
        finishedIt = true;
        debugMessage('error',"check_port: setTimeout called: "+timeout.toString()+' for check '+jobinfo._id);
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.statusCode = 'Timeout';
        jobinfo.results.success = false;
        jobinfo.results.message = 'Timeout';
        resultobj.process(jobinfo);
        if (stream) stream.destroy();
        return true;
    }, timeout + 2000);
    return true;
};