/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_rbl.js
 * Check RBLs for entries
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout:22000              // Can be overriden by a parameter
};

var resultobj = require('../results.js');
var sys = require('util');
var logger = console;
var ndns = require('nodeping-dns');
var ipaddr = require('ipaddr.js');

var check = exports.check = function(jobinfo){
    var timeout = config.timeout *1;
    // We always use the checks configured timeout.
    if(!jobinfo.parameters.target){
        debugMessage('info',"check_rbl: False target - "+jobinfo.parameters.target);
        jobinfo.results = {start: new Date().getTime()};
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = 0;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing hostname';
        resultobj.process(jobinfo, true);
        return true;
    }

    if (!jobinfo.parameters.targetip) {
        if (ipaddr.isValid(jobinfo.parameters.target)) {
            jobinfo.parameters.targetip = jobinfo.parameters.target;
        } else {
            if(jobinfo.toIP){ // Already been around this tree.
                jobinfo.toIP = false;
                debugMessage('info',"check_rbl: Invalid target (looping) - "+jobinfo.parameters.target);
                jobinfo.results = {start: new Date().getTime()};
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = 0;
                jobinfo.results.success = false;
                jobinfo.results.statusCode = 'error';
                jobinfo.results.message = 'Invalid looping FQDN';
                resultobj.process(jobinfo);
                return true;
            }
            jobinfo.toIP = true;
            debugMessage('info','check_rbl: Gotta resolve the server '+jobinfo.parameters.target);
            // Look up this server
            ndns.lookup(jobinfo.parameters.target,null, function(err,address){
                if(address && address.length > 0){
                    debugMessage('info',"check_rbl: Had to translate "+jobinfo.parameters.target+" to IP - got "+sys.inspect(address));
                    jobinfo.parameters.targetip = address;
                    check(jobinfo);
                    return true;
                }else{
                    debugMessage('info',"check_rbl: Invalid target FQDN - "+jobinfo.parameters.target);
                    jobinfo.results = {start: new Date().getTime()};
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = 0;
                    jobinfo.results.success = false;
                    jobinfo.results.statusCode = 'error';
                    jobinfo.results.message = 'Invalid host - no dns resolution';
                    resultobj.process(jobinfo);
                    return true;
                }
            });
            return true;
        }
    }
    if(!jobinfo.parameters.targetip){
        debugMessage('error',"check_rbl: Invalid targetip - "+sys.inspect(jobinfo));
        jobinfo.results = {start: new Date().getTime()};
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = 0;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid target ip';
        resultobj.process(jobinfo);
        return true;
    }
    debugMessage('info','check_rbl: Checking '+jobinfo.parameters.targetip);
    var reverseip = reverseIp(jobinfo.parameters.targetip);
    var ip = jobinfo.parameters.targetip;
    if(!reverseip){
        debugMessage('error',"check_rbl: Invalid reverseip");
        jobinfo.results = {start: new Date().getTime()};
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = 0;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid reverse ip on processing. Please contact support';
        resultobj.process(jobinfo);
        return true;
    }
    var errors = [];

    var tests = ['veiknvhl3om2uka7y2oxktmfym.zen.dq.spamhaus.net',
                 'dnsbl.sorbs.net',
                 'spam.dnsbl.sorbs.net',
                 'b.barracudacentral.org',
                 'spamsources.fabel.dk',
                 'bl.spamcop.net',
                 'dnsrbl.swinog.ch',
                 'uribl.swinog.ch',
                 'cbl.abuseat.org',
                 'bogons.cymru.com',
                 'dnsbl.kempt.net',
                 'ubl.unsubscore.com',
                 'bl.mailspike.net',
                 'ix.dnsbl.manitu.net',
                 '0spam.fusionzero.com',
                 'psbl.surriel.com',
                 'spam.spamrats.com',
                 'backscatter.spameatingmonkey.net',
                 'bl.spameatingmonkey.net',
                 'bl.spamcop.net',
                 'truncate.gbudb.net',
                 'blacklist.woody.ch',
                 'db.wpbl.info',
                 'dnsbl-3.uceprotect.net',
                 'ips.backscatterer.org',
                 'virbl.bit.nl',
                 'orvedb.aupads.org'
                ];
    if(jobinfo.parameters.ignore && jobinfo.parameters.ignore.length > 0){
        var ignoreList = jobinfo.parameters.ignore.split(",");
        for(var ind in ignoreList){
            var entry = trim1white(ignoreList[ind]);
            var pos = tests.indexOf(entry);
            if(pos > -1){
                debugMessage('info',"check_rbl: ignoring: "+sys.inspect(entry));
                tests.splice(pos, 1);
            }
        }
    }
    function trim1white (str) {
        return str.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
    }
    jobinfo.results = {start: new Date().getTime()};
    var killit = false;
    var timeoutid = setTimeout(function() {
        if(killit){
            return true;
        }
        killit = true;
        logger.log('error',"check_rbl: setTimeout called: "+timeout.toString()+' for check '+jobinfo.jobid);
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.statusCode = 'Timeout';
        jobinfo.results.success = false;
        jobinfo.results.message = 'Timeout';
        resultobj.process(jobinfo);
        return true;
    }, timeout);
    var start = Date.now();
    runNextTest();

    function rblTest(testtype){
        var ipToLookup = reverseip+'.'+testtype;
        var req = ndns.Request({
            question: ndns.Question({
                name: ipToLookup,
                type: 'A'
            }),
            server: { address: '127.0.0.1', port: 53, type: 'udp' },
            timeout: 2000,
            cache:false
        });
        req.on('timeout', function () {
            logger.log('error',"check_rbl: ip: "+sys.inspect(ipToLookup)+" timed out for check "+jobinfo.jobid);
            runNextTest();
            return true;
        });

        req.on('error', function (err) {
            logger.log('error',"check_rbl: ip: "+sys.inspect(ipToLookup)+" errored out for check "+jobinfo.jobid+' :'+sys.inspect(err));
            runNextTest();
            return true;
        });

        req.on('message', function (err, answer) {
            debugMessage('info',"check_rbl: ip: "+sys.inspect(ipToLookup)+" returned address: "+sys.inspect(answer.answer)+' and error '+sys.inspect(err));
            if(answer.answer && answer.answer.length > 0){
                debugMessage('info',"check_rbl: ip: "+sys.inspect(ipToLookup)+" returned address: "+sys.inspect(answer.answer));
                var result = {};
                if (testtype.indexOf('spamhaus') > 0){
                    testtype = 'zen.spamhaus.org';
                }
                result[testtype] = answer.answer[0].address;
                errors.push(result);
            }else if(err){
                debugMessage('info',"check_rbl: ip: "+sys.inspect(ipToLookup)+" return error: "+sys.inspect(err));
                if(err.code && err.code == 'ENOTFOUND'){
                    // Cool, we're not listed.
                } else {
                    logger.log('error',"check_rbl: ip: "+sys.inspect(ipToLookup)+" return error: "+sys.inspect(err));
                }
            }else{
                debugMessage('info',"check_rbl: ip: "+sys.inspect(ipToLookup)+" returned no addresses and no  errors");
            }
            runNextTest();
            return true;
        });

        req.on('end', function () {
            var delta = (Date.now()) - start;
            debugMessage('info',"check_rbl: ip: "+sys.inspect(ipToLookup)+" finished at "+ delta.toString());
            return true;
        });

        req.send();
        return true;
    }
    
    function runNextTest(){
        var delta = (Date.now()) - start;
        if (delta > timeout) {
            //Running too long.
            return false;
        }
        // Run the next DNS query
        var toRun = tests.shift();
        if(toRun){
            return rblTest(toRun);
        }else{
            // Must be finished
            if(killit){
                return true;
            }
            killit = true;
            clearTimeout(timeoutid);
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = errors.length;
            debugMessage('info',"check_rbl: errors length: "+sys.inspect(errors.length));
            jobinfo.results.success = true;
            jobinfo.results.statusCode = 'Not listed';
            jobinfo.results.message = "Not found in any RBLs";
            if(errors.length > 0){
                var errorstring = '';
                var comma = '';
                for(var e in errors){
                    for(var k in errors[e]){
                        errorstring += comma+k+':'+errors[e][k];
                        comma = ', ';
                    }
                }
                jobinfo.results.success = false;
                jobinfo.results.statusCode = 'Listed';
                jobinfo.results.message = "Found in RBLs: "+errorstring;
            }
            resultobj.process(jobinfo);
            return true;
        }
    }

    function reverseIp(ip){
        var ipParts = ip.split('.');
        if(ipParts.length == 4){
            return ipParts[3]+'.'+ipParts[2]+'.'+ipParts[1]+'.'+ipParts[0];
        }
        return false;
    }

    function debugMessage(messageType, message){
        if(jobinfo.debug){
            logger.log(messageType,message);
        }
        return true;
    }
};
