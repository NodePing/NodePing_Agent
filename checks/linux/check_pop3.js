/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC

/*!
 * check_pop3.js
 * Basic pop3 check - do we get a '250' response?
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
var pop3client = require('nodeping-poplib');

var logger = console;

exports.check = function(jobinfo){
    //debugMessage('info',"Jobinfo passed to pop3 check: "+sys.inspect(jobinfo));
    var timeout =  config.timeout *1;
    if(jobinfo.parameters.threshold) timeout = parseInt(jobinfo.parameters.threshold)*1000;
    if (timeout > 90000) timeout = 90000;
    jobinfo.results = {start:new Date().getTime()};
    if(!jobinfo.parameters.target){
        debugMessage('info',"check_pop3: Invalid target");
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing a target';
        resultobj.process(jobinfo, true);
        return true;
    }else{
        var port = 110;
        if(jobinfo.parameters.port){
            port = parseInt(jobinfo.parameters.port);
        }
        debugMessage('info',"check_pop3: port: "+sys.inspect(port)+' on target '+sys.inspect(jobinfo.parameters.target));
        var useLogin = false;
        var username = 'nodepingusername'
        if(jobinfo.parameters.username){
            debugMessage('info',"check_pop3: setting user: "+sys.inspect(jobinfo.parameters.username));
            username = jobinfo.parameters.username;
            useLogin = true;
        }
        var password = 'nodepingpassword';
        if(jobinfo.parameters.password){
            password = jobinfo.parameters.password;
        }
        var secure  = undefined; // lib requires this instead of false
        if(jobinfo.parameters.secure && jobinfo.parameters.secure != 'false'){
            secure = {enabletls:true,ignoretlserrs:true};
            if(jobinfo.parameters.verify && jobinfo.parameters.verify != 'false'){
                secure.ignoretlserrs = false;
            }
        }
        var completed = false;
        var client = new pop3client(port, jobinfo.parameters.target, secure);
        var timeoutid = setTimeout(function() {
            debugMessage('error',"check_pop3: timeout");
            if(completed){
                return true;
            }
            completed = true;
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            client.quit();
            jobinfo.results.statusCode = 'timeout';
            jobinfo.results.success = false;
            jobinfo.results.message = 'Timeout';
            resultobj.process(jobinfo);
            return true;
        }, timeout+1000);
        client.on("error", function(err) {
            debugMessage('error',"check_pop3: Error: "+sys.inspect(err));
            if(completed){
                return true;
            }
            completed = true;
            clearTimeout(timeoutid);
            jobinfo.results.end = new Date().getTime();
            if(err.errno){
                jobinfo.results.statusCode = err.errno;
            }else{
                jobinfo.results.statusCode = 'error';
            }
            jobinfo.results.success = false;
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.message = sys.inspect(err);
            if (err.errno === 111){
                debugMessage('info', 'Unable to connect to: '+sys.inspect(jobinfo.parameters.target)+' on port '+sys.inspect(port));
                jobinfo.results.message = 'Unable to connect';
            } else if(err.errno == 'ENOTFOUND'){
                jobinfo.results.statusCode = 'error';
                jobinfo.results.message = 'Host not found';
            } else if(sys.inspect(err).indexOf('unknown protocol') > -1){
                jobinfo.results.message = 'SSL not running on port '+sys.inspect(port);
            }
            resultobj.process(jobinfo);
            return true;
        });
        client.on("connect", function() {
            debugMessage('info',"check_pop3: Connected to "+sys.inspect(jobinfo.parameters.target)+' on port '+sys.inspect(port));
            if(completed){
                return true;
            }
            if(secure && jobinfo.parameters.warningdays && !checkExpiration()){
                // cert failed expiration check.
                return false;
            }
            if(useLogin){
                debugMessage('info',"check_pop3: Trying to login with username "+sys.inspect(username)+' and password '+sys.inspect(password));
                client.login(username, password);
                return true;
            }
            completed = true;
            clearTimeout(timeoutid);
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.statusCode = 'Connected';
            jobinfo.results.success = true;
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            if(jobinfo.results.runtime > timeout){
                jobinfo.results.success = false;
                jobinfo.results.statusCode = 'timeout';
                jobinfo.results.message = 'Timeout';
            }
            client.quit();
            resultobj.process(jobinfo);
            return true;

        });
        client.on("tls-error", function(error) {
            debugMessage('info',"check_pop3: tls-error from "+sys.inspect(jobinfo.parameters.target)+' with error '+sys.inspect(error)+' and cert '+sys.inspect(client.data.peerCert));
            if(completed){
                return true;
            }
            if(!jobinfo.parameters.verify || jobinfo.parameters.verify == 'false'){
                return true;
            }
            completed = true;
            clearTimeout(timeoutid);
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.statusCode = 'Error';
            jobinfo.results.success = false;
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.message = 'SSL Cert error: '+sys.inspect(error);
            client.quit();
            resultobj.process(jobinfo);
            return true;
        });
        client.on("login", function(status, rawdata) {
            debugMessage('info',"check_pop3: login event from "+sys.inspect(jobinfo.parameters.target)+' with status '+sys.inspect(status));
            if(completed){
                return true;
            }
            completed = true;
            clearTimeout(timeoutid);
            jobinfo.results.end = new Date().getTime();
            if (status) {
                jobinfo.results.statusCode = 'Login success';
                jobinfo.results.success = true;
                debugMessage('info',"check_pop3: login success from "+sys.inspect(jobinfo.parameters.target)+' with status '+sys.inspect(status));
            } else {
                jobinfo.results.statusCode = 'Login failure';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Login failure';
                debugMessage('info',"check_pop3: login failure from "+sys.inspect(jobinfo.parameters.target)+' with status '+sys.inspect(status));
            }
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            if(jobinfo.results.runtime > timeout){
                jobinfo.results.success = false;
                jobinfo.results.statusCode = 'timeout';
                jobinfo.results.message = 'Timeout';
            }
            client.quit();
            resultobj.process(jobinfo);
            return true;
        });
    }
    function checkExpiration(){
        debugMessage('info',"check_pop3: Checking cert expiration for "+sys.inspect(jobinfo.parameters.target)+' with cert '+sys.inspect(client.data.peerCert));
        var cert = client.data.peerCert;
        if(cert && cert.valid_to){
            jobinfo.results.end = new Date().getTime();
            var warningdays = parseInt(jobinfo.parameters.warningdays)*86400000; // seconds of warning.
            var willexpire = new Date(cert.valid_to).getTime();
            if(willexpire < jobinfo.results.end+warningdays){
                completed = true;
                clearTimeout(timeoutid);
                debugMessage('error','check_smtp cert expiring soon');
                jobinfo.results.statusCode = 'error';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Certificate expires '+cert.valid_to;
                resultobj.process(jobinfo);
                client.quit();
                return false;
            }
        }else{
            completed = true;
            clearTimeout(timeoutid);
            debugMessage('error','check_smtp cert missing valid_to: '+sys.inspect(cert));
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.statusCode = 'error';
            jobinfo.results.success = false;
            jobinfo.results.message = 'Certificate missing valid_to';
            resultobj.process(jobinfo);
            client.quit();
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
};