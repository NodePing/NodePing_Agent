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
    if(!jobinfo.parameters.target){
        debugMessage('info',"check_sip: Invalid host or IP");
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid host or IP address';
        resultobj.process(jobinfo, true);
        return true;
    }else{
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
                if(typeof sip.stop === 'function'){
                    sip.stop();
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
        try{
            var myport = getRandomPortNumber();
            debugMessage('info',"check_sip: Starting server on "+sys.inspect(myport));
            sip.start({port:myport}, function(rq) {});
            sip.send({method: 'OPTIONS',
                      uri:'sip:999@'+jobinfo.parameters.target,
                      headers: {to: {uri:'sip:999@sip.nodeping.com'},
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
                    if(rs.status){
                        jobinfo.results.statusCode = rs.status;
                    }
                    resultobj.process(jobinfo);
                    if(typeof sip.stop === 'function'){
                        sip.stop();
                    }
                    sip = null;
                    return true;
                }
            );
        }catch(error){
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
    function debugMessage(messageType, message){
        if(jobinfo.debug || config.debug){
            logger.log(messageType,message);
        }
    }

    function rstring() { return Math.floor(Math.random()*1e6).toString(); }

    function getRandomPortNumber () {
        return Math.floor(Math.random() * (5019)) + 1501;
    }
    return true;
};
