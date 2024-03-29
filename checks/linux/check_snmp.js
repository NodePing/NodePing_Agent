/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_snmp.js
 * snmp check to 'get' oids and check their values against min/max on a check.
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout:10000              // Can be overriden by a parameter
};

var snmp = require('net-snmp');
var resultobj = require('../results.js');
var sys = require('util');
var nputil = require('../../nputil');
var net = require('net');
var dns = require('dns');
var logger = console;

var check = exports.check = function(jobinfo){
    var defaulttimeout = config.timeout * 1;
    var timeout = config.timeout * 1;
    if (jobinfo.parameters.threshold) {
        defaulttimeout = 1000 * parseInt(jobinfo.parameters.threshold);
        if (defaulttimeout > 90000) defaulttimeout = 90000;
        timeout = defaulttimeout + 1000;
    }
    debugMessage('info',"check_snmp: Jobinfo passed: "+sys.inspect(jobinfo));
    jobinfo.results = {start:new Date().getTime(),diag:{snmp:{}}};
    if (!jobinfo.parameters.fields || jobinfo.parameters.fields == '') {
        debugMessage('error',"check_snmp: missing fields");
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing fields to parse';
        resultobj.process(jobinfo, true);
        return true;
    }
    if (!jobinfo.parameters.target) {
        debugMessage('error',"check_snmp: missing snmp target");
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing snmp hostname or ip';
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
            } else if(addresses && addresses[0]) {
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
                        //logger.log('info','check_snmp: resolution error: '+sys.inspect(err));
                        //logger.log('info','check_snmp: resolution addresses: '+sys.inspect(addresses));
                        if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
                            return tryIpv6();
                        }
                        jobinfo.results.success = false;
                        jobinfo.results.end = new Date().getTime();
                        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                        jobinfo.results.statusCode = 'Error';
                        jobinfo.results.message = 'Error resolving the hostname: '+jobinfo.parameters.target;
                        resultobj.process(jobinfo);
                    } else if(addresses && addresses.length && addresses[0]) {
                        //logger.log('info','check_snmp: resolution addresses: '+sys.inspect(addresses));
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

    jobinfo.results.diag.snmp.serverip = jobinfo.targetip;

    // Gather the oids to send in our get request
    var oidsToSend = [];
    var oidInfo = {};
    for (var key in jobinfo.parameters.fields) {
        if (jobinfo.parameters.fields[key].hasOwnProperty("name") && jobinfo.parameters.fields[key].name) {
            oidsToSend.push(jobinfo.parameters.fields[key].name);
            jobinfo.parameters.fields[key].key = key;
            oidInfo[jobinfo.parameters.fields[key].name] = jobinfo.parameters.fields[key];
        }
    }
    if (!oidsToSend.length) {
        debugMessage('error',"check_snmp: missing oids");
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing snmp oids';
        resultobj.process(jobinfo, true);
        return true;
    }
    var version = snmp.Version1;
    if (jobinfo.parameters.snmpv) {
        if (jobinfo.parameters.snmpv === '2c') {
            version = snmp.Version2c;
        }
    }
    var port = 161;
    if (jobinfo.parameters.port) {
        port = jobinfo.parameters.port;
    }
    var options = {"version":version,timeout:timeout,retries:0,port:port};
    debugMessage('info',"check_snmp: target:"+jobinfo.targetip+" with options: "+sys.inspect(options)+" and oids are: "+sys.inspect(oidsToSend));

    var killit = false;
    var timeoutid = setTimeout(function() {
        if (killit) {
            return true;
        }
        killit = true;
        debugMessage('error',"check_snmp: setTimeout called: "+timeout.toString());
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.statusCode = 'Timeout';
        jobinfo.results.success = false;
        jobinfo.results.message = 'Timeout timer';
        resultobj.process(jobinfo);
        if (session) {
            session.close();
        }
        return true;
    }, timeout);

    try {
        var session = snmp.createSession (jobinfo.targetip, jobinfo.parameters.snmpcom, options);
        session.get (oidsToSend, function (error, varbinds) {
            debugMessage('info',"check_snmp: get callback: "+sys.inspect(varbinds)+' and error: '+sys.inspect(error));
            if (!killit) {
                clearTimeout(timeoutid);
                killit = true;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'OK';
                jobinfo.results.diag.snmp.oids = oidsToSend;
                jobinfo.results.fieldtracking = {};
                if (error) {
                    debugMessage('error','check_snmp: Error from: '+sys.inspect(jobinfo)+' error: '+sys.inspect(error));
                    jobinfo.results.statusCode = 'Error';
                    jobinfo.results.success = false;
                    jobinfo.results.message = error.toString();
                    resultobj.process(jobinfo);
                    session.close();
                    return false;
                } else {
                    if (defaulttimeout < jobinfo.results.runtime) {
                        debugMessage('error','check_snmp: Timeout: '+sys.inspect(defaulttimeout)+" is less than "+sys.inspect(jobinfo.results.runtime));
                        jobinfo.results.success = false;
                        jobinfo.results.message = 'Response received but took longer than the configured timeout of '+defaulttimeout;
                        jobinfo.results.statusCode = 'Timeout';
                        resultobj.process(jobinfo);
                        session.close();
                        return true;
                    }
                    if (!varbinds.length) {
                        debugMessage('error','check_snmp: Empty return for: '+sys.inspect(jobinfo.parameters.target)+" : "+sys.inspect(varbinds));
                        jobinfo.results.success = false;
                        jobinfo.results.message = 'No snmp information received.';
                        jobinfo.results.statusCode = 'error';
                        resultobj.process(jobinfo);
                        session.close();
                        return true;
                    }
                    var snmperrors = [];
                    for (var i = 0; i < varbinds.length; i++) {
                        //debugMessage('info','check_snmp: returned oid info: '+sys.inspect(varbinds[i]));
                        jobinfo.results.breached = 0;
                        if (snmp.isVarbindError (varbinds[i])){
                            debugMessage('error','check_snmp: varbind is an error: '+sys.inspect(varbinds[i]));
                            snmperrors.push(snmp.varbindError(varbinds[i]));
                        } else {
                            if (varbinds[i].oid && oidInfo[varbinds[i].oid]) {
                                if (varbinds[i].type === 4) {
                                    // Buffer.
                                    varbinds[i].value = varbinds[i].value.toString('utf8');
                                    //debugMessage('info','check_snmp: buffer to string: '+sys.inspect(varbinds[i].value));
                                }
                                var metric = getFloat(varbinds[i].value);
                                jobinfo.results.fieldtracking[oidInfo[varbinds[i].oid].key] = metric;
                                if (oidInfo[varbinds[i].oid].hasOwnProperty("min") && metric < oidInfo[varbinds[i].oid].min) {
                                    // We're under our minimum.
                                    snmperrors.push(varbinds[i].oid+":"+metric.toString()+" (min "+oidInfo[varbinds[i].oid].min.toString()+')');
                                    jobinfo.results.breached = 1;
                                }
                                if (oidInfo[varbinds[i].oid].hasOwnProperty("max") && metric > oidInfo[varbinds[i].oid].max) {
                                    // We're over our max.
                                    snmperrors.push(varbinds[i].oid+":"+metric.toString()+" (max "+oidInfo[varbinds[i].oid].max.toString()+')');
                                    jobinfo.results.breached = 1;
                                }
                                delete(oidInfo[varbinds[i].oid]);
                            }
                        }
                    }
                    // oidInfo should be empty once we get here.  If there are any left, it's because we didn't get a response for that oid.
                    for (var oid in oidInfo) {
                        snmperrors.push(oid+": absent");
                    }
                    if (snmperrors.length > 0) {
                        debugMessage('info','check_snmp: Found errors: '+sys.inspect(snmperrors));
                        jobinfo.results.diag.snmp.reply = sys.inspect(varbinds,{depth:10});
                        var errorMessage = '';
                        var comma = '';
                        for (var ind in snmperrors) {
                            errorMessage +=comma+snmperrors[ind];
                            comma = '. ';
                        }
                        jobinfo.results.success = false;
                        jobinfo.results.message = errorMessage;
                    } else {
                        jobinfo.results.success = true;
                        jobinfo.results.message = 'All fields within parameters';
                    }
                    //debugMessage('info','check_snmp: processing: '+sys.inspect(jobinfo));
                    resultobj.process(jobinfo);
                }
            }
            session.close();
            return false;
        });
        session.on("error", function(e) {
            debugMessage('error',"check_snmp: error event: "+sys.inspect(e));                
            clearTimeout(timeoutid);
            if (!killit) {
                killit = true;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.success = false;
                jobinfo.results.message = e.toString();
                jobinfo.results.diag.snmp.error = e.toString();
                resultobj.process(jobinfo);
                session.close();
            }
            return true;
        }).on("timeout", function(to) {
            clearTimeout(timeoutid);
            if (!killit) {
                killit = true;
                debugMessage('error',"check_snmp: timeout event");
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Timeout';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Timeout';
                resultobj.process(jobinfo);
            }
            session.close();
            return true;
        });
    } catch(ec) {
        clearTimeout(timeoutid);
        debugMessage('error',"check_snmp: caught error: "+sys.inspect(ec));
        if (!killit) {
            killit = true;
            if (session) session.close();
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Error';
            jobinfo.results.success = false;
            jobinfo.results.message = "Caught "+ec.toString();
            resultobj.process(jobinfo);
        }
        return true;
    }
    function debugMessage(messageType, message) {
        if (jobinfo.debug || config.debug) {
            logger.log(messageType,message);
        }
    }
    function trim1white (str) {
        return str.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
    }
    function getFloat(s) {
        if (nputil.gettype(s) == 'string') {
            s = parseFloat(trim1white(s));
        }
        return s;
    }
    return true;
};