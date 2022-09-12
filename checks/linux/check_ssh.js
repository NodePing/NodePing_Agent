/*!
 * NodePing
 * Copyright(c) 2011 NodePing LLC
 */

/*!
 * check_ssh.js
 * ssh check
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
const { Client } = require('ssh2');
var logger = console;
var net = require('net');
var dns = require('dns');
var agentconfig = require('../../config.json');
var querystring = require('querystring');
var nputil = require("../../nputil");

var check = exports.check = function(jobinfo) {

    //logger.log('info',"Jobinfo passed to ping check: "+sys.inspect(jobinfo));
    //if(jobinfo.parameters.threshold) config.timeout = jobinfo.parameters.threshold;
    var timeout = config.timeout * 1;
    if (jobinfo.parameters.threshold) {
        if (jobinfo.parameters.threshold < 1) jobinfo.parameters.threshold = '3';
        timeout = parseInt(jobinfo.parameters.threshold) * 1000;
        if (timeout > 60000) timeout = 60000;
    }
    var validationerrors = [];
    var port =  22;
    if (jobinfo.parameters.port) {
        port = parseInt(jobinfo.parameters.port);
    }
    var justchecking = false;
    var username = 'nodeping';
    if (jobinfo.parameters.username) {
        username = jobinfo.parameters.username;
    } else {
        justchecking = true;
    }
    var password = 'NodePingPassword';
    if (jobinfo.parameters.password) {
        password = jobinfo.parameters.password;
    } else {
        justchecking = true;
    }
    if ( jobinfo.parameters.target.match(/[ \$;"]/ )) validationerrors.push("Hostname cannot contain spaces, dollar signs, semicolons, or double quotes.");
    jobinfo.results = {start:new Date().getTime(), diag:{ssh:{}}};
    if (validationerrors.length > 0) {
        //logger.log('info',"check_ssh: Invalid configuration");
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = sys.inspect(validationerrors);
        resultobj.process(jobinfo, true);
        return true;
    }
    var tryIpv6 =  function() {
        jobinfo.dnsresolutionstart = new Date().getTime();
        dns.resolve6(jobinfo.parameters.target, function (err, addresses) {
            jobinfo.dnsresolutionend = new Date().getTime();
            if (err) {
                jobinfo.results.success = false;
                jobinfo.results.end = new Date().getTime();jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.message = 'Error resolving '+jobinfo.parameters.target;
                if (err.code === 'ENODATA') {
                    jobinfo.results.message = 'No addresses found for '+jobinfo.parameters.target;
                } else if (err.code === 'ENOTFOUND') {
                    jobinfo.results.message = 'No DNS resolution for '+jobinfo.parameters.target;
                }
                resultobj.process(jobinfo);
            } else if (addresses && addresses[0]) {
                jobinfo.targetip = addresses[0];
                return check(jobinfo, true);
            } else { // no resolution - empty array returned.
                jobinfo.results.success = false;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.message = 'No DNS addresses found for '+jobinfo.parameters.target;
                resultobj.process(jobinfo);
            }
            return true;
        });
        return true;
    };

    if (!jobinfo.targetip) {
        if (jobinfo.parameters.ipv6) {
            if (!net.isIPv6(jobinfo.parameters.target)) {
                return tryIpv6();
            } else {
                jobinfo.targetip = jobinfo.parameters.target;
            }
        } else {
            // Resolve the ipv4
            if (!net.isIPv4(jobinfo.parameters.target) && !net.isIPv6(jobinfo.parameters.target)) {
                jobinfo.dnsresolutionstart = new Date().getTime();
                dns.resolve4(jobinfo.parameters.target, function (err, addresses) {
                    jobinfo.dnsresolutionend = new Date().getTime();
                    if (err) {
                        //logger.log('info','check_ssh: resolution error: '+sys.inspect(err));
                        //logger.log('info','check_ssh: resolution addresses: '+sys.inspect(addresses));
                        if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
                            return tryIpv6();
                        }
                        jobinfo.results.success = false;
                        jobinfo.results.end = new Date().getTime();
                        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                        jobinfo.results.statusCode = 'Error';
                        jobinfo.results.message = 'Error resolving the hostname: '+jobinfo.parameters.target;
                        resultobj.process(jobinfo);
                    } else if (addresses && addresses.length && addresses[0]) {
                        //logger.log('info','check_ssh: resolution addresses: '+sys.inspect(addresses));
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
            } else {
                jobinfo.targetip = jobinfo.parameters.target;
            }
        }
    }

    jobinfo.results.diag.ssh.serverip = jobinfo.targetip;
    jobinfo.results.diag.ssh.port = port;

    if (jobinfo.parameters.sshkey) {
        justchecking = false;
        // We need to authenticate with an SSH private key
        if (!jobinfo.sshkeyinfo) {
            return getSSHKeyInfo(jobinfo);
        }
    }

    const conn = new Client();
    var connectionOptions = {
        host: jobinfo.targetip, 
        port: port, 
        username: username, 
        readyTimeout: timeout,
        /*
        algorithms: {
            cipher:{append:['3des-cbc','aes256-cbc','aes192-cbc','aes128-cbc','arcfour256','arcfour128','arcfour','blowfish-cbc','cast128-cbc']},
            hmac:{append:['hmac-md5','hmac-sha2-256-96','hmac-sha2-512-96','hmac-ripemd160','hmac-sha1-96','hmac-md5-96']},
            kex:{append:['diffie-hellman-group-exchange-sha1','diffie-hellman-group14-sha1','diffie-hellman-group1-sha1']}
        },
        */
        authHandler: []
    };
    if (jobinfo.parameters.sshkey && jobinfo.sshkeyinfo) {
        if (jobinfo.sshkeyinfo.error || !jobinfo.sshkeyinfo.key) {
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = jobinfo.sshkeyinfo.error || 'SSH key error';
            delete jobinfo.sshkeyinfo;
            resultobj.process(jobinfo, true);
            return true;
        } else {
            connectionOptions.privateKey = jobinfo.sshkeyinfo.key;
            jobinfo.results.diag.ssh.UsePrivateKey = true;
            connectionOptions.authHandler.push({type: 'publickey', username:username, key: jobinfo.sshkeyinfo.key})
        }
    } else {
        if (justchecking) {
            connectionOptions.authHandler.push({type: 'none', username:username});
        } else {
            connectionOptions.password = password;
            jobinfo.results.diag.ssh.UsePassword = true;
            connectionOptions.authHandler.push({type: 'password', username:username,password:password});
            connectionOptions.authHandler.push({type: 'keyboard-interactive', username: username, prompt:(name, instructions, instructionsLang, prompts, finish) => { finish([password]);}});
            connectionOptions.tryKeyboard = true;
        }
    }

    
    //connectionOptions.debug = function(debugstring){logger.log('info','SSH :: debug: '+sys.inspect(debugstring));};
    

    //logger.log('info','SSH :: connectionOptions: '+sys.inspect(connectionOptions));

    var handshakeComplete = false;
    var allDone = false;

    conn.on('ready', () => {
        if (allDone) {
            //logger.log('error','SSH :: ready after allDone');
            return true;
        }
        allDone = true;
        if (jobinfo.sshkeyinfo) delete jobinfo.sshkeyinfo;
        //logger.log('info','SSH :: ready');
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        var finished = false;
        var loggedin = true;
        var shelldata = '';
        conn.shell((err, stream) => {
            if (err) {
                //logger.log('error','SSH :: shell error: '+sys.inspect(err));
                if (finished) return true;
                finished = true;
                jobinfo.results.statusCode = 'Shell error';
                jobinfo.results.success = false;
                resultobj.process(jobinfo);
                conn.end();
                return true;
            } else {
                stream.on('close', (code, signal) => {
                    //logger.log('info','Shell Stream :: close :: code: ' + code + ', signal: ' + signal);
                    if (finished) return true;
                    finished = true;
                    if (jobinfo.parameters.contentstring && jobinfo.parameters.contentstring != '') {
                        if (shelldata.indexOf(jobinfo.parameters.contentstring) > -1) {
                            jobinfo.results.statusCode = 'Content found';
                            jobinfo.results.success = true;
                            jobinfo.results.message = 'Found content string in login reply';
                            if (jobinfo.parameters.invert) {
                                jobinfo.results.success = false;
                            }
                        } else {
                            jobinfo.results.statusCode = 'Content missing';
                            jobinfo.results.message = 'Content string not found in login reply';
                            jobinfo.results.success = false;
                            if (jobinfo.parameters.invert) {
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
                }).on('data', (data) => {
                    //logger.log('info','Shell STDOUT: ' + data);
                    shelldata += data;
                    conn.end();
                }).stderr.on('data', (data) => {
                    //logger.log('info','Shell STDERR: ' + data);
                    shelldata += data;
                    if (finished) return true;
                    finished = true;
                    conn.end();
                    jobinfo.results.statusCode = 'Error';
                    jobinfo.results.message = 'Error: '+sys.inspect(stderr.toString());
                    jobinfo.results.success = false;
                    resultobj.process(jobinfo);
                    return true;
                });
            }
        });
    }).on('close', () => {
        //logger.log('info','SSH :: close');
        if (allDone) {
            //logger.log('error','SSH :: close after allDone';
            return true;
        }
        allDone = true;
        if (!jobinfo.results.end) {
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        }
        if (jobinfo.sshkeyinfo) delete jobinfo.sshkeyinfo;
        jobinfo.results.statusCode = 'Error';
        jobinfo.results.message = 'SSH connection closed by server';
        jobinfo.results.success = false;
        if (justchecking) {
            //logger.log('error',"check_ssh: Just Checking");
            jobinfo.results.statusCode = 'Connected';
            jobinfo.results.success = true;
        }
        resultobj.process(jobinfo);
        return true;
    }).on('error', (er) => {
        if (allDone) {
            //logger.log('error','SSH :: error after allDone: '+sys.inspect(er));
            return true;
        }
        allDone = true;
        //logger.log('error','SSH :: error: '+sys.inspect(er));
        //logger.log('error','SSH :: error tostring: '+er.toString());
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        conn.end();
        if (jobinfo.sshkeyinfo) delete jobinfo.sshkeyinfo;
        if (justchecking) {
            //logger.log('error',"check_ssh: Just Checking");
            // Might be ok - just a key login failure, which is expected.
            if (er.level && er.level === 'client-authentication' || (er.level === 'client-timeout' && handshakeComplete)) {
                // I think this means we tried to log in and got a proper response.
                jobinfo.results.end = handshakeComplete;
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Connected';
                jobinfo.results.message = 'SSH connected but login failed';
                jobinfo.results.success = true;
                resultobj.process(jobinfo);
                return true;
            }
        }
        jobinfo.results.statusCode = 'Error';
        var errormessage = er.toString();
        if (errormessage.indexOf('ECONNREFUSED') > -1) {
            errormessage = errormessage.replace('ECONNREFUSED','Connection refused');
        } else if (er.level === 'client-timeout') {
            jobinfo.results.statusCode = 'Timeout';
            if (handshakeComplete) {
                errormessage = 'handshake completed but auth not responding';
            } else {
                errormessage = 'Connection timed out';
            }
        } else if (errormessage === 'Error: All configured authentication methods failed') {
            if (connectionOptions.privateKey) {
                errormessage = 'SSH private key authentication failed';
            } else {
                errormessage = 'Password authentication failed'
            }
        } 
        jobinfo.results.message = errormessage;
        jobinfo.results.success = false;
        //logger.log('error',"check_ssh: Error to process: "+sys.inspect(jobinfo));
        resultobj.process(jobinfo);
        return true;
    }).on('banner', (banner, language) => {
        //logger.log('info','SSH :: banner: '+sys.inspect(banner)+" : "+sys.inspect(language));
        jobinfo.results.diag.ssh.banner = banner;
    }).on('handshake', (negotiated) => {
        //logger.log('info','SSH :: handshake: '+sys.inspect(negotiated));
        jobinfo.results.diag.ssh.handshake = negotiated;
        handshakeComplete = new Date().getTime();
    }).on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
        var answers = [];
        for (var i in prompts) {
            if (prompts[i].prompt.toLowerCase() === 'password') {
                answers.push(password);
            }
        }
        return finish(answers);
    });
    try {
        conn.connect(connectionOptions);
    } catch (ex) {
        if (allDone) {
            //logger.log('error','SSH :: caught error after allDone: '+sys.inspect(ex));
            return true;
        }
        allDone = true;
        if (jobinfo.sshkeyinfo) delete jobinfo.sshkeyinfo;
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = ex.toString();
        resultobj.process(jobinfo);
        return true;
    }
    return true;
};

