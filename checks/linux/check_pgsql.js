/*!
 * NodePing
 * Copyright(c) 2022 NodePing
 */

/*!
 * check_pgsql.js
 * PostgreSQL monitoring.
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout:30000              // Can be overriden by a parameter
};

const { Pool, Client } = require('pg');
var resultobj = require('../results.js');
var sys = require('util');
var nputil = require('../../nputil');
var logger = console;

var check = function(jobinfo){
    //logger.log('info',"check_pgsql: Jobinfo passed to http check: "+sys.inspect(jobinfo));
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
        //logger.log('info',"check_pgsql: Invalid URL");
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing PostgreSQL URI';
        resultobj.process(jobinfo, true);
        return true;
    }

    var targetinfo = {};
    try {
        targetinfo = require('url').parse(jobinfo.parameters.target);
        debugMessage('info',"check_pgsql - targetinfo: "+sys.inspect(targetinfo));
    } catch(error) {
        debugMessage('error',"check_pgsql: target won't parse: "+sys.inspect(error));
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid PostgreSQL URI: '+error;
        resultobj.process(jobinfo, true);
        return true;
    }
    if (!targetinfo.protocol || targetinfo.protocol !== 'postgresql:') {
        logger.log('info',"check_pgsql: Invalid protocol: "+targetinfo.protocol);
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid PostgreSQL URI';
        resultobj.process(jobinfo, true);
        return true;
    }
    
    var completed = false;

    jobinfo.results.diag = {"pgsql":{}};

    var pgsqlOptions = {
        connectionTimeoutMillis: timeout,
        query_timeout: timeout,
        statement_timeout: timeout,
        connectionString: jobinfo.parameters.target
    };

    if (!jobinfo.parameters.verify || jobinfo.parameters.verify === 'false') {
        pgsqlOptions.ssl = {rejectUnauthorized: false};
    } 

    var pgsql = new Client(pgsqlOptions);

    var timeoutid = setTimeout(function() {
        if (!completed) {
            completed = true;
            debugMessage('info',"check_pgsql: setTimeout called to "+sys.inspect(jobinfo.parameters.target));
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Timeout';
            jobinfo.results.success = false;
            jobinfo.results.message = 'Timeout';
            resultobj.process(jobinfo);
        }
        if (pgsql) pgsql.end();
        return true;
    }, timeout);
    
    pgsql.connect(function(err) {
        if (!completed) {
            if (err) {
                clearTimeout(timeoutid);
                debugMessage('error','connection error: '+sys.inspect(err));
                completed = true;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Connection Error: '+err.toString();
                if (jobinfo.results.message.indexOf('getaddrinfo ENOTFOUND') > -1) {
                    jobinfo.results.message = 'DNS error: unable to resolve host name '+targetinfo.hostname;
                } else if (jobinfo.results.message.indexOf('ECONNREFUSED') > -1) {
                    jobinfo.results.message = jobinfo.results.message.replace('Error: connect ECONNREFUSED','connection actively refused by firewall');
                } else if (jobinfo.results.message.indexOf('no pg_hba.conf entry') > -1 && !targetinfo.auth) {
                    // No username/password given so we're just checking connection.
                    jobinfo.results.statusCode = 'Success';
                    jobinfo.results.success = true;
                    jobinfo.results.message = 'Connected';
                }
                resultobj.process(jobinfo);
                pgsql.end();
                return true;
            }
            var query = jobinfo.parameters.query || 'SELECT NOW()';

            debugMessage('info','check_pgsql: query will be: '+sys.inspect(query));
            pgsql.query(query, function(error, queryresult) {
                if (!completed) {
                    completed = true;
                    clearTimeout(timeoutid);
                    if (error) {
                        debugMessage('error','check_pgsql: query error: '+sys.inspect(error));
                        jobinfo.results.end = new Date().getTime();
                        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                        jobinfo.results.statusCode = 'Error';
                        jobinfo.results.success = false;
                        jobinfo.results.message = 'Query Error: '+error.toString();
                        resultobj.process(jobinfo);
                        pgsql.end();
                        return true;
                    }
                    debugMessage('info','check_pgsql: query results: '+sys.inspect(queryresult));
                    completed = true;
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
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
                        if (queryresult && queryresult.rows && queryresult.rows.length) {
                            for (var i in queryresult.rows) {
                                if (queryresult.rows[i]) {
                                    for (var resultfield in queryresult.rows[i]) {
                                        if (fields.indexOf(resultfield) > -1 && !(foundfields.hasOwnProperty(resultfield))) {
                                            foundfields[resultfield] = queryresult.rows[i][resultfield];
                                        }
                                    }
                                }
                            }
                        }
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
                                debugMessage('info','check_pgsql: Query result errors: '+sys.inspect(queryresultserrors));
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
                    pgsql.end();
                }
                return true;
            });
            return true;
        }
        return true;
    });
};

exports.check = check;