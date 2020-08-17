/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
*/

/*!
 * check_httpparse.js
 * http parse check.  Looks at the string returned - parse for json or just look for the field.
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout:10000              // Can be overriden by a parameter
};

var flat = require('flat').flatten;
var resultobj = require('../results.js');
var sys = require('util');
var nputil = require('../../nputil');
var dns = require('dns');
var net = require('net');
var logger = console;

var check = function(jobinfo, retry){
    var defaulttimeout = config.timeout * 1;
    var timeout = config.timeout * 1;
    if (jobinfo.parameters.threshold) {
        defaulttimeout = 1000 * parseInt(jobinfo.parameters.threshold);
        if (defaulttimeout > 90000) defaulttimeout = 90000;
        timeout = defaulttimeout + 1000;
    }
    debugMessage('info',"check_httpparse: Jobinfo passed: "+sys.inspect(jobinfo));
    if (!retry && jobinfo.targetip) {
        delete jobinfo.targetip;
    }
    jobinfo.results = {start:new Date().getTime()};
    if (!jobinfo.parameters.fields || jobinfo.parameters.fields == '') {
        debugMessage('info',"check_httpparse: missing fields");
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing fields to parse';
        resultobj.process(jobinfo, true);
        return true;
    }
    if (!jobinfo.parameters.target) {
        debugMessage('info',"check_httpparse: Invalid URL");
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid URL';
        resultobj.process(jobinfo, true);
        return true;
    } else {
        try {
            var targetinfo = require('url').parse(jobinfo.parameters.target);
        } catch(error) {
            debugMessage('info',"check_httpparse: Invalid URL");
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = 'URL will not parse: '+error;
            resultobj.process(jobinfo, true);
            return true;
        }
        if (targetinfo.protocol) {
            if (targetinfo.protocol == 'http:') {
                var agent = require('http');
            } else if (targetinfo.protocol == 'https:') {
                var agent = require('https');
            } else {
                debugMessage('info',"check_httpparse: Invalid protocol: "+targetinfo.protocol);
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
			jobinfo.results.message = 'Invalid URL';
			resultobj.process(jobinfo, true);
			return true;
		}
        var tryIpv6 =  function(){
            jobinfo.dnsresolutionstart = new Date().getTime();
            dns.resolve6(targetinfo.hostname, function (err, addresses) {
                jobinfo.dnsresolutionend = new Date().getTime();
                if (err) {
                    jobinfo.results.success = false;
                    jobinfo.results.end = new Date().getTime();jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Error';
                    jobinfo.results.message = 'Error resolving '+targetinfo.hostname;
                    if (err.code === 'ENODATA') {
                        jobinfo.results.message = 'No addresses found for '+targetinfo.hostname;
                    } else if (err.code === 'ENOTFOUND') {
                        jobinfo.results.message = 'No DNS resolution for '+targetinfo.hostname;
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
                    jobinfo.results.message = 'No DNS addresses found for '+targetinfo.hostname;
                    resultobj.process(jobinfo);
                }
                return true;
            });
            return true;
        };
        if (!jobinfo.targetip) {
            if (jobinfo.parameters.ipv6) {
                if (!net.isIPv6(targetinfo.hostname)) {
                    return tryIpv6();
                }
            } else {
                // Resolve the ipv4
                if (!net.isIPv4(targetinfo.hostname) && !net.isIPv6(targetinfo.hostname)) {
                    jobinfo.dnsresolutionstart = new Date().getTime();
                    dns.resolve4(targetinfo.hostname, function (err, addresses) {
                        jobinfo.dnsresolutionend = new Date().getTime();
                        if (err) {
                            //logger.log('info','check_httpparse: resolution error: '+sys.inspect(err));
                            //logger.log('info','check_httpparse: resolution addresses: '+sys.inspect(addresses));
                            if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
                                return tryIpv6();
                            }
                            jobinfo.results.success = false;
                            jobinfo.results.end = new Date().getTime();
                            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                            jobinfo.results.statusCode = 'Error';
                            jobinfo.results.message = 'Error resolving the hostname: '+targetinfo.hostname;
                            resultobj.process(jobinfo);
                        } else if(addresses && addresses.length && addresses[0]) {
                            //logger.log('info','check_http: resolution addresses: '+sys.inspect(addresses));
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
                }
            }
        } else {
            targetinfo.hostname = jobinfo.targetip;
        }
        var httpheaders = {'Accept': '*/*',
                           'User-Agent': 'NodePing',
                           'Host': targetinfo.host};
        // Auth
        if (targetinfo.auth) {
            httpheaders.Authorization = 'Basic ' + new Buffer(targetinfo.auth).toString('base64');
        }
        var targetoptions = {host:targetinfo.hostname,
                             method:'GET',
                             headers: httpheaders,
                             rejectUnauthorized: false};
        if (targetinfo.port) {
            targetoptions.port = targetinfo.port;
            httpheaders['Host'] = httpheaders['Host']+':'+targetinfo.port;
        }
        if (targetinfo.pathname) {
            if (targetinfo.search) {
                targetoptions.path = targetinfo.pathname+targetinfo.search;
            } else {
                targetoptions.path = targetinfo.pathname;
            }
        }
        targetinfo.agent = false;
        var killit = false;
        try {
            var timeoutid = setTimeout(function() {
                if (killit) {
                    return true;
                }
                killit = true;
                req.abort();
                debugMessage('info',"check_httpparse: setTimeout called: "+timeout.toString());
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Timeout';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Timeout';
                resultobj.process(jobinfo);

                return true;
            }, timeout);
            var req = agent.get(targetoptions, function(res) {
                var body = '';
                //debugMessage('info','check_httpparse: res inside is: '+sys.inspect(res));
                res.setEncoding('utf8');
                res.on('data', function(d) {
                    //debugMessage('info',"check_httpparse: Data inside is "+sys.inspect(d));
                    body += d;
                    if (body.length > 3145728) {// 3MB limit
                        clearTimeout(timeoutid);
                        killit = true;
                        jobinfo.results.end = new Date().getTime();
                        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                        jobinfo.results.statusCode = 413;
                        jobinfo.results.success = false;
                        jobinfo.results.message = '3MB file size exceeded';
                        resultobj.process(jobinfo);
                        req.abort();
                        return true;
                    }
                });
                res.on('end', function(){
                    if (!killit) {
                        clearTimeout(timeoutid);
                        killit = true;
                        delete jobinfo.targetip;
                        debugMessage('info','check_httpparse: Response has ended and total body is: '+sys.inspect(body));
                        jobinfo.results.end = new Date().getTime();
                        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                        jobinfo.results.statusCode = res.statusCode;
                        jobinfo.results.diag = {"http":{
                                                    requestheaders:targetoptions.headers,
                                                    responseheaders:res.headers,
                                                    httpstatus:res.statusCode,
                                                    httpserverip:req.connection.remoteAddress}
                                               };
                        jobinfo.results.fieldtracking = {};
                        if (res.statusCode >=200 && res.statusCode < 399) {
                            // Did it take too long?
                            if (defaulttimeout < jobinfo.results.runtime) {
                                debugMessage('info','check_httpparse: Timeout: '+sys.inspect(defaulttimeout)+" is less than "+sys.inspect(jobinfo.results.runtime));
                                jobinfo.results.success = false;
                                jobinfo.results.message = 'Timeout';
                                jobinfo.results.statusCode = 'Timeout';
                                resultobj.process(jobinfo);
                                return true;
                            }
                            var httpparseerrors = [];
                            var jsondata = {};
                            try {
                                // Convert the content to json.
                                jsondata = JSON.parse(body);
                            } catch(jsonerror) {
                                debugMessage('info','check_httpparse: JSON parse error: '+sys.inspect(jsonerror));
                                var bodylen = body.length;
                                // Let's parse it as just text.  Find the <fieldname>:<int> matches in the body.
                                var matches = body.match(/\w+:\s*[0-9.\-]+\s*/g);
                                if (!matches || matches.length < 1) {
                                    debugMessage('info','check_httpparse: Found no field matches in text: '+sys.inspect(body));
                                    jobinfo.results.success = false;
                                    jobinfo.results.message = 'No fields found in response';
                                    resultobj.process(jobinfo);
                                    return true;
                                }
                                for (var ind in matches) {
                                    var s = matches[ind].split(':');
                                    jsondata[s[0]] = s[1];
                                }
                                debugMessage('info','check_httpparse: Text parse found: '+sys.inspect(jsondata));
                            }
                            // flatten the data
                            try {
                                jsondata = flat(jsondata);
                            } catch (e) {
                                debugMessage('info','check_httpparse: Error flattening data: '+sys.inspect(jsondata)+' error: '+sys.inspect(e));
                                jobinfo.results.success = false;
                                jobinfo.results.message = 'Unable to process response';
                                resultobj.process(jobinfo);
                                return true;
                            }
                            debugMessage('info','check_httpparse: Flat data: '+sys.inspect(jsondata));
                            // Let's look for the fields
                            for (var key in jobinfo.parameters.fields) {
                                if (jobinfo.parameters.fields[key].hasOwnProperty("name") && jsondata.hasOwnProperty(jobinfo.parameters.fields[key].name)) {
                                    // We found this field.
                                    var metric = getFloat(jsondata[jobinfo.parameters.fields[key].name]);
                                    jobinfo.results.fieldtracking[key] = metric;
                                    if (jobinfo.parameters.fields[key].hasOwnProperty("min") && metric < jobinfo.parameters.fields[key].min) {
                                        // We're under our minimum.
                                        httpparseerrors.push(jobinfo.parameters.fields[key].name+":"+metric.toString()+" (min "+jobinfo.parameters.fields[key].min.toString()+')');
                                    }
                                    if (jobinfo.parameters.fields[key].hasOwnProperty("max") && metric > jobinfo.parameters.fields[key].max) {
                                        // We're over our max.
                                        httpparseerrors.push(jobinfo.parameters.fields[key].name+":"+metric.toString()+" (max "+jobinfo.parameters.fields[key].max.toString()+')');
                                    }
                                } else {
                                    httpparseerrors.push(jobinfo.parameters.fields[key].name+":absent");
                                }
                            }
                            if (httpparseerrors.length > 0) {
                                debugMessage('info','check_httpparse: Found errors: '+sys.inspect(httpparseerrors));
                                var errorMessage = '';
                                var comma = '';
                                for (var ind in httpparseerrors) {
                                    errorMessage +=comma+httpparseerrors[ind];
                                    comma = '. ';
                                }
                                jobinfo.results.success = false;
                                jobinfo.results.message = errorMessage;
                            } else {
                                jobinfo.results.success = true;
                                jobinfo.results.message = 'All fields within parameters';
                            }
                            resultobj.process(jobinfo);
                            return true;
                        } else {
                            // Status code out of range.
                            jobinfo.results.success = false;
                            jobinfo.results.message = 'HTTP return status: '+res.statusCode;
                            jobinfo.results.runtime = 0;
                            resultobj.process(jobinfo);
                            return true;
                        }
                    }
                    return true;
                });
                return true;
            });
            req.on("error", function(e) {
                clearTimeout(timeoutid);
                if (!killit) {
                    killit = true;
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Error';
                    jobinfo.results.success = false;
                    jobinfo.results.message = e.toString();
                    resultobj.process(jobinfo);
                }
                return true;
            }).on("timeout", function(to) {
                clearTimeout(timeoutid);
                if (!killit) {
                    killit = true;
                    debugMessage('info',"check_httpparse: Caught timeout");
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
        } catch(ec) {
            clearTimeout(timeoutid);
            if (!killit) {
                if (req) req.destroy();
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.success = false;
                jobinfo.results.message = "Caught "+ec.toString();
                resultobj.process(jobinfo);
                killit = true;
            }
            return true;
        }
    }
    function debugMessage(messageType, message) {
        if (jobinfo.debug || config.debug) {
            logger.log(messageType,message);
        }
    }
    function trim1white (str) {
        return str.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
    }
    function getFloat(s) {
        if (nputil.gettype(s) == 'string') {
            s = parseFloat(trim1white(s));
        }
        return s;
    }
    return true;
};
exports.check = check;
