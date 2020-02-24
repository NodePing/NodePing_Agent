/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_imap4.js
 * Basic IMAP check
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
var Imap = require('imap');

var logger = console;

exports.check = function(jobinfo){
    //debugMessage('info',"Jobinfo passed to ping check: "+sys.inspect(jobinfo));
    var timeout =  config.timeout *1;
    if(jobinfo.parameters.threshold) timeout = parseInt(jobinfo.parameters.threshold)*1000;
    if (timeout > 90000) timeout = 90000;
    jobinfo.results = {start:new Date().getTime()};
    if(!jobinfo.parameters.target){
        //debugMessage('info',"check_imap4: Invalid target");
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing a target';
        resultobj.process(jobinfo, true);
        return true;
    }else{
        var imapoptions = {"host": jobinfo.parameters.target,
                           connTimeout: timeout
                          };
        var port = 143;
        if(jobinfo.parameters.port){
            port = parseInt(jobinfo.parameters.port);
        }
        imapoptions.port = port;
        //debugMessage('info',"check_imap4: port: "+sys.inspect(port)+' on target '+sys.inspect(jobinfo.parameters.target));
        var useLogin = false;
        if(jobinfo.parameters.username){
            //debugMessage('info',"check_imap4: setting user: "+sys.inspect(jobinfo.parameters.username));
            imapoptions.user = jobinfo.parameters.username;
            useLogin = true;
        }
        if(jobinfo.parameters.password){
            imapoptions.password = jobinfo.parameters.password;
        }
        if(jobinfo.parameters.secure && jobinfo.parameters.secure != 'false'){
            imapoptions.tlsOptions = {'rejectUnauthorized':false};
            imapoptions.tls = true;
        }
        //debugMessage('info',"check_imap4: imapoptions: "+sys.inspect(imapoptions));
        var imap = new Imap(imapoptions);
        var completed = false;
        try{
            var timeoutid = setTimeout(function() {
                if(completed){
                    return true;
                }
                // No IP address here to put in diags
                completed = true;
                debugMessage('info',"check_imap4: setTimeout called");
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Timeout';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Timeout';
                resultobj.process(jobinfo);
                imap.destroy();
                return true;
            }, timeout);
            imap.connect(function(error){
                //debugMessage('info',"check_imap4: Connected to port: "+sys.inspect(port)+' on target '+sys.inspect(jobinfo.parameters.target));
                if(error && error !== undefined && !completed){
                    completed = true;
                    debugMessage('info',"check_imap4: error: "+sys.inspect(error));
                    jobinfo.results.statusCode = 'error';
                    jobinfo.results.success = false;
                    var errortext =  sys.inspect(error);
                    var errortestlower = errortext.toLowerCase();
                    if(errortestlower.indexOf('login') > -1
                        || errortestlower.indexOf('invalid') > -1
                        || errortestlower.indexOf('authentication') > -1
                        || errortestlower.indexOf('ogging in is disabled') > -1){ // Google doesn't return a proper code so we have to look for its 'special' error message.
                        if(!useLogin){
                            jobinfo.results.success = true;
                            jobinfo.results.statusCode = 'Connected';
                            if(jobinfo.parameters.secure){
                                // Certificate check.
                                if(jobinfo.parameters.verify && jobinfo.parameters.verify != 'false' && !checkCert()){
                                    return false;
                                }
                                if(jobinfo.parameters.warningdays && !checkExpiration()){
                                    return false;
                                }
                            }
                        }else{
                            jobinfo.results.statusCode = 'AUTHENTICATIONFAILED';
                            jobinfo.results.message = 'Login failed';
                        }
                        imap.end();
                    }else if(errortestlower.indexOf('getaddrinfo') > -1){
                        jobinfo.results.message = 'Host not found';
                    }else if(errortestlower.indexOf('ehostunreach') > -1){
                        jobinfo.results.message = 'Host unreachable';
                    }else{
                        jobinfo.results.message = errortext;
                    }
                    if(jobinfo.results.runtime > timeout){
                        jobinfo.results.success = false;
                        jobinfo.results.statusCode = 'timeout';
                        jobinfo.results.message = 'Timeout';
                    }
                    resultobj.process(jobinfo);
                    imap.destroy();
                    return true;
                }
            });
            imap.on('ready',function(nothing){
                clearTimeout(timeoutid);
                //debugMessage('info',"check_imap4: Ready to port: "+sys.inspect(port)+' on target '+sys.inspect(jobinfo.parameters.target));
                if(completed){
                    return false;
                }
                completed = true;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                if(jobinfo.parameters.secure){
                    // Certificate check.
                    //debugMessage('info',"check_imap4: secure checked");
                    if(jobinfo.parameters.verify && jobinfo.parameters.verify !== 'false' && !checkCert()){
                        return false;
                    }
                    if(jobinfo.parameters.warningdays && !checkExpiration()){
                        return false;
                    }
                }
                jobinfo.results.statusCode = 'Login success';
                jobinfo.results.success = true;
                if(jobinfo.results.runtime > timeout){
                    jobinfo.results.success = false;
                    jobinfo.results.statusCode = 'timeout';
                    jobinfo.results.message = 'Timeout';
                    if (imap && imap._sock && imap._sock._parent && imap._sock._parent.remoteAddress){
                        jobinfo.results.diag = {"imap":{
                            statusCode:jobinfo.results.statusCode,
                            serverip:imap._sock._parent.remoteAddress}
                        };
                    }
                }
                resultobj.process(jobinfo);
                //debugMessage('info',"check_imap4: gonna log out");
                imap.end();
                return true;
            });
            imap.on("error",function(error){
                clearTimeout(timeoutid);
                //debugMessage('info',"check_imap4: error event: "+sys.inspect(error));
                if(!completed){
                    completed = true;
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    if (!useLogin && error.source === 'authentication') {
                        jobinfo.results.success = true;
                        jobinfo.results.statusCode = 'Connected';
                        //debugMessage('info',"check_imap4: Login error but no login required: "+sys.inspect(imap._sock));
                        if(jobinfo.parameters.secure){
                            // Certificate check.
                            if(jobinfo.parameters.verify && jobinfo.parameters.verify !== 'false' && !checkCert()){
                                return false;
                            }
                            if(jobinfo.parameters.warningdays && !checkExpiration()){
                                return false;
                            }
                        }
                    } else {
                        jobinfo.results.statusCode = 'error';
                        jobinfo.results.success = false;
                        if (imap && imap._sock && imap._sock._parent && imap._sock._parent.remoteAddress){
                            jobinfo.results.diag = {"imap":{
                                statusCode:jobinfo.results.statusCode,
                                serverip:imap._sock._parent.remoteAddress}
                            };
                        }
                        var errortext =  sys.inspect(error);
                        var errortestlower = errortext.toLowerCase();
                        if(errortestlower.indexOf('login') > -1
                            || errortestlower.indexOf('invalid') > -1
                            || errortestlower.indexOf('authentication') > -1
                            || errortestlower.indexOf('ogging in is disabled') > -1){ // Google doesn't return a proper code so we have to look for its 'special' error message.  
                            jobinfo.results.statusCode = 'AUTHENTICATIONFAILED';
                            jobinfo.results.message = 'Login failed';
                            imap.end();
                        }else if(errortestlower.indexOf('getaddrinfo') > -1){
                            jobinfo.results.message = 'Host not found';
                        }else if(errortestlower.indexOf('ehostunreach') > -1){
                            jobinfo.results.message = 'Host unreachable';
                        }else{
                            jobinfo.results.message = error.message;
                        }
                        if(errortext.indexOf('unknown protocol') > -1){
                            jobinfo.results.message = 'SSL check on non-ssl port';
                        }
                    }
                    resultobj.process(jobinfo);
                    imap.destroy();
                    return true;
                }
                return true;
            });
        } catch(caughterror){
            clearTimeout(timeoutid);
            debugMessage('info',"check_imap4: caught error: "+sys.inspect(caughterror));
            if(!completed){
                completed = true;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'error';
                jobinfo.results.success = false;
                jobinfo.results.message = sys.inspect(caughterror);
                resultobj.process(jobinfo);
                imap.destroy();
            }
            return true;
        }
    }
    function debugMessage(messageType, message){
        if(jobinfo.debug || config.debug){
            logger.log(messageType,message);
        }
    }

    function checkCert(){
        //debugMessage('error','check_imap4 connection authorized: '+sys.inspect(imap._sock.authorized));
        if(!imap._sock.authorized){
            debugMessage('error','check_imap4 cert not authorized: '+sys.inspect(imap._sock.getPeerCertificate()+' with error: '+sys.inspect(imap._sock.authorizationError)));
            jobinfo.results.statusCode = 'error';
            jobinfo.results.success = false;
            jobinfo.results.message = 'SSL cert failed: '+sys.inspect(imap._sock.authorizationError);
            if (imap && imap._sock && imap._sock._parent && imap._sock._parent.remoteAddress){
                jobinfo.results.diag = {"imap":{
                    statusCode:jobinfo.results.statusCode,
                    serverip:imap._sock._parent.remoteAddress}
                };
            }
            resultobj.process(jobinfo);
            imap.end();
            return false;
        }
        return true;
    }
    function checkExpiration(){
        var cert = imap._sock.getPeerCertificate();
        if(cert && cert.valid_to){
            var warningdays = parseInt(jobinfo.parameters.warningdays)*86400000; // seconds of warning.
            var willexpire = new Date(cert.valid_to).getTime();
            if(willexpire < jobinfo.results.end+warningdays){
                debugMessage('error','check_smtp cert expiring soon');
                jobinfo.results.statusCode = 'error';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Certificate expires '+cert.valid_to;
                if (imap && imap._sock && imap._sock._parent && imap._sock._parent.remoteAddress){
                    jobinfo.results.diag = {"imap":{
                        statusCode:jobinfo.results.statusCode,
                        serverip:imap._sock._parent.remoteAddress}
                    };
                }
                resultobj.process(jobinfo);
                imap.end();
                return false;
            }
        }else{
            debugMessage('error','check_smtp cert missing valid_to: '+sys.inspect(cert));
            jobinfo.results.statusCode = 'error';
            jobinfo.results.success = false;
            jobinfo.results.message = 'Certificate missing valid_to';
            if (imap && imap._sock && imap._sock._parent && imap._sock._parent.remoteAddress){
                jobinfo.results.diag = {"imap":{
                    statusCode:jobinfo.results.statusCode,
                    serverip:imap._sock._parent.remoteAddress}
                };
            }
            resultobj.process(jobinfo);
            imap.end();
            return false;
        }
        return true;
    }
    return true;
};