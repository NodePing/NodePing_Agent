/*!
 * NodePing
 * Copyright(c) 2024 NodePing LLC
 */

/*!
 * check_s10dns.js
 * s10dns checks can't run on an AGENT
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout:10000              // Can be overriden by a parameter
};

var resultobj = require('../results.js');
var logger = console;

var check = exports.check = function(jobinfo){
    logger.log('error',"check_agent: S10DNS checks can not run on an AGENT");
    jobinfo.results = {start: new Date().getTime()};
    jobinfo.results.end = new Date().getTime();
    jobinfo.results.runtime = 0;
    jobinfo.results.success = false;
    jobinfo.results.statusCode = 'error';
    jobinfo.results.message = 'S10DNS checks cannot be run on an AGENT';
    resultobj.process(jobinfo, true);
    return true;
};