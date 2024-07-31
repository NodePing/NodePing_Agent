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
    timeout:30000              // Can be overriden by a parameter
};

var resultobj = require('../results.js');
var sys = require('util');
var logger = console;
var ndns = require('native-dns');
var dns = require('dns');
var net = require('net');

var check = exports.check = function(jobinfo) {
    var timeout = config.timeout *1;
    // We always use the checks configured timeout.
    if (!jobinfo.parameters.target) {
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
                jobinfo.parameters.targetip = addresses[0];
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

    if (!jobinfo.parameters.targetip) {
        if (net.isIP(jobinfo.parameters.target)) {
            jobinfo.parameters.targetip = jobinfo.parameters.target;
        } else {
            if (jobinfo.parameters.ipv6) {
                if (!net.isIPv6(jobinfo.parameters.target)) {
                    return tryIpv6();
                }
            } else {
                // Resolve the ipv4
                if (!net.isIPv4(jobinfo.parameters.target) && !net.isIPv6(jobinfo.parameters.target)) {
                    jobinfo.dnsresolutionstart = new Date().getTime();
                    dns.resolve4(jobinfo.parameters.target, function (err, addresses) {
                        jobinfo.dnsresolutionend = new Date().getTime();
                        if (err) {
                            //logger.log('info','check_rbl: resolution error: '+sys.inspect(err));
                            //logger.log('info','check_rbl: resolution addresses: '+sys.inspect(addresses));
                            if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
                                return tryIpv6();
                            }
                            jobinfo.results.success = false;
                            jobinfo.results.end = new Date().getTime();
                            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                            jobinfo.results.statusCode = 'Error';
                            jobinfo.results.message = 'Error resolving: '+jobinfo.parameters.target;
                            resultobj.process(jobinfo);
                        } else if (addresses && addresses.length && addresses[0]) {
                            //logger.log('info','check_rbl: resolution addresses: '+sys.inspect(addresses));
                            if (addresses[0]) {
                                jobinfo.parameters.targetip = addresses[0];
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
        }
    }
    if (!jobinfo.parameters.targetip) {
        debugMessage('error',"check_rbl: Invalid targetip - "+sys.inspect(jobinfo));
        jobinfo.results = {start: new Date().getTime()};
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = 0;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid target IP';
        resultobj.process(jobinfo);
        return true;
    }
    debugMessage('info','check_rbl: Checking '+jobinfo.parameters.targetip);
    var reverseip = reverseIp(jobinfo.parameters.targetip);
    var ip = jobinfo.parameters.targetip;
    if (!reverseip) {
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

    var tests = ['zen.spamhaus.org',
                 'dnsbl.sorbs.net',
                 'spam.dnsbl.sorbs.net',
                 'b.barracudacentral.org',
                 'spamsources.fabel.dk',
                 'bl.spamcop.net',
                 'dnsrbl.swinog.ch',
                 'uribl.swinog.ch',
                 'bogons.cymru.com',
                 'dnsbl.kempt.net',
                 'ubl.unsubscore.com',
                 'bl.mailspike.net',
                 'ix.dnsbl.manitu.net',
                 '0spam.fusionzero.com',
                 'psbl.surriel.com',
                 'backscatter.spameatingmonkey.net',
                 'bl.spameatingmonkey.net',
                 'truncate.gbudb.net',
                 'blacklist.woody.ch',
                 'db.wpbl.info',
                 'dnsbl-3.uceprotect.net',
                 'ips.backscatterer.org',
                 'virbl.bit.nl',
                 'orvedb.aupads.org'
                ];
    if (jobinfo.parameters.ignore && jobinfo.parameters.ignore.length > 0) {
        var ignoreList = jobinfo.parameters.ignore.split(",");
        for (var ind in ignoreList) {
            var entry = trim1white(ignoreList[ind]);
            if (entry.toLowerCase().indexOf('spamhaus') > -1) {
                entry = 'zen.spamhaus.org'; //This must match the spamhaus entry at the top.
            }
            var pos = tests.indexOf(entry);
            if (pos > -1) {
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
        if (killit) {
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

    function rblTest(testtype) {
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
            if (answer.answer && answer.answer.length > 0) {
                debugMessage('info',"check_rbl: ip: "+sys.inspect(ipToLookup)+" returned address: "+sys.inspect(answer.answer));
                var result = {};
                if (testtype.indexOf('spamhaus') > 0) {
                    testtype = 'zen.spamhaus.org';
                }
                result[testtype] = answer.answer[0].address;
                errors.push(result);
            } else if (err) {
                debugMessage('info',"check_rbl: ip: "+sys.inspect(ipToLookup)+" return error: "+sys.inspect(err));
                if (err.code && err.code == 'ENOTFOUND') {
                    // Cool, we're not listed.
                } else {
                    logger.log('error',"check_rbl: ip: "+sys.inspect(ipToLookup)+" return error: "+sys.inspect(err));
                }
            } else {
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
        if (toRun) {
            return rblTest(toRun);
        } else {
            // Must be finished
            if (killit) {
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
            if (errors.length > 0) {
                var errorstring = '';
                var comma = '';
                for (var e in errors) {
                    for (var k in errors[e]) {
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

    function reverseIp(ip) {
        if (net.isIPv4(ip)) {
            debugMessage('info','check_rbl: reverseIp: ipv4 '+ip);
            var ipParts = ip.split('.');
            if (ipParts.length == 4) {
                return ipParts[3]+'.'+ipParts[2]+'.'+ipParts[1]+'.'+ipParts[0];
            }
            return false;
        } else if (net.isIPv6(ip)) {
            debugMessage('info','check_rbl: reverseIp: ipv6 '+ip);
            const parts = ip.split(':');
            // Find the location of the empty part (if exists, representing the '::')
            const emptyIndex = parts.indexOf('');
            if (emptyIndex !== -1) {
                // Remove the empty part to calculate the missing sections
                parts.splice(emptyIndex, 1);
                // Calculate the number of missing sections
                const missingSections = 8 - parts.length;

                // Fill the missing sections with '0000'
                const emptySections = Array(missingSections).fill('0000');

                // Insert the empty sections into the parts array at the location of the empty part
                parts.splice(emptyIndex, 0, ...emptySections);
            }

            // Expand each part to 4 digits by padding with leading zeros
            const expandedParts = parts.map(part => part.padStart(4, '0'));

            // Join the expanded parts with ':' to form the full IPv6 address
            const expandedIPv6 = expandedParts.join(':');
            const noColons = expandedIPv6.replace(/:/g, '');
            const reversed = noColons.split('').reverse().join('.');
            debugMessage('info','check_rbl: reverseIp: reversed ipv6 returned '+reversed);
            return reversed;
        } else {
            debugMessage('info','check_rbl: reverseIp: not ipv4 or ipv6: '+ip);
            return ip;
        }
    }

    function debugMessage(messageType, message) {
        if (jobinfo.debug) {
            logger.log(messageType,message);
        }
        return true;
    }
};