/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_rdp.js
 * Basic RDP check
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
    //logger.log('info',"Jobinfo passed to ping check: "+sys.inspect(jobinfo));
    var timeout =  config.timeout *1;
    if(jobinfo.parameters.threshold) timeout = parseInt(jobinfo.parameters.threshold)*1000;
    if (timeout > 90000) timeout = 90000;
    jobinfo.results = {start:new Date().getTime()};
    if(!jobinfo.parameters.target){
        //logger.log('info',"check_rdp: Invalid target");
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing a target';
        resultobj.process(jobinfo, true);
        return true;
    }else{
        // create the TCP stream to the server
        try{
            var stream = net.createConnection(3389, jobinfo.parameters.target);
            // listen for connection
            stream.on('connect', function() {
                // connection success
                //logger.log('info',"check_rdp:connected");
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.statusCode = 'Connected';
                jobinfo.results.success = true;
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
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
                //logger.log('error',"check_rdp: Error: "+error);
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.statusCode = 'error';
                jobinfo.results.success = false;
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.message = 'Error: '+error;
                stream.destroy(); // close the stream
                resultobj.process(jobinfo);
                return true;
            });
            stream.on('timeout', function(error) {
                //logger.log('error',"check_rdp: timeout");
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.statusCode = 'timeout';
                jobinfo.results.success = false;
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.message = 'Timeout';
                stream.destroy(); // close the stream
                resultobj.process(jobinfo);
                return true;
            });
            stream.setTimeout(timeout);
        }catch(error){
            //logger.log('error',"check_rdp: "+error.toString());
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = error.toString();
            resultobj.process(jobinfo);
            return true;
        }
    }
    return true;
}