/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_ftp.js
 * Basic FTP check
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout:10000              // Can be overriden by a parameter
};

var jsftp = require('jsftp');
var resultobj = require('../results.js');
var sys = require('util');
var logger = console;
var nputil = require('../../nputil');

exports.check = function(jobinfo){
    //logger.log('info',"Jobinfo passed to ping check: "+sys.inspect(jobinfo));
    var timeout =  config.timeout *1;
    if(jobinfo.parameters.threshold) timeout = parseInt(jobinfo.parameters.threshold)*1000;
    if (timeout > 90000) timeout = 90000;
    jobinfo.results = {start:new Date().getTime()};
    if(!jobinfo.parameters.target){
        //logger.log('info',"check_ftp: Invalid target on: "+sys.inspect(jobinfo));
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing a target';
        resultobj.process(jobinfo, true);
        return true;
    }else{

        var ftpport =  21;
        if(jobinfo.parameters.port){
            ftpport = parseInt(jobinfo.parameters.port);
        }
        var justportchecking = false;
        var username = 'anonymous';
        if(jobinfo.parameters.username){
            username = jobinfo.parameters.username;
        }else{
            justportchecking = true;
        }
        var password = 'anonymous@nodeping.com';
        if(jobinfo.parameters.password){
            password = jobinfo.parameters.password;
        }else{
            justportchecking = true;
        }
        var ftpcreds = {host:jobinfo.parameters.target,
                        user:username,
                        pass:password,
                        port:ftpport};
        // Let's talk to an FTP server, shall we?
        try{

            var completed = false;
            var ftp = new jsftp(ftpcreds);
            var quitftp = function(){
                //logger.log('info',"check_ftp: quitftp called.");
                //logger.log("info","check_ftp: FTP before quit is: "+sys.inspect(ftp));
                if(ftp){
                    //logger.log('info',"check_ftp: ftp exists for quit: "+sys.inspect(ftp,false,4));
                    ftp.raw.quit(function(err, res) {
                        if (err){
                            //logger.log("info","check_ftp: FTP session quit with error: "+sys.inspect(err.toString()));
                        }else{
                            //logger.log("info","check_ftp: FTP session quit with res: "+sys.inspect(res));
                        }
                        try{
                            ftp.destroy();
                            //logger.log("info","check_ftp: FTP before socket destroy is: "+sys.inspect(ftp));
                            if(ftp.socket && !ftp.socket.destroyed){
                                ftp.socket.destroy();
                            }
                            //logger.log('info',"check_ftp: ftp destroyed");
                        }catch(desterror){
                            logger.log("error","check_ftp: FTP destroy error: "+sys.inspect(desterror.toString()));
                        }
                        ftp = null;
                        //logger.log('info',"check_ftp: ftp at the end of things: "+sys.inspect(ftp,false,4));
                        return true;
                    });
                }else{
                    //logger.log('info',"check_ftp: ftp does not exits for quit: "+sys.inspect(ftp,false,4));
                }
                return true;
            }
            // Set the timer for this ugly dood.
            var timeoutid = setTimeout(function() {
                quitftp();
                if(!completed){
                    completed = true;
                    //logger.log('info',"check_ftp: setTimeout called.");
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Timeout';
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'Timeout';
                    resultobj.process(jobinfo);
                    //logger.log('info',"check_ftp: sent for processing #6");
                }
                return true;
            }, timeout);
            ftp.auth(ftpcreds.user, ftpcreds.pass, function(err, res) {
                if (err){
                    if(!completed){
                        completed = true;
                        clearTimeout(timeoutid);
                        jobinfo.results.end = new Date().getTime();
                        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                        quitftp();
                        //logger.log('error',"check_ftp: Login error: "+err);
                        // Login error?
                        if(justportchecking && err == 'Error: Login not accepted'){
                            //logger.log('info',"check_ftp: Login failure but we don't care.");
                            jobinfo.results.statusCode = 'Connected';
                            jobinfo.results.success = true;
                            jobinfo.results.message = "FTP connected but login failed";
                        }else{
                            jobinfo.results.statusCode = 'error';
                            jobinfo.results.success = false;
                            jobinfo.results.message = "Failed: "+err;
                        }
                        resultobj.process(jobinfo);
                        //logger.log('info',"check_ftp: sent for processing #5");
                    }else{
                        quitftp();
                    }
                    return true;
                }else if(jobinfo.parameters.contentstring && jobinfo.parameters.contentstring !== '' && !completed){
                    //logger.log('info',"check_ftp: Going to look for a file");
                    ftp.ls(jobinfo.parameters.contentstring, function(err, result){
                        //logger.log('info',"check_ftp: ls results: "+sys.inspect(result));
                        //logger.log('info',"check_ftp: ls error: "+sys.inspect(err));
                        if(!completed){
                            completed = true;
                            clearTimeout(timeoutid);
                            if(err || !result || (nputil.gettype(result) === 'array' && !result.length)){
                                //logger.log('error',"check_ftp: Error for ls: "+sys.inspect(err));
                                jobinfo.results.end = new Date().getTime();
                                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                                jobinfo.results.statusCode = 'File not found';
                                jobinfo.results.success = false;
                                if(jobinfo.parameters.invert){
                                    // Good, this file isn't supposed to be here.
                                    jobinfo.results.success = true;
                                    if(result && result.code){
                                        jobinfo.results.statusCode = result.code;
                                    }
                                }
                                jobinfo.results.message = 'File not found:';
                                if (err) {
                                    jobinfo.results.message = jobinfo.results.message+' '+err.toString();
                                }
                                resultobj.process(jobinfo);
                                quitftp();
                                return true;
                            }
                            //logger.log('error',"check_ftp: response for ls: "+sys.inspect(result));
                            if(result){
                                jobinfo.results.end = new Date().getTime();
                                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                                jobinfo.results.statusCode = 'Found';
                                jobinfo.results.message = 'File found';
                                if(jobinfo.parameters.invert){
                                    // Oh- this file isn't supposed to exist!
                                    jobinfo.results.success = false;
                                }else{
                                    jobinfo.results.success = true;
                                }
                                if(jobinfo.results.runtime > timeout){
                                    jobinfo.results.success = false;
                                    jobinfo.results.statusCode = 'timeout';
                                    jobinfo.results.message = 'Timeout';
                                }
                                resultobj.process(jobinfo);
                                quitftp();
                                return true;
                            }else{
                                //logger.log('error',"check_ftp: Failed content check");
                                jobinfo.results.end = new Date().getTime();
                                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                                jobinfo.results.statusCode = 'Failed';
                                jobinfo.results.success = false;
                                jobinfo.results.message = "Failed content check";
                                resultobj.process(jobinfo);
                                quitftp();
                            }
                        }else{
                            quitftp();
                        }
                        return true;
                    });
                }else{
                    if(!completed){
                        completed = true;
                        clearTimeout(timeoutid);
                        jobinfo.results.end = new Date().getTime();
                        jobinfo.results.statusCode = 'Logged in';
                        jobinfo.results.success = true;
                        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                        if(jobinfo.results.runtime > timeout){
                            jobinfo.results.success = false;
                            jobinfo.results.statusCode = 'timeout';
                            jobinfo.results.message = 'Timeout';
                        }
                        resultobj.process(jobinfo);
                        quitftp();
                    }else{
                        quitftp();
                    }
                }
                return true;
            });
            return true;
        }catch(error){
            if(completed){
                quitftp();
                logger.log('info',"check_ftp: Caught completed error: "+error.toString());
                return true;
            }else{
                logger.log('error',"check_ftp: Caught error: "+error.toString());
            }
            quitftp();
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = error.toString();
            resultobj.process(jobinfo);
            return true;
        }
        return true;
    }
    return true;
}