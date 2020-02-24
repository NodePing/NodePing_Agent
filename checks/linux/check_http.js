/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_http.js
 * Basic http check.  Looks at the response header only.  Use check_http_content for content checking.
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
var url = require('url');
var dns = require('dns');
var net = require('net');

var check = function(jobinfo){
    //logger.log('info',"check_http: Jobinfo passed to http check: "+sys.inspect(jobinfo));
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
    jobinfo.results = {start:new Date().getTime()};
    if (jobinfo.redirectstart) {
        // Set start from before the redirect
        jobinfo.results.start =  jobinfo.redirectstart;
    }
    if(!jobinfo.parameters.target){
        //logger.log('info',"check_http: Invalid URL");
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing URL';
        resultobj.process(jobinfo, true);
        return true;
    }else{
        var thetarget = jobinfo.redirecttarget || jobinfo.parameters.target;
        try{
            var targetinfo = url.parse(thetarget);
        }catch(error){
            //logger.log('info',"check_http: Invalid URL");
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = 'Invalid URL: '+error;
            resultobj.process(jobinfo, true);
            return true;
        }
        if (jobinfo.parameters.ipv6 && targetinfo.hostname){
            if (!jobinfo.targetip) {
                if (net.isIPv6(targetinfo.hostname)) {
                    // No problem, already an IPv6
                } else {
                    dns.resolve6(targetinfo.hostname, function (err, addresses) {
                        if (err) {
                            jobinfo.results.success = false;
                            jobinfo.results.end = new Date().getTime();
                            jobinfo.results.statusCode = 'Error';
                            jobinfo.results.message = 'Error resolving IPv6 for '+targetinfo.hostname;
                            if (err.code === 'ENODATA') {
                                jobinfo.results.message = 'No IPv6 addresses found for '+targetinfo.hostname;
                            } else if (err.code === 'ENOTFOUND') {
                                jobinfo.results.message = 'No resolution for '+targetinfo.hostname;
                            }
                            resultobj.process(jobinfo);
                        } else if(addresses && addresses[0]) {
                            jobinfo.targetip = addresses[0];
                            return check(jobinfo);
                        } else { // no resolution - empty array returned.
                            jobinfo.results.success = false;
                            jobinfo.results.end = new Date().getTime();
                            jobinfo.results.statusCode = 'Error';
                            jobinfo.results.message = 'No IPv6 addresses found for '+targetinfo.hostname;
                            resultobj.process(jobinfo);
                        }
                        return true;
                    });
                }
                return true;
            } else {
                // We've already resolved this ip.
                targetinfo.hostname = jobinfo.targetip;
            }
        }
		var agent;
        if(targetinfo.protocol){
            if(targetinfo.protocol == 'http:'){
                agent = require('http');
                //logger.log('info',"check_http: Using http");
            }else if (targetinfo.protocol == 'https:'){
                agent = require('https');
                //logger.log('info',"check_http: Using https");
            }else{
                //logger.log('info',"check_httpcontent: Invalid protocol: "+targetinfo.protocol);
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.success = false;
                jobinfo.results.statusCode = 'error';
                jobinfo.results.message = 'Invalid protocol';
                resultobj.process(jobinfo, true);
                return true;
            }
        } else {
			jobinfo.results.end = new Date().getTime();
			jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
			jobinfo.results.success = false;
			jobinfo.results.statusCode = 'error';
			jobinfo.results.message = 'Invalid or missing protocol for HTTP';
			resultobj.process(jobinfo, true);
			return true;
		}
        var httpheaders = {'Accept': '*/*',
                           'User-Agent': 'NodePing',
                           'Host': targetinfo.host};
        // Auth
        if(targetinfo.auth){
            httpheaders.Authorization = 'Basic ' + new Buffer(targetinfo.auth).toString('base64');
        }
        var targetoptions = {host:targetinfo.hostname,
                             method:'GET',
                             headers: httpheaders,
                             rejectUnauthorized: false};
        if(targetinfo.port){
            targetoptions.port = targetinfo.port;
        }
		if(targetinfo.pathname){
            if(targetinfo.search){
                targetoptions.path = targetinfo.pathname+targetinfo.search;
            }else{
                targetoptions.path = targetinfo.pathname;
            }
        }
        targetinfo.agent = false;
        debugMessage('info','check_http: Targetoptions is: '+sys.inspect(targetoptions));
        //logger.log('info',"check_http: Url for job "+jobinfo._id+" is "+jobinfo.parameters.target);
        var completed = false;
        try{
            var req = agent.request(targetoptions, function(res){
                res.setEncoding('utf8');
                res.connection.on('error', function (err) {
                    debugMessage('error','http check error for '+jobinfo.jobid+': '+sys.inspect(err));
                });
            });
            //debugMessage('info','http check request '+jobinfo.jobid+': '+sys.inspect(req));
            var timeoutid = setTimeout(function() {
                if(!completed){
                    completed = true;
                    //logger.log('info',"check_http: setTimeout called.");
                    debugMessage('info','http check settimeout triggered for '+jobinfo.jobid);
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Timeout';
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'Timeout';
                    resultobj.process(jobinfo);
                }
                if(req)req.abort();
                return true;
            }, timeout);
            req.on("response", function(d){
                if(!completed){
                    clearTimeout(timeoutid);
                    completed = true;
                    //debugMessage('info','http check response triggered for '+jobinfo.jobid+': '+sys.inspect(req.res));
                    //logger.log('info',"check_http: Req is "+sys.inspect(req));
                    //logger.log('info',"check_http: Status Code is "+sys.inspect(req.res.statusCode));
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = req.res.statusCode;
                    jobinfo.results.diag = {"http":{
                                                requestheaders:targetoptions.headers,
                                            	responseheaders:req.res.headers,
                                            	httpstatus:req.res.statusCode,
                                                httpserverip:req.connection.remoteAddress}
                                           };
                    if(jobinfo.parameters.follow && req.res.statusCode >=300 && req.res.statusCode < 399){
                        // Have we redirected too many times already?
                        if (jobinfo.redirectcount && jobinfo.redirectcount > 4) {
                            // Too many redirects.
                            jobinfo.results.success = false;
                            jobinfo.results.message = 'Too many redirects';
                            jobinfo.results.statusCode = req.res.statusCode;
                        } else {
                            if (!jobinfo.redirectcount){
                                jobinfo.redirectcount = 1;
                            } else {
                                jobinfo.redirectcount = jobinfo.redirectcount + 1;
                            }
                            // Set the new redirecttarget and try again.
                            debugMessage('info',"check_http: redirect header says "+sys.inspect(req.res.headers.location));
                            var redirect = req.res.headers.location;
                            if (redirect.indexOf('https:') === 0 || redirect.indexOf('http:') === 0 || redirect.indexOf('HTTP:') === 0 || redirect.indexOf('HTTPS:') === 0) {
                                // Absolute redirect.
                            } else {
                                // relative redirect - need to get the right base url (either parameters.target or a previous redirect target)
                                thetarget = jobinfo.redirecttarget || jobinfo.parameters.target;
                                targetinfo = url.parse(thetarget);
                                if (redirect.indexOf('/') === 0) {
                                    // Replace the whole pathname
                                    var toreplace = targetinfo.pathname;
                                    if (targetinfo.search){
                                        toreplace = toreplace + targetinfo.search;
                                    }
                                    debugMessage('info',"check_http: Going to replace: "+sys.inspect(toreplace)+" with "+sys.inspect(redirect));
                                    var pos = targetinfo.href.lastIndexOf(toreplace);
                                    if (pos > 7) {
                                        redirect = targetinfo.href.substring(0, pos) + redirect;
                                    } else {
                                        logger.log('error',"check_http: Weird placement for the last instance of: "+sys.inspect(toreplace)+" in "+sys.inspect(redirect)+' for check '+jobinfo.jobid);
                                    }
                                } else {
                                    // tack this redirect on the end of the current path - removing the search, if any.
                                    if (targetinfo.pathname.slice(-1) !== '/'){
                                        // strip off the last filename if any.
                                        var pos = targetinfo.href.lastIndexOf('/');
                                        if (pos > 7) {
                                            targetinfo.href = targetinfo.href.substring(0, pos);
                                        }
                                        redirect = '/'+redirect;
                                    }
                                    if (targetinfo.search) {
                                        targetinfo.href = targetinfo.href.replace(targetinfo.search,'');
                                    }
                                    redirect = targetinfo.href+redirect;
                                }
                            }
                            jobinfo.redirecttarget = redirect;
                            jobinfo.redirectstart = jobinfo.results.start; 
                            req.abort();
                            return check(jobinfo);
                        }
                    } else if(req.res.statusCode >=200 && req.res.statusCode < 399){
                        // Did it take too long?
                        if(defaulttimeout < jobinfo.results.runtime){
                            jobinfo.results.success = false;
                            jobinfo.results.message = 'Timeout';
                            jobinfo.results.statusCode = 'Timeout';
                            
                        }else{
                            jobinfo.results.success = true;
                            jobinfo.results.message = 'Success';
                        }
                    }else{
                        jobinfo.results.success = false;
                        jobinfo.results.message = 'HTTP status returned: '+req.res.statusCode;
                    }
                    resultobj.process(jobinfo);
                }    
                req.abort();
                return true;
            }).on("error", function(e){
                clearTimeout(timeoutid);
                if(!completed){
                    completed = true;
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Error';
                    jobinfo.results.success = false;
                    jobinfo.results.message = e.toString();
                    resultobj.process(jobinfo);
                }
                return true;
            }).on("timeout", function(to){
                clearTimeout(timeoutid);
                if(!completed){
                    completed = true;
                    //logger.log('info',"check_http: Caught timeout");
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Timeout';
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'Timeout';
                    resultobj.process(jobinfo);
                }
                req.abort();
                return true;
            });
            req.on("socket", function (socket) {
                jobinfo.results = {start:new Date().getTime()};
                socket.emit("agentRemove");
            });
            req.end();
        }catch(ec){
            clearTimeout(timeoutid);
            if(!completed){
                if(req)req.abort();
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.success = false;
                jobinfo.results.message = "Caught "+ec.toString();
                resultobj.process(jobinfo);
                completed = true;
            }
            return true;
        }
    }
    return true;
};

exports.check = check;