/*!
 * NodePing
 * Copyright(c) 2022 NodePing
 */

/*!
 * check_redis.js
 * redis monitoring.
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout:10000              // Can be overriden by a parameter
};

var Redis = require('ioredis');
var resultobj = require('../results.js');
var sys = require('util');
var nputil = require('../../nputil');
var logger = console;

var check = function(jobinfo){
    //logger.log('info',"check_redis: Jobinfo passed to http check: "+sys.inspect(jobinfo));
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
        //logger.log('info',"check_redis: Invalid URL");
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Missing Redis URL';
        resultobj.process(jobinfo, true);
        return true;
    }

    var targetinfo = {};
    try {
        targetinfo = require('url').parse(jobinfo.parameters.target);
        debugMessage('info',"check_redis: "+sys.inspect(targetinfo));
    } catch(error) {
        //logger.log('info',"check_redis: Invalid URL: "+sys.inspect(error));
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid Redis URL: '+error;
        resultobj.process(jobinfo, true);
        return true;
    }
    if (!targetinfo.protocol || (targetinfo.protocol !== 'redis:' && targetinfo.protocol !== 'rediss:')) {
        logger.log('info',"check_redis: Invalid protocol: "+targetinfo.protocol);
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid Redis URL';
        resultobj.process(jobinfo, true);
        return true;
    }
    
    var completed = false;

    jobinfo.results.diag = {"redis":{}};
    if (jobinfo.parameters.clientcert) {
        if (jobinfo.certinfo && jobinfo.certinfo.error) {
            jobinfo.results.diag.dohdot.certerror = jobinfo.certinfo.error;
        }
    }

    var redisOptions = {
        connectTimeout: timeout,
        disconnectTimeout: timeout,
        retryStrategy: function (times) {
            return 0;
        },
        autoResubscribe: false,
        maxRetriesPerRequest: 0,
        reconnectOnError : function(err) {
            return false
        },
        showFriendlyErrorStack: true,
        tls: (targetinfo.protocol === 'rediss:')
    };

    var redis;
    var standalone = false;
    var cluster = false;
    var sentinel = false;

    if (jobinfo.parameters.clientcert) {
        if (jobinfo.certinfo) {
            if (jobinfo.certinfo.error || ! jobinfo.certinfo.cert) {
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.success = false;
                jobinfo.results.statusCode = 'error';
                jobinfo.results.message = jobinfo.certinfo.error || 'Certificate error';
                resultobj.process(jobinfo, true);
                return true;
            } else {
                jobinfo.results.diag.redis.cert = jobinfo.certinfo.name;
                redisOptions.tls = {ca:jobinfo.certinfo};
            }
        } else {
            return getCertInfo(jobinfo);
        }
    }

    if (jobinfo.parameters.redistype && jobinfo.parameters.redistype != 'standalone') {
        var hosterrors = [];
        var myhosts = [];
        if (nputil.isEmptyObject(jobinfo.parameters.hosts)) {
            hosterrors.push('No host info. Host info required.');
        }
        for (var i in jobinfo.parameters.hosts) {
            if (!jobinfo.parameters.hosts[i].host) {
                hosterrors.push('host info missing');
            }
            if (!jobinfo.parameters.hosts[i].port || jobinfo.parameters.hosts[i].port === 0 || jobinfo.parameters.hosts[i].port === '0' || jobinfo.parameters.hosts[i].port === ' ') {
                jobinfo.parameters.hosts[i].port = 6379;
            }
            if (!jobinfo.parameters.hosts[i].password || jobinfo.parameters.hosts[i].password === 0 || jobinfo.parameters.hosts[i].password === '0' || jobinfo.parameters.hosts[i].password === ' ') {
                jobinfo.parameters.hosts[i].password = null;
            }
            myhosts.push(jobinfo.parameters.hosts[i]);
        }
        if (hosterrors.length) {
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = 'config error: '+hosterrors.join(',');
            resultobj.process(jobinfo, true);
            return true;
        }
        if (targetinfo.auth) {
            var usernameAndPassword = targetinfo.auth.split(':');
            // remove username
            usernameAndPassword.shift();
            redisOptions.password = usernameAndPassword.join(':');
        }
        if (jobinfo.parameters.redistype === 'cluster') {
            cluster = true;
            redis = new Redis.Cluster(
                myhosts, 
                {   redisOptions: {password:redisOptions.password},
                    enableReadyCheck :true,
                    password:redisOptions.password || null
                }
            );
        } else if (jobinfo.parameters.redistype === 'sentinel') {
            redisOptions.sentinels = myhosts;
            sentinel = true;
            redisOptions.name = jobinfo.parameters.sentinelname;
            redisOptions.sentinelPassword = redisOptions.password || null;
            redisOptions.enableTLSForSentinelMode = (targetinfo.protocol === 'rediss:');
            redis = new Redis(jobinfo.parameters.target, redisOptions);
        }
    } else {
        standalone = true;
        redis = new Redis(jobinfo.parameters.target, redisOptions);
    }

    var noPassword = (standalone && !targetinfo.auth);

    var timeoutid = setTimeout(function() {
        if (!completed) {
            completed = true;
            redis.disconnect(false);
            debugMessage('info',"check_redis: setTimeout called to "+sys.inspect(jobinfo.parameters.target));
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Timeout';
            jobinfo.results.success = false;
            jobinfo.results.message = 'Timeout';
            resultobj.process(jobinfo);
        }
        if (redis) redis.disconnect(false);
        return true;
    }, timeout);
    redis.on('connect', function(){
        debugMessage('info','check_redis: connect called on '+sys.inspect(jobinfo.parameters.target));
        if (completed) {
            return true;
        }
        jobinfo.results.end = new Date().getTime();
        if (noPassword) {
            // Connect is about all we can expect but wait 1 second for the 'ready'.  If the 'ready' happens, completed will be true.
            setTimeout(function() {
                if (completed) {
                    return true;
                }
                completed = true;
                clearTimeout(timeoutid);
                redis.disconnect(false);
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Connected';
                jobinfo.results.success = true;
                jobinfo.results.message = 'Connected';
                resultobj.process(jobinfo);
            },1000);
        }
    });
    redis.on('ready', function(){
        debugMessage('info','check_redis: ready: '+sys.inspect(jobinfo.parameters.target));
        var mycallback = function(error, reply) {
            if (completed) {
                return true;
            }
            completed = true;
            clearTimeout(timeoutid);
            redis.disconnect(false);
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.success = true;
            jobinfo.results.statusCode = 'OK';
            if (error) {
                debugMessage('error','check_redis: call error: '+sys.inspect(error));
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.success = false;
                jobinfo.results.message = error.toString();
            } else {
                debugMessage('info','check_redis: info: '+sys.inspect(reply));
                jobinfo.results.diag.redis.inforeply = reply;
                if (defaulttimeout < jobinfo.results.runtime) {
                    debugMessage('info','check_redis: Timeout: '+sys.inspect(defaulttimeout)+" is less than "+sys.inspect(jobinfo.results.runtime));
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'Timeout';
                    jobinfo.results.statusCode = 'Timeout';
                }
            }
            resultobj.process(jobinfo);
            return true;
        };
        var query = jobinfo.parameters.query || 'info';
        var commandsAndCallback = query.split(' ');
        commandsAndCallback.push(mycallback);
        redis.call.apply(this, commandsAndCallback);
        //redis.info(mycallback);
    });
    redis.on('error', function(err) {
        debugMessage('info','check_redis: error called on '+sys.inspect(jobinfo.parameters.target)+' : '+sys.inspect(err));
        if (completed) {
            return true;
        }
        completed = true;
        clearTimeout(timeoutid);
        redis.disconnect(false);
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.statusCode = 'Error';
        jobinfo.results.success = false;
        jobinfo.results.message = err.toString();
        if (jobinfo.results.message.indexOf('ECONNREFUSED') > -1) {
            jobinfo.results.message = "Connection refused. Active blocking by a firewall.";
        }
        resultobj.process(jobinfo);
        return true;
    });
    redis.on('close', function() {
        debugMessage('info','check_redis: close called on '+sys.inspect(jobinfo.parameters.target));
        redis.disconnect(false);
    });
    redis.on('end', function() {
        debugMessage('info','check_redis: end called on '+sys.inspect(jobinfo.parameters.target));
        redis.disconnect(false);
    });
    redis.on('authError', function(err) {
        debugMessage('info','check_redis: authError called on '+sys.inspect(jobinfo.parameters.target+' : '+sys.inspect(err)));
        if (completed) {
            return true;
        }
        completed = true;
        clearTimeout(timeoutid);
        redis.disconnect(false);
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.statusCode = 'Error';
        jobinfo.results.success = false;
        jobinfo.results.message = 'authError: '+err.toString();
        if (jobinfo.results.message.indexOf('called without any password configured') > -1) {
            jobinfo.results.message = 'AUTH called without any password configured for that user.';
        }
        resultobj.process(jobinfo);
        return true;
    });
    return true;
};

exports.check = check;

var debugMessage = function(messageType, message) {
    if (config.debug) {
        logger.log(messageType,message);
    }
}

var getClientCertInfo = function(jobinfo) {
    jobinfo.certinfo = {error:'client certs not supported in AGENT'};
    return check(jobinfo);
};