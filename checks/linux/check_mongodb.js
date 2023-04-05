/*!
 * NodePing
 * Copyright(c) 2023 NodePing
 */

/*!
 * check_mongodb.js
 * MongoDB monitoring.
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout:90000             // Can be overwritten by a parameter
};

var MongoClient = require('mongodb').MongoClient;
var resultobj = require('../results.js');
var sys = require('util');
var nputil = require('../../nputil');
var logger = console;
var url = require('url');

var check = function(jobinfo) {
    //logger.log('info',"check_mongodb: Jobinfo passed to http check: "+sys.inspect(jobinfo));
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
        //logger.log('info',"check_mongodb: Invalid URI");
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing MongoDB URI';
        resultobj.process(jobinfo, true);
        return true;
    }

    var targetinfo = {};
    try {
        targetinfo = new URL(jobinfo.parameters.target);
        debugMessage('info',"check_mongodb - targetinfo: "+sys.inspect(targetinfo));
    } catch (error) {
        debugMessage('error',"check_mongodb: target won't parse: "+sys.inspect(error));
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid MongoDB URI: '+error;
        resultobj.process(jobinfo, true);
        return true;
    }
    if (!targetinfo.protocol || targetinfo.protocol !== 'mongodb:') {
        debugMessage('info',"check_mongodb: Invalid protocol: "+targetinfo.protocol);
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid MongoDB URI';
        resultobj.process(jobinfo, true);
        return true;
    }

    jobinfo.results.diag = {"mongodb":{}};

    var connectOptions = {
        connectTimeoutMS: timeout,
        directConnection: true,
        maxIdleTimeMS: timeout,
        maxPoolSize: 1,
        maxConnecting: 1,
        retryReads: false,
        socketTimeoutMS: timeout,
        waitQueueTimeoutMS: timeout
    };

    for (var opt in connectOptions) {
        if (!targetinfo.searchParams.has(opt)) {
            targetinfo.searchParams.append(opt, connectOptions[opt]);
        }
    }

    jobinfo.results.diag.mongodb.uri = targetinfo.href;

    debugMessage('info',"check_mongodb: URI "+sys.inspect(targetinfo.href));

    const client = new MongoClient(targetinfo.href);

    var completed = false;

    var timeoutid = setTimeout(function() {
        if (!completed) {
            completed = true;
            debugMessage('info',"check_mongodb: setTimeout called to "+sys.inspect(jobinfo.parameters.target));
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Timeout';
            jobinfo.results.success = false;
            jobinfo.results.message = 'Timeout';
            resultobj.process(jobinfo);
        }
        if (client) client.close();
        return true;
    }, timeout);

    client.connect( function(err) {
        if (!completed) {
            if (err) {
                clearTimeout(timeoutid);
                completed = true;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Connection Error: '+err.toString();
                debugMessage('error','check_mongodb: connect error: '+sys.inspect(err));
                if (jobinfo.results.message.indexOf('getaddrinfo ENOTFOUND') > -1) {
                    jobinfo.results.message = 'DNS error: unable to resolve host name '+targetinfo.hostname;
                } else if (jobinfo.results.message.indexOf('ECONNREFUSED') > -1) {
                    jobinfo.results.message = jobinfo.results.message.replace('Error: connect ECONNREFUSED','connection actively refused by firewall');
                } else if (jobinfo.results.message.indexOf('auth') > -1  && !jobinfo.parameters.database) {
                    // No username/password given so we're just checking connection.
                    jobinfo.results.statusCode = 'Connected';
                    jobinfo.results.success = true;
                    jobinfo.results.message = 'Connected';
                }
                resultobj.process(jobinfo);
                client.close();
                return true;
            }
            debugMessage('info','check_mongodb: connected no error');
            if (jobinfo.parameters.database && jobinfo.parameters.namespace && jobinfo.parameters.query) {
                const db = client.db(jobinfo.parameters.database);
                var coll = db.collection(jobinfo.parameters.namespace);
                var query = parseFromJson(jobinfo.parameters.query);
                debugMessage('info','check_mongodb: query: '+sys.inspect(query));
                if (query) {
                    jobinfo.results.diag.mongodb.query = query;
                    var queryoptions = false;
                    if (jobinfo.parameters.queryoptions) {
                        queryoptions = parseFromJson(jobinfo.parameters.queryoptions);
                        if (!queryoptions) {
                            jobinfo.results.diag.mongodb.queryoptions = jobinfo.parameters.queryoptions;
                            completed = true;
                            clearTimeout(timeoutid);
                            jobinfo.results.end = new Date().getTime();
                            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                            debugMessage('error','check_mongodb: query options parse error');
                            jobinfo.results.statusCode = 'Error';
                            jobinfo.results.success = false;
                            jobinfo.results.message = 'Unable to parse the query options - invalid JSON';
                            resultobj.process(jobinfo);
                            client.close();
                            return true;
                        }
                    }
                    if (!queryoptions) {
                        queryoptions = {limit:25};
                    }
                    if (!queryoptions.limit || queryoptions.limit > 25) {
                        queryoptions.limit = 25
                    }
                    jobinfo.results.diag.mongodb.queryoptions = queryoptions;
                    coll.find(query, queryoptions).toArray(function(queryerror, queryresult) {
                        if (!completed) {
                            completed = true;
                            clearTimeout(timeoutid);
                            jobinfo.results.end = new Date().getTime();
                            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                            if (queryerror) {
                                debugMessage('error','check_mongodb: query error: '+sys.inspect(queryerror));
                                jobinfo.results.diag.mongodb.queryerror = queryerror;
                                jobinfo.results.statusCode = 'Error';
                                jobinfo.results.success = false;
                                jobinfo.results.message = 'Query Error: '+queryerror.toString();
                                resultobj.process(jobinfo);
                                client.close();
                                return true;
                            }
                            debugMessage('info','check_mongodb: query results: '+sys.inspect(queryresult));

                            jobinfo.results.diag.mongodb.queryresult = limitResults(queryresult);
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
                                if (queryresult && queryresult.length) {
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
                                        debugMessage('info','check_mongodb: Query result errors: '+sys.inspect(queryresultserrors));
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
                        } 
                        client.close();
                        return true;
                    });
                    return true;
                } else {
                    // query parse came back false
                    completed = true;
                    clearTimeout(timeoutid);
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    debugMessage('error','check_mongodb: query parse error');
                    jobinfo.results.statusCode = 'Error';
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'Unable to parse the query - invalid JSON';
                    resultobj.process(jobinfo);
                    client.close();
                    return true;
                }
            } else {
                // No database, namespace, and query given so a connection is good enough for a pass.
                clearTimeout(timeoutid);
                completed = true;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Success';
                jobinfo.results.success = true;
                jobinfo.results.message = 'Connected';
                resultobj.process(jobinfo);
                client.close();
                return true;
            }
        }
    });
};

var parseFromJson = function(str) {
    var jsonObj = false;
    try {
        jsonObj = JSON.parse(str);
    } catch (jsonerror) {
        // Bad string - doesn't parse
    }
    return jsonObj;
};

var limitResults =  function(resultsobj) {
    var resultstr = '';
    try {
        resultstr = JSON.stringify(resultsobj);
    } catch  (stringifyerror) {
        // Bad object - doesn't stringify
    }
    if (resultstr.length > 200000) {
        resultstr = resultstr.substr(0,200000);
    }
    return resultstr;
}

exports.check = check;