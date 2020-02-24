/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_ntp.js
 * NTP check
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
var ntpClient = require('ntp-client');

var logger = console;

exports.check = function(jobinfo){
    //logger.log('info',"Jobinfo passed to ntp check: "+sys.inspect(jobinfo));
    var timeout =  config.timeout *1;
    if(jobinfo.parameters.threshold) timeout = parseInt(jobinfo.parameters.threshold)*1000;
    if (timeout > 90000) timeout = 90000;
    jobinfo.results = {start:new Date().getTime()};
    if(!jobinfo.parameters.target){
        //logger.log('info',"check_ntp: Missing target");
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing target';
        jobinfo.results.end = new Date().getTime();
        resultobj.process(jobinfo, true);
        return true;
    }
    var port = jobinfo.parameters.port || 123
    var completed = false;
    
    var debugMessage = function (messageType, message){
        if(jobinfo.debug || config.debug){
            logger.log(messageType,message);
        }
    };
    
    var timeoutid = setTimeout(function() {
        if(!completed){
            completed = true;
            //logger.log('info',"check_ntp: setTimeout called.");
            debugMessage('info','ntp check settimeout triggered for '+jobinfo.jobid);
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Timeout';
            jobinfo.results.message = 'Timeout';
            if(jobinfo.parameters.invert){
                jobinfo.results.success = true;
            }else{
                jobinfo.results.success = false;
            }
            resultobj.process(jobinfo);
        }
        return true;
    }, timeout);
 
    ntpClient.getNetworkTime(jobinfo.parameters.target, port, function(err, date) {
        if(!completed){
            completed = true;
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            if(jobinfo.results.runtime > timeout){
                if(jobinfo.parameters.invert){
                    jobinfo.results.success = true;
                }else{
                    jobinfo.results.success = false;
                }
                jobinfo.results.statusCode = 'timeout';
                jobinfo.results.message = 'Timeout';
            } else if (err) {
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.message = sys.inspect(err);
                if(jobinfo.parameters.invert){
                    jobinfo.results.success = true;
                }else{
                    jobinfo.results.success = false;
                }
            } else {
                jobinfo.results.statusCode = 'Received';
                jobinfo.results.message = sys.inspect(date);
                if(jobinfo.parameters.invert){
                    jobinfo.results.success = false;
                }else{
                    jobinfo.results.success = true;
                }
            }
            resultobj.process(jobinfo);
            return true;
        } else {
            // Already timed out and reported error
            return false;
        }
    });
    return true;
};