var debugMessage = function(messageType, message) {
    if (config.debug) {
        logger.log(messageType,message);
    }
}

var getSSHKeyInfo = function(jobinfo, retry) {
    retry = retry || 0;
    debugMessage('info',"check_ssh: fetching ssh key info from local config: "+jobinfo.parameters.sshkey);
    if (agentconfig && agentconfig.sshkeys && agentconfig.sshkeys[jobinfo.parameters.sshkey]) {
        var fs = require("fs");
        if (fs.existsSync(agentconfig.sshkeys[jobinfo.parameters.sshkey])) {
            try {
                var mykey = fs.readFileSync(agentconfig.sshkeys[jobinfo.parameters.sshkey], "utf8");
                debugMessage('error',"check_ssh: ssh key unreadable: "+agentconfig.sshkeys[jobinfo.parameters.sshkey]);
                jobinfo.sshkeyinfo = {key:mykey};
            } catch (err) {
                debugMessage('error',"check_ssh: ssh key unreadable: "+agentconfig.sshkeys[jobinfo.parameters.sshkey]);
                jobinfo.sshkeyinfo = {error:'key file unreadable on AGENT'};
            }
            return check(jobinfo);
        } else {
            debugMessage('error',"check_ssh: ssh key file does not exist: "+agentconfig.sshkeys[jobinfo.parameters.sshkey]);
            jobinfo.sshkeyinfo = {error:'key file does not exist on AGENT'};
            return check(jobinfo);
        }
    } else {
        debugMessage('error',"check_ssh: missing ssh key path in local config: "+jobinfo.parameters.sshkey);
        jobinfo.sshkeyinfo = {error:'no key data in AGENT config'};
        return check(jobinfo);
    }
};