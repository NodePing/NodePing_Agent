/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_ssl.js
 * Basic ssl check.
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
var tls = require('tls');

var check = function(jobinfo){
    debugMessage('info',"check_ssl: Jobinfo passed to http check: "+sys.inspect(jobinfo));
    var timeout = config.timeout * 1;
    if(jobinfo.parameters.threshold){
        timeout = 1000 * parseInt(jobinfo.parameters.threshold);
        if (timeout > 90000) timeout = 90000;
    }
    if(jobinfo.debug) config.debug = jobinfo.debug;
    jobinfo.results = {start:new Date().getTime()};
    if(!jobinfo.parameters.target){
        debugMessage('info',"check_ssl: Missing URL");
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid URL';
        resultobj.process(jobinfo, true);
        return true;
    }else{
        try{
            var targetinfo = require('url').parse(jobinfo.parameters.target);
        }catch(error){
            debugMessage('info',"check_ssl: Invalid URL");
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = 'URL will not parse: '+error;
            resultobj.process(jobinfo, true);
            return true;
        }

        var port = 443;
        if(targetinfo.port){
            port = targetinfo.port;
        }
        debugMessage('info',"check_ssl: targetinfo: "+sys.inspect(targetinfo));
        var killit = false;
        var timeoutid = setTimeout(function() {
            if(killit){
                return true;
            }
            killit = true;
            s = null;
            debugMessage('info',"check_ssl: setTimeout called: "+timeout.toString());
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Timeout';
            jobinfo.results.success = false;
            jobinfo.results.message = 'Timeout';
            resultobj.process(jobinfo);
            return true;
        }, timeout);
        try{
            var options = {servername:targetinfo.hostname};
            if (jobinfo.parameters.forceSSLv3){
                options.secureProtocol = 'SSLv3_method';
            }
            var s = tls.connect(port, targetinfo.hostname,options,function(err, response){
                if(killit){
                    return false;
                }
                killit = true;
                clearTimeout(timeoutid);
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                if(s.authorized){
                    var cert = s.getPeerCertificate();
                    debugMessage('info',"check_ssl: cert: "+sys.inspect(cert));
                    if (cert && cert.subject && cert.subject.CN){
                        var certdomain = cert.subject.CN.toLowerCase();
                    } else {
                        var certdomain = '';
                    }
                    var wildcard = false;
                    debugMessage('info',"check_ssl: certdomain: "+sys.inspect(certdomain));
                    if(certdomain.indexOf('*') > -1){
                        wildcard = true;
                        debugMessage('info',"check_ssl: wildcard: "+sys.inspect(certdomain));
                        certdomain = certdomain.replace('*.','');
                    }else{
                        debugMessage('info',"check_ssl: Not a wildcard cert: "+sys.inspect(certdomain));
                    }
                    var done = false;
                    var domainmatch = false;
                    // Check domain match.
                    if(targetinfo.hostname.toLowerCase() != certdomain){
                        if(wildcard){
                            // Wildcard cert.  Check base domains.
                            var certBaseDomain = '.'+certdomain;
                            debugMessage('info',"check_ssl: certbasedomain: "+sys.inspect(certBaseDomain));
                            var pos = targetinfo.hostname.indexOf(certBaseDomain);
                            if(pos > -1){
                                // Is it on the end of the string?
                                //logger.log('info',"check_ssl: pos: "+sys.inspect(pos));
                                //logger.log('info',"check_ssl: hostlength: "+sys.inspect(targetinfo.host.length));
                                if(targetinfo.hostname.length - certBaseDomain.length == pos){
                                    // Looks like a valid wildcard cert.
                                    debugMessage('info',"check_ssl: Wildcard match: "+targetinfo.hostname+' and '+certBaseDomain);
                                    domainmatch = true;
                                }
                            }
                        }
                        if (!domainmatch && !done && cert.subjectaltname) {
                            // Check UNCC (alt subject) certs.
                            debugMessage('info',"check_ssl: subectaltname: "+sys.inspect(cert.subjectaltname));
                            if(cert.subjectaltname.toLowerCase().indexOf(targetinfo.hostname) < 0){
                                // Look for the wildcard of this domain in the subjectaltname
                                var domainparts = targetinfo.hostname.toLowerCase().split('.');
                                debugMessage('info',"check_ssl: Domain parts: "+sys.inspect(domainparts));
                                domainparts[0] = '*';
                                var wildcardToLookFor = domainparts.join('.');
                                debugMessage('info',"check_ssl: WildcardToLookFor: "+sys.inspect(wildcardToLookFor));
                                if(cert.subjectaltname.toLowerCase().indexOf(wildcardToLookFor) > -1){
                                    domainmatch = true;
                                }
                            } else {
                                domainmatch = true;
                            }
                        }
                    } else { 
                        domainmatch = true;
                    }
                    
                    if (!domainmatch && !done) {
                        jobinfo.results.success = false;
                        jobinfo.results.message = 'Domain mismatch';
                        jobinfo.results.statusCode = 'invalid';
                        done = true;
                    }
                    //debugMessage('info',"check_ssl: cert: "+sys.inspect(cert));
                    //debugMessage('info',"check_ssl: targetinfo: "+sys.inspect(targetinfo));
                    if(!done){
                        // Check for expiration.
                        if(jobinfo.parameters.warningdays){
                            if(cert.valid_to){
                                var warningdays = parseInt(jobinfo.parameters.warningdays)*86400000; // seconds of warning.
                                var willexpire = new Date(cert.valid_to).getTime();
                                if(willexpire < jobinfo.results.end+warningdays){
                                    jobinfo.results.success = false;
                                    jobinfo.results.message = 'Will expire '+cert.valid_to;
                                    jobinfo.results.statusCode = 'expires '+cert.valid_to;
                                }else{
                                    jobinfo.results.success = true;
                                    jobinfo.results.message = 'Valid cert';
                                    jobinfo.results.statusCode = 'valid';
                                }
                            }else{
                                jobinfo.results.success = false;
                                jobinfo.results.message = 'Missing valid_to';
                                jobinfo.results.statusCode = 'invalid';
                            }
                        }else{
                            jobinfo.results.success = true;
                            jobinfo.results.message = 'Valid cert';
                            jobinfo.results.statusCode = 'valid';
                        }
                    }
                }else{
                    debugMessage('info',"check_ssl: cert auth error: "+sys.inspect(s.authorizationError,true,8));
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'Invalid cert: '+s.authorizationError;
                    jobinfo.results.statusCode = 'invalid';
                }
                resultobj.process(jobinfo);
                s = null;
                return true;
            });
            s.on("error",function(error){
                if(killit){
                    return false;
                }
                killit = true;
                clearTimeout(timeoutid);
                if (!jobinfo.parameters.forceSSLv3 && error.toString().indexOf('sslv3 alert unexpected') > 0){
                    jobinfo.parameters.forceSSLv3 = true;
                    return check(jobinfo);
                }
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.success = false;
                jobinfo.results.message = "Error "+error.toString();
                resultobj.process(jobinfo);
                return false;
            });
        }catch(error){
            killit = true;
            clearTimeout(timeoutid);
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Error';
            jobinfo.results.success = false;
            jobinfo.results.message = "Caught "+error.toString();
            resultobj.process(jobinfo);
        }
        return true;
    }
    function debugMessage(messageType, message){
        if(jobinfo.debug || config.debug){
            logger.log(messageType,message);
        }
    }
    return true;
};
exports.check = check;