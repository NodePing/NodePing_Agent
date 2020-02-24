/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_smtp.js
 * Basic smtp check - do we get a '250' response?
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
var smtp = require('smtp-protocol'),
    tls = require('tls'),
    nputil = require('../../nputil');

var logger = console;

exports.check = function(jobinfo){
    //debugMessage('info',"Jobinfo passed to SMTP check: "+sys.inspect(jobinfo));
    var timeout =  config.timeout *1;
    if(jobinfo.parameters.threshold) timeout = parseInt(jobinfo.parameters.threshold)*1000;
    if (timeout > 90000) timeout = 90000;
    jobinfo.results = {start:new Date().getTime()};
    if(!jobinfo.parameters.target){
        debugMessage('error',"check_smtp: False target");
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing a target';
        resultobj.process(jobinfo, true);
        return true;
    }else{
        var completed = false;
        var timeoutid = setTimeout(function() {
            debugMessage('info',"check_smtp: timeout called");
            if(!completed){
                completed = true;
                debugMessage('info',"check_smtp: setTimeout triggered");
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Timeout';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Timeout';
                resultobj.process(jobinfo);
            }
            if(stream)stream.destroy();
            return true;
        }, timeout);
        //logger.log('info','check_smtp secure is: '+sys.inspect(jobinfo.parameters.secure));
        var options = {};
        if(jobinfo.parameters.secure && (jobinfo.parameters.secure == 'true' || jobinfo.parameters.secure == 'ssl' || jobinfo.parameters.secure == 'tls')){
            if(jobinfo.parameters.verify && jobinfo.parameters.verify != 'false'){
                options.tls = true;
            }else{
                options.tls = {rejectUnauthorized:false};
            }
        }
        try{
            //logger.log('info','SMTP check info: host '+sys.inspect(jobinfo.parameters.target)+' and port: '+sys.inspect(jobinfo.parameters.port)+' and TLS: '+sys.inspect(jobinfo.parameters.secure));
            var stream = smtp.connect(jobinfo.parameters.target, parseInt(jobinfo.parameters.port), options, function (mail) {
                mail.on('greeting', function (code, lines) {
                    if(completed){
                        debugMessage('info','check_smtp was complete before greeting');
                        return true;
                    }
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    //debugMessage('info','check_smtp connected with code '+sys.inspect(code)+' and lines: '+sys.inspect(lines));
                    if(code == 421){
                        clearTimeout(timeoutid);
                        completed = true;
                        debugMessage('info','check_smtp tripped on 421 on greeting');
                        jobinfo.results.statusCode = code;
                        jobinfo.results.success = false;
                        jobinfo.results.message = sys.inspect(lines);
                        resultobj.process(jobinfo);
                        return true;
                    }
                    var useLogin = false;
                    if(jobinfo.parameters.username && jobinfo.parameters.password){
                        useLogin = true;
                    }
                    // Switch to secure?
                    if(jobinfo.parameters.secure == 'starttls'){
                        //debugMessage('info','check_smtp going to try starttls');
                        mail.ehlo('nodeping.com',function(err,code,lines){
                            if(completed){
                                debugMessage('info','check_smtp was complete before ehlo');
                                return true;
                            }
                            //debugMessage('info','check_smtp on ehlo with code '+sys.inspect(code)+' and lines: '+sys.inspect(lines)+' and error '+sys.inspect(err));
                            if(err){
                                debugMessage('error','check_smtp error on ehlo with code '+sys.inspect(code)+' and lines: '+sys.inspect(lines)+' and error '+sys.inspect(err));
                                clearTimeout(timeoutid);
                                completed = true;
                                jobinfo.results.statusCode = code;
                                jobinfo.results.success = false;
                                jobinfo.results.message = sys.inspect(err);
                                resultobj.process(jobinfo);
                                mail.quit(function(err, code, lines){});
                                return true;
                            }
                            var tlsOptions = {servername:jobinfo.parameters.target};
                            if(!jobinfo.parameters.verify || jobinfo.parameters.verify === 'false'){
                                tlsOptions.rejectUnauthorized = false;
                            }
                            mail.startTLS(tlsOptions, function(err,code,lines){
                                if(completed){
                                    debugMessage('info','check_smtp was complete before starttls');
                                    return true;
                                }
                                //debugMessage('info','check_smtp info on "starttls" with code '+sys.inspect(code)+' and lines: '+sys.inspect(lines)+' and error '+sys.inspect(err));
                                if(err || code != 220){
                                    debugMessage('error','check_smtp error on "starttls" with code '+sys.inspect(code)+' and lines: '+sys.inspect(lines)+' and error '+sys.inspect(err));
                                    clearTimeout(timeoutid);
                                    completed = true;
                                    jobinfo.results.statusCode = code;
                                    jobinfo.results.success = false;
                                    jobinfo.results.message = sys.inspect(err);
                                    resultobj.process(jobinfo);
                                    mail.quit(function(err, code, lines){});
                                    return true;
                                }
                            });
                            mail.on('tls',function(){
                                //logger.log('info','check_smtp starttls stream is now secure ');//'+sys.inspect(s));
                                if(completed){
                                    debugMessage('info','check_smtp was complete before starttls tls');
                                    return true;
                                }
                                // Certificate check.
                                if(jobinfo.parameters.verify && jobinfo.parameters.verify != 'false'){
                                    //debugMessage('info','check_smtp starttls verify cert');
                                    if(!mail.stream.authorized){
                                        debugMessage('error','check_smtp cert not authorized: '+sys.inspect(mail.stream.getPeerCertificate()));
                                        clearTimeout(timeoutid);
                                        completed = true;
                                        jobinfo.results.statusCode = 451;
                                        jobinfo.results.success = false;
                                        jobinfo.results.message = mail.stream.authorizationError;
                                        resultobj.process(jobinfo);
                                        mail.quit(function(err, code, lines){});
                                        mail.stream.destroy();
                                        return true;
                                    }
                                }
                                if(jobinfo.parameters.warningdays){
                                    //debugMessage('info','check_smtp starttls check expiration');
                                    if(!verifyExpiration(mail.stream)){
                                        mail.quit(function(err, code, lines){});
                                        mail.stream.destroy();
                                        return false;
                                    }
                                }
                                var heloCommand = 'helo';
                                if(useLogin){
                                    heloCommand = 'ehlo';
                                }
                                //debugMessage('info','check_smtp starttls going to say '+heloCommand);
                                mail[heloCommand]('nodeping.com',function(err,code,lines){
                                    //debugMessage('info','check_smtp on secure '+heloCommand+' with code '+sys.inspect(code)+' and lines: '+sys.inspect(lines)+' and error '+sys.inspect(err));
                                    if(useLogin){
                                        //debugMessage('info','check_smtp using login');
                                        var supportedAuth = getSupportedAuth(lines);
                                        //debugMessage('info','check_smtp supported auth: '+sys.inspect(supportedAuth));
                                        if(supportedAuth.length < 1){
                                            debugMessage('error','check_smtp error unsupported auth: '+sys.inspect(supportedAuth));
                                            clearTimeout(timeoutid);
                                            completed = true;
                                            jobinfo.results.statusCode = 'error';
                                            jobinfo.results.success = false;
                                            jobinfo.results.message = 'No supported authentication found';
                                            resultobj.process(jobinfo);
                                            mail.quit(function(err, code, lines){});
                                            return true;
                                        }
                                        checkLogin(mail, supportedAuth);
                                    }else{
                                        if(jobinfo.parameters.email){
                                            checkEmail(mail);
                                        }else{
                                            debugMessage('info','check_smtp Not logging in and not checking mail.  Secure success');
                                            clearTimeout(timeoutid);
                                            completed = true;
                                            jobinfo.results.statusCode = code;
                                            jobinfo.results.success = true;
                                            jobinfo.results.message = 'STARTTLS connected';
                                            resultobj.process(jobinfo);
                                            mail.quit(function(err, code, lines){});
                                            return true;
                                        }
                                    }
                                });
                            });
                        });
                    }else{
                        // Certificate check.
                        if(jobinfo.parameters.secure){
                            debugMessage('info','check_smtp SSL/TLS enabled');
                            if(jobinfo.parameters.verify && jobinfo.parameters.verify != 'false'&& !mail.stream.authorized){
                                debugMessage('error','check_smtp cert not authorized: '+sys.inspect(mail.stream.getPeerCertificate()));
                                clearTimeout(timeoutid);
                                completed = true;
                                jobinfo.results.statusCode = 451;
                                jobinfo.results.success = false;
                                jobinfo.results.message = mail.stream.authorizationError;
                                resultobj.process(jobinfo);
                                mail.quit(function(err, code, lines){});
                                return true;
                            }
                            if(jobinfo.parameters.warningdays && !verifyExpiration(mail.stream)){
                                mail.quit(function(err, code, lines){});
                                return false;
                            }
                        }
                        var heloCommand = 'helo';
                        if(useLogin){
                            heloCommand = 'ehlo';
                        }
                        mail[heloCommand]('nodeping.com',function(err,code,lines){
                            //debugMessage('info','check_smtp on '+heloCommand+' with code '+sys.inspect(code)+' and lines: '+sys.inspect(lines)+' and error '+sys.inspect(err));
                            if(completed){
                                debugMessage('info','check_smtp was complete before '+heloCommand);
                                return true;
                            }
                            if(err){
                                debugMessage('error','check_smtp error on helo with code '+sys.inspect(code)+' and lines: '+sys.inspect(lines)+' and error '+sys.inspect(err));
                                clearTimeout(timeoutid);
                                completed = true;
                                jobinfo.results.statusCode = code;
                                jobinfo.results.success = false;
                                jobinfo.results.message = sys.inspect(err);
                                resultobj.process(jobinfo);
                                mail.quit(function(err, code, lines){});
                                return true;
                            }
                            if(useLogin){
                                //debugMessage('info','check_smtp going to Login');
                                var supportedAuth = getSupportedAuth(lines);
                                //debugMessage('info','check_smtp supported Auth: '+sys.inspect(supportedAuth));
                                if(supportedAuth.length < 1){
                                    debugMessage('error','check_smtp error unsupported auth: '+sys.inspect(supportedAuth));
                                    clearTimeout(timeoutid);
                                    completed = true;
                                    jobinfo.results.statusCode = 'error';
                                    jobinfo.results.success = false;
                                    jobinfo.results.message = 'No supported authentication found';
                                    resultobj.process(jobinfo);
                                    mail.quit(function(err, code, lines){});
                                    return true;
                                }
                                checkLogin(mail, supportedAuth);
                            }else{
                                if(jobinfo.parameters.email){
                                    checkEmail(mail);
                                }else{
                                    debugMessage('info','check_smtp error no auth and no email check - success');
                                    clearTimeout(timeoutid);
                                    completed = true;
                                    mail.quit(function(err, code, lines){
                                        //logger.log('info','check_smtp quit with code '+sys.inspect(code)+' and lines: '+sys.inspect(lines)+' and error '+sys.inspect(err));
                                    });
                                    jobinfo.results.statusCode = code;
                                    jobinfo.results.success = true;
                                    jobinfo.results.message = "Connected";
                                    resultobj.process(jobinfo);
                                    return true;
                                }
                            }
                        });
                    }
                    return true;
                });
                mail.on('error', function(code, error){
                    debugMessage('error','check_smtp error event with code '+sys.inspect(code)+' and error: '+sys.inspect(error));
                    if(completed){
                        debugMessage('info','check_smtp complete before error event');
                        return true;
                    }
                    clearTimeout(timeoutid);
                    completed = true;
                    var errormessage = '';
                    if (error) {
                        errormessage = error.toString();
                    }
                    var codemessage = 'error';
                    if (code) {
                        if (!nputil.isNumeric(code.toString())){
                            errormessage = code.toString().replace("doesn't", "does not").replace("cert's", "cert").replace("certificate's", "certificate");
                        } else {
                            codemessage = code.toString();
                        }
                    }
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.statusCode = codemessage;
                    jobinfo.results.success = false;
                    jobinfo.results.message = errormessage;
                    resultobj.process(jobinfo);
                    return true;
                });
            });
            stream.setTimeout(timeout,function(){
                debugMessage('info',"check_smtp: Socket setTimeout called.");
                if(!completed){
                    completed = true;
                    debugMessage('info',"check_smtp: Socket setTimeout triggered.");
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Timeout';
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'Timeout';
                    resultobj.process(jobinfo);
                }
                if(stream)stream.destroy();
                return true;
            });
            stream.on('error',function(error){
                debugMessage('info','check_smtp stream error with error: '+sys.inspect(error));
                if(completed){
                    debugMessage('info',"check_smtp: completed before stream error.");
                    return true;
                }
                clearTimeout(timeoutid);
                completed = true;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'error';
                jobinfo.results.success = false;
                var displayederror = sys.inspect(error);
                if(error.code){
                    displayederror = error.code;
                }
                if(error.code == 'ENOTFOUND'){
                    displayederror = 'Host not found';
                }
                if(displayederror.indexOf("unknown protocol") > 0){
                    displayederror = 'SSL/TLS not supported on this port';
                }
                jobinfo.results.message = displayederror;
                resultobj.process(jobinfo);
                return true;
            });
        }catch(error){
            debugMessage('info','check_smtp caught error: '+sys.inspect(error));
            if(completed){
                debugMessage('info',"check_smtp: completed before caught error.");
                return true;
            }
            clearTimeout(timeoutid);
            completed = true;
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.success = false;
            var displayederror = sys.inspect(error);
            jobinfo.results.message = displayederror;
            resultobj.process(jobinfo);
            return true;
        }
    }
    function checkEmail(mail){
        mail.from('smtptest@nodeping.com',function(err,code,lines){
            if(completed){
                debugMessage('info',"check_smtp: completed before from.");
                return true;
            }
            if(err){
                debugMessage('error','check_smtp error on "from" with code '+sys.inspect(code)+' and lines: '+sys.inspect(lines)+' and error '+sys.inspect(err));
                clearTimeout(timeoutid);
                completed = true;
                jobinfo.results.statusCode = code;
                jobinfo.results.success = false;
                jobinfo.results.message = sys.inspect(err);
                resultobj.process(jobinfo);
                mail.quit(function(err, code, lines){});
                return true;
            }
            mail.to(jobinfo.parameters.email, function(err,code,lines){
                if(completed){
                    debugMessage('info',"check_smtp: completed before to.");
                    return true;
                }
                clearTimeout(timeoutid);
                completed = true;
                jobinfo.results.statusCode = code;
                if(err){
                    debugMessage('error','check_smtp error on "to" with code '+sys.inspect(code)+' and lines: '+sys.inspect(lines)+' and error '+sys.inspect(err));
                    jobinfo.results.success = false;
                    jobinfo.results.message = sys.inspect(err);
                    resultobj.process(jobinfo);
                    mail.quit(function(err, code, lines){});
                    return true;
                }
                jobinfo.results.success = true;
                //debugMessage('info','check_smtp "to" response code '+sys.inspect(code)+' and lines: '+sys.inspect(lines)+' and error '+sys.inspect(err));
                if(code == 250){
                    jobinfo.results.message = 'Email for address '+jobinfo.parameters.email+' was accepted';
                    if(jobinfo.parameters.invert){
                        // whoa - this shouldn't have accecpted this address.
                        jobinfo.results.success = false;
                    }
                }else{
                    jobinfo.results.message = 'Email for address '+jobinfo.parameters.email+' was rejected';
                    if(!jobinfo.parameters.invert){
                        jobinfo.results.success = false;
                    }
                }
                mail.quit(function(err, code, lines){});
                resultobj.process(jobinfo);
                return true;
            });
        });
    }
    function getSupportedAuth(lines){
        supportedAuth = [];
        // Get supported login mechanisms.
        for(var l in lines){
            //logger.log('info','check_smtp Auth line '+sys.inspect(l)+' is: '+sys.inspect(lines[l]));
            if(lines[l].toUpperCase().indexOf('AUTH') > -1){
                lines[l] = lines[l].toUpperCase();
                if(lines[l].indexOf('PLAIN') > 0){
                    supportedAuth.push('PLAIN');
                }
                if(lines[l].indexOf('LOGIN') > 0){
                    supportedAuth.push('LOGIN');
                }
                if(lines[l].indexOf('CRAM-MD5') > 0){
                    supportedAuth.push('CRAM-MD5');
                }
            }
        }
        return supportedAuth;
    }

    function checkLogin(mail, supportedAuth){
        // Use PLAIN if it is supported.
        if(supportedAuth.indexOf('PLAIN') > -1){
            mail.login(jobinfo.parameters.username,jobinfo.parameters.password,'PLAIN',function(error,code,lines){
                if(completed){
                    debugMessage('info',"check_smtp: completed before PLAIN login.");
                    return true;
                }
                if(error){
                    debugMessage('error','check_smtp error on PLAIN auth: '+sys.inspect(error));
                    clearTimeout(timeoutid);
                    completed = true;
                    jobinfo.results.statusCode = (code)?code:451;
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'PLAIN auth error: '+sys.inspect(error);
                    resultobj.process(jobinfo);
                    mail.quit(function(err, code, lines){});
                    return true;
                }
                if(code != 235){
                    debugMessage('error','check_smtp code '+code.toString()+'error on PLAIN auth: '+sys.inspect(lines));
                    clearTimeout(timeoutid);
                    completed = true;
                    jobinfo.results.statusCode = (code)?code:451;
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'PLAIN auth failure: '+sys.inspect(lines);
                    resultobj.process(jobinfo);
                    mail.quit(function(err, code, lines){});
                    return true;
                }
                //debugMessage('info','check_smtp info on PLAIN auth with code '+sys.inspect(code)+' and lines: '+sys.inspect(lines)+' and error '+sys.inspect(error));
                if(jobinfo.parameters.email){
                    checkEmail(mail);
                }else{
                    clearTimeout(timeoutid);
                    completed = true;
                    jobinfo.results.statusCode = code;
                    jobinfo.results.success = true;
                    jobinfo.results.message = 'PLAIN auth success';
                    resultobj.process(jobinfo);
                    mail.quit(function(err, code, lines){});
                    return true;
                }
            });
        }else if(supportedAuth.indexOf('LOGIN') > -1){
            mail.login(jobinfo.parameters.username,jobinfo.parameters.password,'LOGIN',function(error,code,lines){
                if(completed){
                    debugMessage('info',"check_smtp: completed before LOGIN login.");
                    return true;
                }
                if(error){
                    debugMessage('error','check_smtp error on LOGIN auth: '+sys.inspect(error));
                    clearTimeout(timeoutid);
                    completed = true;
                    jobinfo.results.statusCode = (code)?code:451;
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'LOGIN auth error: '+sys.inspect(error);
                    resultobj.process(jobinfo);
                    mail.quit(function(err, code, lines){});
                    return true;
                }
                if(code != 235){
                    debugMessage('error','check_smtp code '+code.toString()+'error on LOGIN auth: '+sys.inspect(lines));
                    clearTimeout(timeoutid);
                    completed = true;
                    jobinfo.results.statusCode = (code)?code:451;
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'LOGIN auth failure: '+sys.inspect(lines);
                    resultobj.process(jobinfo);
                    mail.quit(function(err, code, lines){});
                    return true;
                }
                //debugMessage('info','check_smtp info on LOGIN auth with code '+sys.inspect(code)+' and lines: '+sys.inspect(lines)+' and error '+sys.inspect(error));
                if(jobinfo.parameters.email){
                    checkEmail(mail);
                }else{
                    clearTimeout(timeoutid);
                    completed = true;
                    jobinfo.results.statusCode = code;
                    jobinfo.results.success = true;
                    jobinfo.results.message = 'LOGIN auth success';
                    resultobj.process(jobinfo);
                    mail.quit(function(err, code, lines){});
                    return true;
                }
            });
        }else if(supportedAuth.indexOf('CRAM-MD5') > -1){
            mail.login(jobinfo.parameters.username,jobinfo.parameters.password,'CRAM-MD5',function(error,code,lines){
                if(completed){
                    debugMessage('info',"check_smtp: completed before CRAM-MD5 login.");
                    return true;
                }
                if(error){
                    debugMessage('error','check_smtp error on CRAM-MD5 auth: '+sys.inspect(error));
                    clearTimeout(timeoutid);
                    completed = true;
                    jobinfo.results.statusCode = (code)?code:451;
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'CRAM-MD5 auth error: '+sys.inspect(error);
                    resultobj.process(jobinfo);
                    mail.quit(function(err, code, lines){});
                    return true;
                }
                if(code != 235){
                    debugMessage('error','check_smtp code '+code.toString()+'error on CRAM-MD5 auth: '+sys.inspect(lines));
                    clearTimeout(timeoutid);
                    completed = true;
                    jobinfo.results.statusCode = (code)?code:451;
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'CRAM-MD5 auth failure: '+sys.inspect(lines);
                    resultobj.process(jobinfo);
                    mail.quit(function(err, code, lines){});
                    return true;
                }
                //debugMessage('info','check_smtp info on CRAM-MD5 auth with code '+sys.inspect(code)+' and lines: '+sys.inspect(lines)+' and error '+sys.inspect(error));
                if(jobinfo.parameters.email){
                    checkEmail(mail);
                }else{
                    clearTimeout(timeoutid);
                    completed = true;
                    jobinfo.results.statusCode = code;
                    jobinfo.results.success = true;
                    jobinfo.results.message = 'CRAM-MD5 auth success';
                    resultobj.process(jobinfo);
                    mail.quit(function(err, code, lines){});
                    return true;
                }
            });
        }else{
            debugMessage('error','check_smtp error unsupported auth fell through: '+sys.inspect(supportedAuth));
            clearTimeout(timeoutid);
            completed = true;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.success = false;
            jobinfo.results.message = 'No supported authentication found';
            resultobj.process(jobinfo);
            mail.quit(function(err, code, lines){});
            return true;
        }
    }

    function verifyExpiration(s){
        var cert = s.getPeerCertificate();
        if(cert.valid_to){
            var warningdays = parseInt(jobinfo.parameters.warningdays)*86400000; // seconds of warning.
            var willexpire = new Date(cert.valid_to).getTime();
            if(willexpire < jobinfo.results.end+warningdays){
                debugMessage('error','check_smtp cert expiring soon');
                clearTimeout(timeoutid);
                completed = true;
                jobinfo.results.statusCode = 451;
                jobinfo.results.success = false;
                jobinfo.results.message = 'Certificate expires '+cert.valid_to;
                resultobj.process(jobinfo);
                return false;
            }
        }else{
            debugMessage('error','check_smtp cert missing valid_to: '+sys.inspect(cert));
            clearTimeout(timeoutid);
            completed = true;
            jobinfo.results.statusCode = 451;
            jobinfo.results.success = false;
            jobinfo.results.message = 'Certificate missing valid_to';
            resultobj.process(jobinfo);
            return false;
        }
        return true;
    }

    function debugMessage(messageType, message){
        if(jobinfo.debug){
            logger.log(messageType,message);
        }
    }
    return true;
}