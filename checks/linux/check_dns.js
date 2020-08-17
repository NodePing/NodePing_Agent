/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_dns.js
 * DNS check
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
var dns = require('dns');
var ndns = require('native-dns');
var ipaddr = require('ipaddr.js');

var check = exports.check = function(jobinfo) {
    var timeout = config.timeout *1;
    if (jobinfo.parameters.threshold) {
        if (jobinfo.parameters.threshold < 1) jobinfo.parameters.threshold = 1;
        timeout = 1000 * parseInt(jobinfo.parameters.threshold);
    }
    if (timeout > 90000) timeout = 90000;
    if (!jobinfo.parameters.target || jobinfo.parameters.target == '') {
        jobinfo.parameters.target = '8.8.8.8';
    }
    //logger.log('info','Search Path: '+sys.inspect(ndns.platform.search_path));
    // What are we checking for?
    if (!jobinfo.parameters.targetip) {
        if (ipaddr.isValid(jobinfo.parameters.target)) {
            jobinfo.parameters.targetip = jobinfo.parameters.target;
        } else {
            if (jobinfo.toIP) { // Already been around this tree.
                jobinfo.toIP = false;
                debugMessage('info',"check_dns: Invalid DNS FQDN (looping) - "+jobinfo.parameters.target);
                jobinfo.results = {start: new Date().getTime()};
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.success = false;
                jobinfo.results.statusCode = 'error';
                jobinfo.results.message = 'Unable to resolve DNS server to IP';
                resultobj.process(jobinfo);
                return true;
            }
            jobinfo.toIP = true;
            debugMessage('info','check_dns: Gotta resolve the server '+jobinfo.parameters.target);
            // Look up this server
            dns.lookup(jobinfo.parameters.target,null, function(err,address) {
                if (address) {
                    debugMessage('info',"check_dns: Had to translate "+jobinfo.parameters.target+" to IP - got "+sys.inspect(address));
                    jobinfo.parameters.targetip = address;
                    check(jobinfo);
                    return true;
                } else {
                    debugMessage('info',"check_dns: DNS FQDN didn't resolve - "+jobinfo.parameters.target);
                    jobinfo.results = {start: new Date().getTime()};
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.success = false;
                    jobinfo.results.statusCode = 'error';
                    jobinfo.results.message = 'DNS server did not resolve';
                    resultobj.process(jobinfo);
                    return true;
                }
            });
            return true;
        }
    }
    if (!jobinfo.parameters.targetip) {
        debugMessage('error',"check_dns: Invalid targetip - "+sys.inspect(jobinfo));
        jobinfo.results = {start: new Date().getTime()};
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid target ip';
        resultobj.process(jobinfo, true);
        return true;
    }
    debugMessage('info','check_dns: Checking a server '+jobinfo.parameters.target);
    // We're checking a particular DNS server.  That uses the ndns module.
    var dnstype = 'ANY';
    if (jobinfo.parameters.dnstype && jobinfo.parameters.dnstype !== '') {
        dnstype = jobinfo.parameters.dnstype;
    }
    var port = 53;
    if (jobinfo.parameters.port && jobinfo.parameters.port !== '') {
        port = parseInt(jobinfo.parameters.port);
    }
    var dnstoresolve = 'google.com';
    if (jobinfo.parameters.dnstoresolve && jobinfo.parameters.dnstoresolve !== '' && jobinfo.parameters.dnstoresolve !== 'Optional') {
        dnstoresolve = jobinfo.parameters.dnstoresolve;
    }
    var transport = 'udp';
    if (jobinfo.parameters.transport && jobinfo.parameters.transport !== '') {
        transport = jobinfo.parameters.transport.toLowerCase();
        transport = (transport === 'udp') ? 'udp' : 'tcp';
    }
    var question = ndns.Question({
      name: dnstoresolve,
      type: dnstype
    });
    var killit = false;
    var myanswer, myerr;
    jobinfo.results = {start: new Date().getTime()};
    //logger.log('info','DNS: targetip:'+sys.inspect(jobinfo.parameters.targetip)+', type:'+sys.inspect(dnstype)+', dnstoresolve:'+sys.inspect(dnstoresolve));
    try {
        debugMessage('info','check_dns: Checking '+jobinfo.parameters.targetip+' on port '+port);
        jobinfo.results.diag = {
            "dns":{
                dnsserver:jobinfo.parameters.targetip,
                querytarget:dnstoresolve,
                querytype:dnstype}
            };
        var opts = {
            "question": question,
            server: { address: jobinfo.parameters.targetip, port: port, type: transport },
            "timeout": timeout,
            cache:false
        };
        if (jobinfo.parameters.hasOwnProperty('dnsrd')) {
            opts.rd = (jobinfo.parameters.dnsrd) ? 1 : 0;
            //logger.log('info','RD set to '+sys.inspect(opts.rd));
        }
        var req = ndns.Request(opts);
        req.on('timeout', function () {
            if (!killit) {
                jobinfo.results.end = new Date().getTime();
                killit = true;
                if (req) {
                    req.cancel();
                }
                debugMessage('info',"check_dns: setTimeout of "+timeout.toString()+" called on "+jobinfo._id);
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Timeout';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Timeout';
                resultobj.process(jobinfo);
            }
            return true;
        });

        req.on('message', function (err, answer) {
            debugMessage('info','check_dns: message is: '+sys.inspect(answer));
            myanswer = answer;
            myerr = err;
        });
        req.on('cancelled', function () {
            debugMessage('info','check_dns: cancelled');
        });
        req.on('end', function () {
            debugMessage('info','check_dns: End');
            if (killit) {
                return false;
            }
            killit = true;
            clearTimeout(timeoutid);
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            req.cancel();
            if (myanswer && myanswer._socket && myanswer._socket._socket && myanswer._socket._socket.readable) {
                myanswer._socket.close(); // killing a tcp connection
            }
            if (myerr) {
                debugMessage('error','check_dns: DNS on "error": '+sys.inspect(err.toString()));
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.success = false;
                jobinfo.results.message = "DNS error "+err.toString();
                jobinfo.results.diag.dns.error = err.toString();
                resultobj.process(jobinfo);
                return true;
            } else {
                debugMessage('info','check_dns: resolve response is: '+sys.inspect(myanswer));
                // Are we looking for a match?
                if (jobinfo.parameters.dnstoresolve && jobinfo.parameters.dnstoresolve != '') {
                    if (myanswer.answer.length < 1) {
                        debugMessage('error','check_dns: Error: Server responded but no result records.');
                        jobinfo.results.diag.dns.answer = [];
                        jobinfo.results.success = false;
                        jobinfo.results.message = 'No Resolution';
                        jobinfo.results.statusCode = 'Failed';
                        resultobj.process(jobinfo);
                        return true;
                    }
                    var dnstypeid = myanswer.question[0].type;
                    if (jobinfo.parameters.contentstring && jobinfo.parameters.contentstring !== '' && jobinfo.parameters.contentstring != 'Optional') {
                        debugMessage('info','check_dns: Found Result Records: '+sys.inspect(myanswer.answer));
                        // Does it match?
                        for (var i=0;i<myanswer.answer.length;i++) {
                            if (myanswer.answer[i].type == dnstypeid || dnstype == 'ANY') {
                                var found = false;
                                if (myanswer.answer[i].name == jobinfo.parameters.contentstring) {
                                    debugMessage('info','check_dns: '+jobinfo.parameters.contentstring+' equals "name" '+myanswer.answer[i].name);
                                    found = true;
                                } else if (myanswer.answer[i].address == jobinfo.parameters.contentstring) {
                                    debugMessage('info','check_dns: '+jobinfo.parameters.contentstring+' equals "address" '+myanswer.answer[i].address);
                                    found = true;
                                } else if (myanswer.answer[i].primary == jobinfo.parameters.contentstring) {
                                    debugMessage('info','check_dns: '+jobinfo.parameters.contentstring+' equals "primary" '+myanswer.answer[i].primary);
                                    found = true;
                                } else if (myanswer.answer[i].data == jobinfo.parameters.contentstring) {
                                    debugMessage('info','check_dns: '+jobinfo.parameters.contentstring+' equals "data" '+myanswer.answer[i].data);
                                    found = true;
                                } else if (myanswer.answer[i].exchange == jobinfo.parameters.contentstring) {
                                    debugMessage('info','check_dns: '+jobinfo.parameters.contentstring+' equals "exchange" '+myanswer.answer[i].exchange);
                                    found = true;
                                } else if (myanswer.answer[i].target == jobinfo.parameters.contentstring) {
                                    debugMessage('info','check_dns: '+jobinfo.parameters.contentstring+' equals "target" '+myanswer.answer[i].target);
                                    found = true;
                                }
                                if (found) {
                                    debugMessage('info','check_dns: We found '+jobinfo.parameters.contentstring);
                                    jobinfo.results.success = true;
                                    jobinfo.results.statusCode = 'Success';
                                    if (jobinfo.parameters.verify && jobinfo.parameters.verify !== 'false') {
                                        return dnssecCheck(jobinfo);
                                    }
                                    resultobj.process(jobinfo);
                                    return true;
                                }
                            }
                            debugMessage('info','check_dns: '+jobinfo.parameters.contentstring+' does not match '+sys.inspect(myanswer.answer[i.toString()]));
                        }
                        // No match, fail
                        jobinfo.results.success = false;
                        jobinfo.results.message = 'DNS does not match';
                        jobinfo.results.statusCode = 'Failure';
                        jobinfo.results.diag.dns.answer = prepAnswerForDiags(myanswer.answer);
                        jobinfo.results.diag.dns.expected = jobinfo.parameters.contentstring;
                        resultobj.process(jobinfo);
                        return true;
                    } else {
                        // Checking to resolve, but not looking for anything particular...
                        // But we need to make sure it returned something for what we asked for.
                        // Cause google will return an entry for the 'base' if the domain doesn't exist.
                        var found = false;
                        for (var i=0;i<myanswer.answer.length;i++) {
                            if (myanswer.answer[i].type == dnstypeid || dnstype == 'ANY') {
                                if (myanswer.answer[i].name == jobinfo.parameters.dnstoresolve) {
                                    found = true;
                                    break;
                                }
                            }
                        }
                        if (found) {
                            debugMessage('info','check_dns: We found '+jobinfo.parameters.contentstring);
                            jobinfo.results.success = true;
                            jobinfo.results.statusCode = 'Success';
                            jobinfo.results.message = 'Domain found';
                            if (jobinfo.parameters.verify && jobinfo.parameters.verify !== 'false') {
                                return dnssecCheck(jobinfo);
                            }
                        } else {
                            debugMessage('info','check_dns: We found no result for '+jobinfo.parameters.dnstoresolve);
                            jobinfo.results.success = false;
                            jobinfo.results.statusCode = 'Fail';
                            jobinfo.results.message = 'Domain not found';
                            jobinfo.results.diag.dns.answer = prepAnswerForDiags(myanswer.answer);
                        }
                        resultobj.process(jobinfo);
                        return true;
                    }
                } else {
                    // We're not looking to resolve anything particular, just checking the server.
                    debugMessage('info','check_dns: Server responded: '+sys.inspect(myanswer.answer));
                    jobinfo.results.success = true;
                    jobinfo.results.statusCode = 'Success';
                    jobinfo.results.message = 'Server Responded';
                    resultobj.process(jobinfo);
                    return true;
                }
            }
        });
        var timeoutid = setTimeout(function() {
            if(!killit){
                killit = true;
                if(req){
                    req.cancel();

                }
                debugMessage('info',"check_dns: setTimeout of "+timeout.toString()+" called on "+jobinfo._id);
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Timeout';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Timeout';
                jobinfo.results.diag.dns.error = 'Timeout';
                resultobj.process(jobinfo);
            }
            return true;
        }, timeout);
        req.send();
    }catch(ec){
        debugMessage('error','check_dns: caught '+sys.inspect(ec));
        clearTimeout(timeoutid);
        if (req) {
            req = null;
        }
        if (!killit) {
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Error';
            jobinfo.results.success = false;
            jobinfo.results.message = "Caught "+ec.toString();
            jobinfo.results.diag.dns.error = jobinfo.results.message;
            resultobj.process(jobinfo);
            killit = true;
        }
        return true;
    }
    return true;
}

