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
    if(jobinfo.parameters.threshold) timeout = parseInt(jobinfo.parameters.threshold)*1000;
    if (timeout > 90000) timeout = 90000;
    jobinfo.results = {start:new Date().getTime()};
    if(!jobinfo.parameters.target){
        //logger.log('info',"check_port: Missing target");
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing target';
        jobinfo.results.end = new Date().getTime();
        resultobj.process(jobinfo, true);
        return true;
    }else if(!jobinfo.parameters.port){
        //logger.log('info',"check_port: Missing port");
        jobinfo.results.success = false;   
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing port';
        jobinfo.results.end = new Date().getTime();
        resultobj.process(jobinfo, true);  
        return true;
    }else{
        // create the TCP stream to the server
        try{
            var stream = net.createConnection(jobinfo.parameters.port, jobinfo.parameters.target);
            // listen for connection
            stream.on('connect', function() {
                // connection success
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Connected';
                jobinfo.results.message = 'Connected';
                if(jobinfo.parameters.invert){
                    jobinfo.results.success = false;
                }else{
                    jobinfo.results.success = true;
                }
                //logger.log('info',"check_port:connected");
                if(jobinfo.results.runtime > timeout){
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
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'error';
                jobinfo.results.message = 'Error: '+error;
                if(jobinfo.parameters.invert){
                    jobinfo.results.success = true;
                }else{
                    jobinfo.results.success = false;
                }
                stream.destroy(); // close the stream
                resultobj.process(jobinfo);
                return true;
            });
            stream.on('timeout', function(error) {
                //logger.log('error',"check_port: timeout");
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'timeout';
                jobinfo.results.message = 'Timeout';
                if(jobinfo.parameters.invert){
                    jobinfo.results.success = true;
                }else{
                    jobinfo.results.success = false;
                }
                stream.destroy(); // close the stream
                resultobj.process(jobinfo);
                return true;
            });
            stream.setTimeout(timeout);
        }catch(error){
            //logger.log('error',"check_port: "+error.toString());
            jobinfo.results.end = new Date().getTime();
            if(jobinfo.parameters.invert){
                jobinfo.results.success = true;
            }else{
                jobinfo.results.success = false;
            }
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = error.toString();
            resultobj.process(jobinfo);
            return true;
        }
    }
    return true;
};