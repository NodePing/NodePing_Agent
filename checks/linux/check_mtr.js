/*!
 * NodePing
 * Copyright(c) 2022 NodePing LLC
 */

/*!
 * check_mtr.js
 * Packet loss check.
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're logging debug messages
    timeout:32000
};

var resultobj = require('../results.js');
var sys = require('util');
var mtrext = require('mtrext').MtrExt;
var dns = require('dns');
var net = require('net');

var logger = console;

var check = function(jobinfo, retry, cb) {
    debugMessage('info',"Jobinfo passed to mtr check: "+sys.inspect(jobinfo));
    var timeout = config.timeout;
    var tryIpv6 =  function() {
        jobinfo.dnsresolutionstart = new Date().getTime();
        dns.resolve6(jobinfo.parameters.target, function (err, addresses) {
            jobinfo.dnsresolutionend = new Date().getTime();
            if (err) {
                jobinfo.results.success = false;
                jobinfo.results.end = new Date().getTime();jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = 100;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.message = 'Error resolving '+jobinfo.parameters.target;
                if (err.code === 'ENODATA') {
                    jobinfo.results.message = 'No addresses found for '+jobinfo.parameters.target;
                } else if (err.code === 'ENOTFOUND') {
                    jobinfo.results.message = 'No DNS resolution for '+jobinfo.parameters.target;
                }
                resultobj.process(jobinfo);
            } else if (addresses && addresses[0]) {
                jobinfo.targetip = addresses[0];
                return check(jobinfo, false, cb);
            } else { // no resolution - empty array returned.
                jobinfo.results.success = false;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = 100;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.message = 'No DNS addresses found for '+jobinfo.parameters.target;
                resultobj.process(jobinfo);
            }
            return true;
        });
        return true;
    };

    jobinfo.results = {start:new Date().getTime()};
    
    if (!jobinfo.parameters.target) {
        debugMessage('info',"check_mtr: Invalid target");
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid target';
        processresults(jobinfo,true, cb);
        return true;
    }

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
                    if (err) {
                        debugMessage('info','check_mtr: resolution error: '+sys.inspect(err));
                        debugMessage('info','check_mtr: resolution addresses: '+sys.inspect(addresses));
                        if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
                            return tryIpv6();
                        }
                        jobinfo.results.success = false;
                        jobinfo.results.end = new Date().getTime();
                        jobinfo.results.runtime = 100;
                        jobinfo.results.statusCode = 'Error';
                        jobinfo.results.message = 'Error resolving the hostname: '+jobinfo.parameters.target;
                        resultobj.process(jobinfo);
                    } else if (addresses && addresses.length && addresses[0]) {
                        debugMessage('info','check_mtr: resolution addresses: '+sys.inspect(addresses));
                        if (addresses[0]) {
                            jobinfo.targetip = addresses[0];
                            return check(jobinfo, false, cb);
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

    debugMessage('info',"check_mtr: "+jobinfo.parameters.target+' resolved to '+jobinfo.targetip);

    jobinfo.results.diag = {"mtr":{resolvedip:jobinfo.targetip}};

    if (jobinfo.dnsresolutionstart && jobinfo.dnsresolutionend) {
        jobinfo.results.diag.mtr.dnsresolutiontime = jobinfo.dnsresolutionend - jobinfo.dnsresolutionstart;
    }

    var mtr = new mtrext(jobinfo.targetip, { resolveDns: false, packetLen: 60 });
    mtr.on('end', function(results) {
        debugMessage('info','results: '+sys.inspect(results,{depth:16}));
        if (!killit) {
            killit = true;
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = 100;
            if (results && results.results && results.results.raw) {
                jobinfo.results.diag.mtr.data = results.results.raw;
            }
            jobinfo.results.success = true;
            jobinfo.results.message = jobinfo.targetip;
            var foundhop = false;
            if (results && results.results && results.results.hops && results.results.hops.length) {
                for (var i in results.results.hops) {
                    if (results.results.hops[i] && results.results.hops[i].hopAddress && results.results.hops[i].hopAddress === jobinfo.targetip) {
                        foundhop = true;
                        jobinfo.results.runtime = Math.trunc(results.results.hops[i].loss);
                        jobinfo.results.statusCode = "Packet loss:"+ jobinfo.results.runtime+"%";
                        if (jobinfo.results.runtime > jobinfo.parameters.threshold) {
                            jobinfo.results.success = false;
                            jobinfo.results.message = 'Packet loss '+jobinfo.results.runtime+'% greater than configured threshold of '+jobinfo.parameters.threshold+"%";
                        }
                        jobinfo.results.fieldtracking = {"best":results.results.hops[i].best,
                                                         "avg":results.results.hops[i].avg,
                                                         "wrst":results.results.hops[i].wrst,
                                                         "jttr":results.results.hops[i].jttr,
                                                         "javg":results.results.hops[i].javg,
                                                         "jmax":results.results.hops[i].jmax,
                                                         "jint":results.results.hops[i].jint,
                                                         "loss":results.results.hops[i].loss
                                                        };
                    }
                }
            }
            if (!foundhop) {
                jobinfo.results.statusCode = "Unreachable: 100%";
                jobinfo.results.success = false;
                jobinfo.results.message = 'Unable to reach host at '+jobinfo.targetip;
            }
            resultobj.process(jobinfo,false);
            return true;
        }
        return true;
    });
    mtr.on('error', function(err) {
        debugMessage('error','error event: '+sys.inspect(err));
        if (!killit) {
            killit = true;
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = 100;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.diag.mtr.data = err.toString();
            jobinfo.results.success = false;
            jobinfo.results.message = 'error';
            processresults(jobinfo,false);
            if (mtr) {
                mtr = null;
            }
        }
        return true;
    });
    var killit = false;
    var timeoutid = setTimeout(function() {
        if (killit) {
            return true;
        }
        killit = true;
        if (mtr) {
            mtr = null;
        }
        debugMessage('info',"check_mtr: setTimeout called.");
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = 100;
        jobinfo.results.statusCode = 'Timeout';
        jobinfo.results.success = false;
        jobinfo.results.message = 'setTimeout';
        processresults(jobinfo,false,cb);
        return true;
    }, timeout);

    mtr.traceroute();

    function debugMessage (messageType, message) {
        if (jobinfo.debug || config.debug) {
            logger.log(messageType,message);
        }
    }
    return true;
};

exports.check = check;