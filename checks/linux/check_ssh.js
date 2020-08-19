/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_ssh.js
 * Basic ssh check.
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout:3000              // Can be overriden by a parameter
};

var resultobj = require('../results.js');
var sys = require('util');
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var logger = console;


exports.check = function(jobinfo){

    //logger.log('info',"Jobinfo passed to ping check: "+sys.inspect(jobinfo));
    //if(jobinfo.parameters.threshold) config.timeout = jobinfo.parameters.threshold;
    var timeout = config.timeout * 1;
    if(jobinfo.parameters.threshold){
        if(jobinfo.parameters.threshold < 1) jobinfo.parameters.threshold = '3';
        timeout = parseInt(jobinfo.parameters.threshold) * 1000;
        if (timeout > 90000) timeout = 90000;
    }
    var validationerrors = [];
    var port =  22;
    if(jobinfo.parameters.port){
        port = parseInt(jobinfo.parameters.port);
    }
    var justchecking = false;
    var username = 'NodePingTest';
    if(jobinfo.parameters.username){
        // Validate
        if ( jobinfo.parameters.username.match(/[^\w-]/) ) validationerrors.push("Username contains invalid characters.");
        username = jobinfo.parameters.username;
    }else{
        justchecking = true;
    }
    var password = 'NodePingPassword';
    if(jobinfo.parameters.password){
        // escape special characters
        //logger.log('info',"check_ssh: Password: "+jobinfo.parameters.password);
        password = jobinfo.parameters.password.replace(/\\/g, '\\\\');
        password = password.replace(/\"/g, '\\"');
        password = password.replace(/\`/g, '\\`');
        //logger.log('info',"check_ssh: Password after escape: "+password);
        if ( password.match(/[ \$]/ )) validationerrors.push("Password cannot contain spaces or dollar signs.");
    } else {
        justchecking = true;
    }
    if ( jobinfo.parameters.target.match(/[ \$;"]/ )) validationerrors.push("Hostname cannot contain spaces, dollar signs, semicolons, or double quotes.");
    jobinfo.results = {start:new Date().getTime()};
    if(validationerrors.length > 0){
        //logger.log('info',"check_ssh: Invalid configuration");
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = sys.inspect(validationerrors);
        resultobj.process(jobinfo, true);
        return true;
    }else{
        var command;
        var timeoutSec = timeout/1000;
        // Do we have a username and password?
        if(justchecking){
            // We don't expect to be able to log in but we need to get a proper failure.
            command = 'ssh -t -t -p '+port.toString()+' -o ConnectTimeout='+timeoutSec.toString()+' -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -o ChallengeResponseAuthentication=no -o KbdInteractiveAuthentication=no -o PasswordAuthentication=no -o KexAlgorithms=+diffie-hellman-group1-sha1,diffie-hellman-group14-sha1,diffie-hellman-group14-sha256,diffie-hellman-group16-sha512,diffie-hellman-group18-sha512,diffie-hellman-group-exchange-sha1,diffie-hellman-group-exchange-sha256,ecdh-sha2-nistp256,ecdh-sha2-nistp384,ecdh-sha2-nistp521,curve25519-sha256,curve25519-sha256@libssh.org -o Ciphers=+3des-cbc,aes128-cbc,aes192-cbc,aes256-cbc,rijndael-cbc@lysator.liu.se,aes128-ctr,aes192-ctr,aes256-ctr,aes128-gcm@openssh.com,aes256-gcm@openssh.com,chacha20-poly1305@openssh.com '+jobinfo.parameters.target;
        }else{
            // Use expect to try a login.
            command = 'expect '+__dirname+'/sshExpectScript.exp '+jobinfo.parameters.target+' '+username+' "'+password+'" '+port.toString()+' '+timeoutSec.toString();
        }
        try{
            //logger.log('info',"check_ssh: About to spawn: "+sys.inspect(jobinfo));
            //logger.log('info',"check_ssh: command: "+sys.inspect(command));
            var loggedin = false;
            var killedit = false;
            var ssho = exec(command, function(error, stdout, stderr){
                if(killedit){
                    return true;
                }
                killedit = true;
                clearTimeout(timeoutid);
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                if(error){
                    //logger.log('error',"check_ssh: error: "+sys.inspect(error.toString()));
                    if(justchecking){
                        //logger.log('error',"check_ssh: Just Checking");
                        // Might be ok - just a key login failure, which is expected.
                        if(error.toString().indexOf('Permission denied') > -1){
                            // I think this means we tried to log in and got a proper response.
                            jobinfo.results.statusCode = 'Connected';
                            jobinfo.results.message = 'SSH connected but login failed';
                            jobinfo.results.success = true;
                            resultobj.process(jobinfo);
                            return true;
                        }
                    }
                    jobinfo.results.statusCode = 'Error';
                    var errormessage = '';
                    if (error.toString().indexOf('Connection refused') > -1) {
                        errormessage = 'Connection refused';
                    } else if (error.toString().indexOf('Connection timed out') > -1) {
                        errormessage = 'Connection timed out';
                    } else {
                        errormessage = error.toString().replace(command,'').replace('/bin/sh -c ssh: ','');
                    }
                    jobinfo.results.message = errormessage;
                    jobinfo.results.success = false;
                    //logger.log('error',"check_ssh: Error to process: "+sys.inspect(jobinfo));
                    resultobj.process(jobinfo);
                    return true;
                }else if(stdout){
                    //logger.log('info',"check_ssh: stdout: "+sys.inspect(stdout.toString()));
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    var data = stdout.toString();
                    if(data.indexOf('Logged in') > -1){
                        loggedin = true;
                    }else if(data.indexOf('Login failed') > -1){
                        loggedin = false;
                        if(justchecking){
                            // We don't care if the login failed.  SSH is working so we're good.
                            //logger.log('info','check_ssh: Login but we do not care');
                            jobinfo.results.statusCode = 'Connected';
                            jobinfo.results.message = 'SSH connected but login failed';
                            jobinfo.results.success = true;
                        }else{
                            //logger.log('info','check_ssh: Login failed and we care about that!');
                            jobinfo.results.statusCode = 'Failed';
                            jobinfo.results.message = 'SSH connected but login failed';
                            jobinfo.results.success = false;
                        }
                        resultobj.process(jobinfo);
                        return true;
                    }
                    if(data.indexOf('Failed to connect') > -1){
                        jobinfo.results.statusCode = 'Failed to connect';
                        jobinfo.results.message = 'Unable to connect';
                        jobinfo.results.success = false;
                        resultobj.process(jobinfo);
                        return true;
                    }
                    if(jobinfo.parameters.contentstring && jobinfo.parameters.contentstring != ''){
                        if(data.indexOf(jobinfo.parameters.contentstring) > -1){
                            jobinfo.results.statusCode = 'Content found';
                            jobinfo.results.success = true;
                            jobinfo.results.message = 'Found content string in login reply';
                            if(jobinfo.parameters.invert){
                                jobinfo.results.success = false;
                            }
                        }else{
                            jobinfo.results.statusCode = 'Content missing';
                            jobinfo.results.message = 'Content string not found in login reply';
                            jobinfo.results.success = false;
                            if(jobinfo.parameters.invert){
                                jobinfo.results.success = true;
                            }
                        }
                        resultobj.process(jobinfo);
                        return true;
                    }
                    jobinfo.results.statusCode = 'Logged in';
                    jobinfo.results.success = true;
                    resultobj.process(jobinfo);
                    return true;
                }else if(stderr){
                    //logger.log('error',"check_ssh: stderr: "+sys.inspect(stderr.toString()));
                    jobinfo.results.statusCode = 'Error';
                    jobinfo.results.message = 'Error: '+sys.inspect(stderr.toString());
                    jobinfo.results.success = false;
                    resultobj.process(jobinfo);
                    return true;
                }
                return true;
            });
            var timeoutid = setTimeout(function() {
                if(killedit){
                    return true;
                }
                killedit = true;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                if(ssho){
                    ssho.kill('SIGKILL');
                    ssho = null;
                }
                jobinfo.results.statusCode = 'Timeout';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Timeout';
                if(loggedin){
                    // We connected but we timed out?  Must be a busy login script.
                    //logger.log('info',"check_ssh: setTimeout called after good login.");
                    jobinfo.results.message = 'Timeout after successful login';
                }
                resultobj.process(jobinfo);
                return true;
            }, timeout+1000);
        }catch(errr){
            if(killedit){
                return false;
            }
            killedit = true;
            if(timeoutid){
                clearTimeout(timeoutid);
            }
            if(ssho){
                try{
                    ssho.kill('SIGKILL');
                    ssho = null;
                }catch(ssherr){
                    logger.log('info',"check_ssh: We caught a big error trying to kill ssh on job "+jobinfo.jobid+": "+ssherr.toString());
                }
            }
            logger.log('error',"check_ssh: Caught error on job "+jobinfo.jobid+": "+errr.toString());
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = errr.toString();
            resultobj.process(jobinfo);
            return true;
        }
        return true;
    }
};