var debugMessage = function(messageType, message) {
    if (config.debug) {
        logger.log(messageType,message);
    }
}

var prepAnswerForDiags = function(answer){
    for (var i=0;i<answer.length;i++) {
        if (answer[i] && answer[i].type) {
            answer[i].type = ndns.consts.qtypeToName(answer[i].type);
        }
        if (answer[i] && answer[i].class) {
            delete answer[i].class;
        }
    }
    return answer;
};

var dnssecCheck = function(jobinfo) {
    debugMessage('info',"check_dns: DNSSEC called for: "+sys.inspect(jobinfo._id));
    var childprocess = require('child_process');
    var receiveddata = false;
    var timeout = config.timeout *1;
    if(jobinfo.parameters.threshold){
        if(jobinfo.parameters.threshold < 1) jobinfo.parameters.threshold = 1;
        timeout = 1000 * parseInt(jobinfo.parameters.threshold);
    }
    if (timeout > 90000) timeout = 90000;
    var dnstype = 'ANY';
    if(jobinfo.parameters.dnstype && jobinfo.parameters.dnstype !== ''){
        dnstype = jobinfo.parameters.dnstype;
    }
    var dnstoresolve = 'google.com';
    if(jobinfo.parameters.dnstoresolve && jobinfo.parameters.dnstoresolve !== '' && jobinfo.parameters.dnstoresolve !== 'Optional'){
        dnstoresolve = jobinfo.parameters.dnstoresolve;
    }
    var spawn = childprocess.spawn,
        killit = false;
    try {
        var timeoutid = setTimeout(function() {
            if(killit){
                return true;
            }
            killit = true;
            if(digo){
                digo.kill('SIGKILL');
                digo = null;
            }
            debugMessage('info',"check_dns: DNSSEC setTimeout called.");
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Timeout';
            jobinfo.results.success = false;
            jobinfo.results.message = 'DNSSEC Timeout';
            resultobj.process(jobinfo);
            return true;
        }, timeout);

        debugMessage('info','check_dns: dnstoresolve is: ' + sys.inspect(dnstoresolve));

        var digo  = spawn( 'dig', ['-t'+dnstype, '+dnssec', '@8.8.8.8', dnstoresolve]);

        digo.stdout.on('data', function (data) {
            if (receiveddata || killit) {
                killit = true;
                // Nothing to do here.
                debugMessage('info','check_dns: Receiving another "on" "data" ' + sys.inspect(data));
                if(digo){
                    digo.kill('SIGKILL');
                    digo = null;
                }
                return true;
            } else {
                receiveddata = true;
                killit = true;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                var lines = data.toString().split("\n");
                //debugMessage('info','check_dns: lines: ' + sys.inspect(lines));
                var verified =  false;
                for (var l in lines) {
                    if (lines[l].indexOf(';; flags:') === 0 && lines[l].indexOf(' ad') !== -1) {
                        debugMessage('info','check_dns: " ad" flag line: ' + sys.inspect(lines[l]));
                        verified = true;
                        jobinfo.results.message = 'DNSSEC Authenticated Data';
                        jobinfo.results.statusCode = 'Success: DNSSEC Authenticated Data';
                    }
                }
                if (!verified) {
                    jobinfo.results.statusCode = 'DNSSEC Failure';
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'DNSSEC authentication failed';
                }
                resultobj.process(jobinfo);
                //debugMessage('info','check_dns: Ping: latency below is ' + sys.inspect(latency));
                digo.kill('SIGKILL');
                digo = null;
                return true;
            }
        });

        digo.stderr.on('data', function (data) {
            debugMessage('info',"check_dns: stderr data: "+data.toString());
            receiveddata = true;
            if (!killit) {
                killit = true;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'DNSSEC error';
                jobinfo.results.success = false;
                jobinfo.results.message = data.toString();
                resultobj.process(jobinfo);
                if (digo) {
                    digo.kill('SIGKILL');
                    digo = null;
                }
            }
            return true;
        });
    } catch (errr) {
        if (!killit) {
            killit = true;
            if (digo) {
                try {
                    digo.kill('SIGKILL');
                    digo = null;
                } catch (digerr) {
                    logger.log('info',"check_dns: We caught a big error trying to kill dig: "+digerr.toString());
                }
            }
            logger.log('error',"check_dns: DNSSEC catch error: "+errr.toString());
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = 'DNSSEC catch error. Please contact support.';
            resultobj.process(jobinfo);
        }
        return true;
    }
    return true;
};
