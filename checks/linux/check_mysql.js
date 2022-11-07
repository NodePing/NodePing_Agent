/*!
 * NodePing
 * Copyright(c) 2022 NodePing
 */

/*!
 * check_mysql.js
 * MySQL monitoring.
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout:30000              // Can be overwritten by a parameter
};

var mysql = require('mysql2');
var dns = require('dns');
var net = require('net');
var resultobj = require('../results.js');
var sys = require('util');
var nputil = require('../nputil');
var logger = console;

var check = function(jobinfo){
    var defaulttimeout = config.timeout * 1;
    var timeout = config.timeout * 1;
    if (jobinfo.parameters.threshold) {
        defaulttimeout = 1000 * parseInt(jobinfo.parameters.threshold);
        if (defaulttimeout > 90000) defaulttimeout = 90000;
        timeout = defaulttimeout + 2000;
    }
    var debugMessage = function (messageType, message) {
        if (jobinfo.debug || config.debug) {
            logger.log(messageType,message);
        }
    };
    jobinfo.results = {start:new Date().getTime()};

    if (!jobinfo.parameters.target) {
        //logger.log('info',"check_mysql: Invalid URL");
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing MySQL FQDN or IP';
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
                return check(jobinfo);
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
                        debugMessage('info','check_mysql: resolution error: '+sys.inspect(err));
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
                        debugMessage('info','check_mysql: resolution addresses: '+sys.inspect(addresses));
                        if (addresses[0]) {
                            jobinfo.targetip = addresses[0];
                            return check(jobinfo);
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

    debugMessage('info',"check_mysql: "+jobinfo.parameters.target+' resolved to '+jobinfo.targetip);

    jobinfo.results.diag = {"mysql":{serverip:jobinfo.targetip}};

    if (jobinfo.dnsresolutionstart && jobinfo.dnsresolutionend) {
        jobinfo.results.diag.mysql.dnsresolutiontime = jobinfo.dnsresolutionend - jobinfo.dnsresolutionstart;
    }

    var username = 'nodeping';
    var password = 'nodeping';
    var database = jobinfo.parameters.database || false;

    if (jobinfo.parameters.username && jobinfo.parameters.username !== ' ') {
        username = jobinfo.parameters.username;
    }
    if (jobinfo.parameters.password && jobinfo.parameters.password !== ' ') {
        password = jobinfo.parameters.password;
    }

    var connection = mysql.createConnection({
        host: jobinfo.targetip,
        port: jobinfo.parameters.port || 3306,
        user: username,
        password: password,
        database: database,
        connectTimeout: timeout,
        ssl: (jobinfo.parameters.secure) ? {} : false
        //insecureAuth: true,
        //supportBigNumbers: true,
        //dateStrings: true,

    });

    var completed = false;

    var timeoutid = setTimeout(function() {
        if (!completed) {
            completed = true;
            debugMessage('info',"check_mysql: setTimeout called to "+sys.inspect(jobinfo.parameters.target));
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Timeout';
            jobinfo.results.success = false;
            jobinfo.results.message = 'Timeout';
            resultobj.process(jobinfo);
        }
        if (connection) connection.destroy();
        return true;
    }, timeout);

    connection.connect(function(err) {
        if (err) {
            debugMessage('error','mysql error connecting: ' + sys.inspect(err));
            if (!completed) {
                completed = true;
                clearTimeout(timeoutid);
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Connection Error: '+err.toString();
                if (jobinfo.results.message.indexOf('ECONNREFUSED') > -1) {
                    jobinfo.results.message = jobinfo.results.message.replace('Error: connect ECONNREFUSED','connection actively refused by firewall');
                } else if (jobinfo.results.message.indexOf('ER_ACCESS_DENIED_ERROR') > -1) {
                    if (!database) {
                        // No database given so we're just checking connection.
                        jobinfo.results.statusCode = 'Responded';
                        jobinfo.results.success = true;
                        jobinfo.results.message = 'Authentication error but responded';
                    } else {
                        jobinfo.results.message = 'Authentication Error';
                    }
                }
                resultobj.process(jobinfo);
            }
            if (connection) connection.destroy();
            return true;
        }
        var query = jobinfo.parameters.query || 'SELECT NOW()';
        debugMessage('info','check_mysql: query will be: '+sys.inspect(query));
        jobinfo.results.diag.mysql.query = query;
        connection.query(query, function (error, queryresult, fields) {
            if (!completed) {
                completed = true;
                clearTimeout(timeoutid);
                if (error) {
                    debugMessage('error','check_mysql: query error: '+sys.inspect(error));
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Error';
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'Query Error: '+error.toString();
                    resultobj.process(jobinfo);
                    if (connection) connection.end(function(err){
                        if (err) debugMessage('error','mysql: error ending connection after query error: '+sys.inspect(err));
                        debugMessage('info','mysql: ending connection after query error');
                    });
                    return true;
                }
                debugMessage('info','check_mysql: query results: '+sys.inspect(queryresult));
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.diag.mysql.queryresults = queryresult;
                if (jobinfo.parameters.fields && !nputil.isEmptyObject(jobinfo.parameters.fields)) {
                    jobinfo.results.fieldtracking = {};
                    var fields = [];
                    var foundfields = {};
                    var queryresultserrors = [];
                    for (var fieldkey in jobinfo.parameters.fields) {
                        if (jobinfo.parameters.fields[fieldkey] && jobinfo.parameters.fields[fieldkey].name) {
                            if (fields.indexOf(jobinfo.parameters.fields[fieldkey].name) < 0) {
                                fields.push(jobinfo.parameters.fields[fieldkey].name);
                            }
                        }
                    }
                    debugMessage('info','check_mysql: job fields are: '+sys.inspect(fields));
                    if (queryresult && queryresult && queryresult.length) {
                        for (var i in queryresult) {
                            if (queryresult[i]) {
                                for (var resultfield in queryresult[i]) {
                                    if (fields.indexOf(resultfield) > -1 && !(foundfields.hasOwnProperty(resultfield))) {
                                        foundfields[resultfield] = queryresult[i][resultfield];
                                    }
                                }
                            }
                        }
                    }
                    debugMessage('info','check_mysql: results fields are: '+sys.inspect(foundfields));
                    if (!nputil.isEmptyObject(foundfields)) {
                        for (var fieldkey in jobinfo.parameters.fields) {
                            if (jobinfo.parameters.fields[fieldkey] && jobinfo.parameters.fields[fieldkey].name) {
                                if (!foundfields.hasOwnProperty(jobinfo.parameters.fields[fieldkey].name)) {
                                    queryresultserrors.push(jobinfo.parameters.fields[fieldkey].name+":absent");
                                } else {
                                    // Data is present for this field
                                    if (nputil.isNumeric(foundfields[jobinfo.parameters.fields[fieldkey].name])) {
                                        jobinfo.results.fieldtracking[fieldkey] = foundfields[jobinfo.parameters.fields[fieldkey].name];
                                    } else {
                                        jobinfo.results.fieldtracking[fieldkey] = foundfields[jobinfo.parameters.fields[fieldkey].name].substr(0,99);
                                    }

                                    if (jobinfo.parameters.fields[fieldkey].hasOwnProperty('min')) {
                                        if (foundfields[jobinfo.parameters.fields[fieldkey].name] < jobinfo.parameters.fields[fieldkey].min) {
                                            // We're under our minimum.
                                            queryresultserrors.push(jobinfo.parameters.fields[fieldkey].name+":"+foundfields[jobinfo.parameters.fields[fieldkey].name].toString()+" (min "+jobinfo.parameters.fields[fieldkey].min.toString()+')');
                                        }
                                    }
                                    if (jobinfo.parameters.fields[fieldkey].hasOwnProperty('max')) {
                                        if (foundfields[jobinfo.parameters.fields[fieldkey].name] > jobinfo.parameters.fields[fieldkey].max) {
                                            // We're over the maximum.
                                            queryresultserrors.push(jobinfo.parameters.fields[fieldkey].name+":"+foundfields[jobinfo.parameters.fields[fieldkey].name].toString()+" (max "+jobinfo.parameters.fields[fieldkey].max.toString()+')');
                                        }
                                    }
                                    if (jobinfo.parameters.fields[fieldkey].hasOwnProperty('match') && jobinfo.parameters.fields[fieldkey].match !== ' ') {
                                        if (foundfields[jobinfo.parameters.fields[fieldkey].name] != jobinfo.parameters.fields[fieldkey].match) {
                                            // No direct match.  Check for regex
                                            try {
                                                var rg = new RegExp(jobinfo.parameters.fields[fieldkey].match);
                                                foundit = rg.test(foundfields[jobinfo.parameters.fields[fieldkey].name]);
                                            } catch (re) {
                                                queryresultserrors.push(jobinfo.parameters.fields[fieldkey].name+":"+foundfields[jobinfo.parameters.fields[fieldkey].name].toString().substr(0,100)+" (match "+jobinfo.parameters.fields[fieldkey].match.toString().substr(0,100)+')');
                                            }
                                            if (!foundit) {
                                                queryresultserrors.push(jobinfo.parameters.fields[fieldkey].name+":"+foundfields[jobinfo.parameters.fields[fieldkey].name].toString().substr(0,100)+" (match "+jobinfo.parameters.fields[fieldkey].match.toString().substr(0,100)+')');
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        if (queryresultserrors.length > 0) {
                            debugMessage('info','check_mysql: Query result errors: '+sys.inspect(queryresultserrors));
                            var errorMessage = '';
                            var comma = '';
                            for (var ind in queryresultserrors) {
                                errorMessage +=comma+queryresultserrors[ind];
                                comma = '. ';
                            }
                            jobinfo.results.statusCode = 'Query Result Error';
                            jobinfo.results.success = false;
                            jobinfo.results.message = errorMessage;
                        } else {
                            jobinfo.results.statusCode = 'Success';
                            jobinfo.results.success = true;
                            jobinfo.results.message = 'All query results within parameters';
                        }
                    } else {
                        jobinfo.results.statusCode = 'Error';
                        jobinfo.results.success = false;
                        jobinfo.results.message = 'Query did not return any required fields';
                    }
                } else {
                    jobinfo.results.statusCode = 'Success';
                    jobinfo.results.success = true;
                    if (queryresult.rows && queryresult.rows.length) {
                        jobinfo.results.message = 'Query returned '+queryresult.rows.length+' results';
                    } else {
                        jobinfo.results.message = 'Query returned 0 results';
                    }
                }
                resultobj.process(jobinfo);
                if (connection) connection.end(function(err) {
                    if (err) debugMessage('error','mysql: error ending connection after query: '+sys.inspect(err));
                    debugMessage('info','mysql: ending connection after query');
                });
            }
            return true;
        });
    });
};

exports.check = check;