/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_sip.js
 * SIP connection test.
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout: 10000              // Can be overriden by a parameter
};

var resultobj = require('../results.js');
var sys = require('util');
var logger = console;

exports.check = function(jobinfo){
    var defaulttimeout = config.timeout * 1;
    var timeout = config.timeout * 1;
    if(jobinfo.parameters.threshold){
        defaulttimeout = 1000 * parseInt(jobinfo.parameters.threshold);
        if (defaulttimeout > 90000) defaulttimeout = 90000;
        timeout = defaulttimeout + 2000;
    }
    debugMessage('info',"check_sip: Jobinfo passed to sip check: "+sys.inspect(jobinfo));
    jobinfo.results = {start:new Date().getTime()};
    if (!jobinfo.parameters.target) {
        debugMessage('info',"check_sip: Invalid host or IP");
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid host or IP address';
        resultobj.process(jobinfo, true);
        return true;
    } else {
        delete require.cache[require.resolve('sip')];  // Clear the require cache so we aren't talking over each other.
        var sip = require('sip');
        var killit = false;
        var timeoutid = setTimeout(function() {
            debugMessage('info',"check_sip: setTimeout called: "+timeout.toString());
            if(killit){
                return true;
            }
            killit = true;
            if(sip){
                debugMessage('info',"check_sip: setTimeout stopping sip server");
                if(sip && typeof sip.destroy === 'function'){
                    sip.destroy();
                }
                sip = null;
            }
            debugMessage('info',"check_sip: setTimeout triggered: "+timeout.toString());
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Timeout';
            jobinfo.results.success = false;
            jobinfo.results.message = 'Timeout';
            resultobj.process(jobinfo);
            return true;
        }, timeout);
        try {
            var myport = getRandomPortNumber();
            var startoptions = {port:myport};
            var schema = 'sip';
            var transport;
            if (jobinfo.parameters.transport) {
                if (jobinfo.parameters.transport === 'udp') {
                    startoptions.udp = true;
                    startoptions.tcp = false;
                    startoptions.tls = false;
                    startoptions.ws = false;
                    transport = 'udp';
                } else if (jobinfo.parameters.transport === 'tcp') {
                    startoptions.tcp = true;
                    startoptions.udp = false;
                    startoptions.tls = false;
                    startoptions.ws = false;
                    transport = 'tcp';
                } else if (jobinfo.parameters.transport === 'tls') {
                    startoptions.tcp = false;
                    startoptions.udp = false;
                    startoptions.ws = false;
                    schema = 'sips';
                    transport = 'tls';
                    var uribits = sip.parseUri('sips:999@'+jobinfo.parameters.target);
                    startoptions.tls = {servername:uribits.host};
                } else if (jobinfo.parameters.transport === 'ws' || jobinfo.parameters.transport === 'wss') {
                    killit = true;
                    debugMessage('info',"check_sip: Unsupported transport: "+timeout.toString());
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Error';
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'Unsupported transport for SIP on AGENT. Please contact support for solution.';
                    resultobj.process(jobinfo);
                    return true;
                }
            }
            debugMessage('info',"check_sip: Starting service with options: "+sys.inspect(startoptions));
            sip.start(startoptions, function(rq) {});
            sip.send({method: 'OPTIONS',
                      uri: schema+':999@'+jobinfo.parameters.target+( (transport) ? ';transport='+transport : '' ),
                        headers: {to: {uri: schema+':999@'+jobinfo.parameters.target, transport: transport || null},
                                from:{uri:'sip:777@sip.nodeping.com', params: {tag: rstring()}},
                                'call-id': rstring(),
                                cseq: {method: 'OPTIONS', seq: Math.floor(Math.random() * 1e5)}
                      }
                     },function(rs) {
                    // Reply from the sip call
                    debugMessage('info',"check_sip: reply: "+sys.inspect(rs));
                    if(killit){
                        return true;
                    }
                    killit = true;
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Connected';
                    jobinfo.results.success = true;
                    jobinfo.results.message = 'Response: '+sys.inspect(rs);
                    if (rs.status) {
                        jobinfo.results.statusCode = rs.status;
                        jobinfo.results.message = rs.status.toString();
                        if (rs.status > 499) {
                            jobinfo.results.success = false;
                            jobinfo.results.message = 'Unknown error';
                        }
                    }
                    if (rs.error) {
                        jobinfo.results.statusCode = (rs.status) ? rs.status : 'Error';
                        jobinfo.results.success = false;
                        jobinfo.results.message = rs.error;
                        if (rs.error.indexOf('[ERR_TLS_CERT_ALTNAME_INVALID]') > -1) {
                            jobinfo.results.message = rs.error.replace('[ERR_TLS_CERT_ALTNAME_INVALID]','');
                        }
                    }
                    resultobj.process(jobinfo);
                    if(sip && typeof sip.destroy === 'function'){
                        sip.destroy();
                    }
                    sip = null;
                    return true;
                }
            );
        } catch(error) {
            if (killit) {
                return true;
            }
            killit = true;
            if (timeoutid) clearTimeout(timeoutid);
            debugMessage('info',"check_sip: error caught: "+sys.inspect(error));
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = 'Error caught: '+sys.inspect(error);
            resultobj.process(jobinfo);
            return true;
        }
    }

    function debugMessage(messageType, message) {
        if (jobinfo.debug || config.debug) {
            logger.log(messageType,message);
        }
    }

    function rstring() { return Math.floor(Math.random()*1e6).toString(); }

    function getRandomPortNumber () {
        return Math.floor(Math.random() * (5019)) + 1501;
    }
    return true;
};